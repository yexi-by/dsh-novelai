import { credentialRef } from "@deepseek-ai/dsh-credentials";
import z from "@deepseek-ai/schemastery";
import { unzipSync } from "fflate";
import sharp from "sharp";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED_SKILL_RANK } from "@deepseek-ai/dsh-skill";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
// src/shared.ts
const CREDENTIAL_REF = "NOVELAI_API_TOKEN";
const RPC_CHANNEL = "/dsh-novelai";
const DEFAULT_MODEL = "nai-diffusion-5-full";
const API_ORIGIN = "https://image.novelai.net";
const BLUR_SIGMA_VALUES = [
	0,
	.3,
	.35,
	.4,
	.45,
	.5
];
const DEFAULT_SETTINGS = {
	model: DEFAULT_MODEL,
	outputDirectory: "novelai-output",
	timeoutSeconds: 300
};
const MODELS = [
	{
		id: "nai-diffusion-5-full",
		label: "V5 Full",
		family: 5,
		characters: 22,
		vibe: false,
		precise: false,
		inpaint: "nai-diffusion-5-full-inpainting",
		alpha: true
	},
	{
		id: "nai-diffusion-5-curated",
		label: "V5 Curated",
		family: 5,
		characters: 22,
		vibe: false,
		precise: false,
		inpaint: "nai-diffusion-4-5-curated-inpainting",
		alpha: true
	},
	{
		id: "nai-diffusion-4-5-full",
		label: "V4.5 Full",
		family: 4.5,
		characters: 6,
		vibe: true,
		precise: true,
		inpaint: "nai-diffusion-4-5-full-inpainting",
		alpha: false
	},
	{
		id: "nai-diffusion-4-5-curated",
		label: "V4.5 Curated",
		family: 4.5,
		characters: 6,
		vibe: true,
		precise: true,
		inpaint: "nai-diffusion-4-5-curated-inpainting",
		alpha: false
	},
	{
		id: "nai-diffusion-4-full",
		label: "V4 Full",
		family: 4,
		characters: 6,
		vibe: true,
		precise: false,
		inpaint: "nai-diffusion-4-full-inpainting",
		alpha: false
	},
	{
		id: "nai-diffusion-4-curated-preview",
		label: "V4 Curated",
		family: 4,
		characters: 6,
		vibe: true,
		precise: false,
		inpaint: "nai-diffusion-4-curated-inpainting",
		alpha: false
	},
	{
		id: "nai-diffusion-3",
		label: "V3 Anime",
		family: 3,
		characters: 0,
		vibe: true,
		precise: false,
		inpaint: "nai-diffusion-3-inpainting",
		alpha: false
	},
	{
		id: "nai-diffusion-furry-3",
		label: "V3 Furry",
		family: 3,
		characters: 0,
		vibe: true,
		precise: false,
		inpaint: "nai-diffusion-furry-3-inpainting",
		alpha: false
	}
];
function modelInfo(id) {
	const exact = MODELS.find((model) => model.id === id);
	if (exact) return exact;
	const inpaint = MODELS.find((model) => model.inpaint === id && `${model.id}-inpainting` === id) ?? MODELS.findLast((model) => model.inpaint === id);
	if (!inpaint) throw new Error(`未知模型 ${id}。使用 novelai_capabilities 查询支持的模型。`);
	return inpaint;
}
function resolveGenerationModel(requested, action) {
	const base = modelInfo(requested);
	const targetId = action === "infill" ? requested.endsWith("-inpainting") ? requested : base.inpaint : requested;
	return {
		targetId,
		model: modelInfo(targetId)
	};
}
function isPlainRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finiteNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
/**
* 解析并校验 NovelAI `/user/subscription` 响应体。
*/
function parseAccountSubscription(raw) {
	if (!isPlainRecord(raw) || typeof raw.active !== "boolean" || !isPlainRecord(raw.trainingStepsLeft)) throw new Error("NovelAI 账户响应格式不正确");
	const monthlyRaw = finiteNumber(raw.trainingStepsLeft.fixedTrainingStepsLeft);
	const paidRaw = finiteNumber(raw.trainingStepsLeft.purchasedTrainingSteps);
	if (monthlyRaw === void 0 || paidRaw === void 0) throw new Error("NovelAI 账户响应缺少有效的 Anlas 点数字段");
	const monthly = Math.max(0, Math.round(monthlyRaw));
	const paid = Math.max(0, Math.round(paidRaw));
	const tierRaw = finiteNumber(raw.tier);
	const tier = tierRaw !== void 0 ? Math.max(0, Math.trunc(tierRaw)) : 0;
	const expiresRaw = finiteNumber(raw.expiresAt);
	const expiresAt = expiresRaw !== void 0 && expiresRaw > 0 ? Math.trunc(expiresRaw) : null;
	let usage = null;
	if (isPlainRecord(raw.usage)) {
		const percentRaw = finiteNumber(raw.usage.percent);
		if (percentRaw !== void 0) {
			const isNegative = raw.usage.isNegative === true || percentRaw < 0;
			const normalizedPercent = isNegative ? 0 : Math.max(0, Math.min(100, Math.round(percentRaw * 10) / 10));
			const purchasedRaw = finiteNumber(raw.usage.purchasedPercent) ?? 0;
			const nextRaw = finiteNumber(raw.usage.timeUntilNextPercent) ?? 0;
			usage = {
				percent: normalizedPercent,
				rawPercent: Math.round(percentRaw * 10) / 10,
				purchasedPercent: Math.max(0, Math.round(purchasedRaw * 10) / 10),
				isNegative,
				timeUntilNextPercent: Math.max(0, Math.round(nextRaw))
			};
		}
	}
	return {
		active: raw.active,
		tier,
		expiresAt,
		anlas: {
			monthly,
			paid,
			total: monthly + paid
		},
		usage
	};
}
// src/node/account.ts
const DEFAULT_DEBOUNCE_MS = 450;
const DEFAULT_STALE_MS = 3e5;
function createAccountTracker(options) {
	const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
	const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
	const now = options.now ?? Date.now;
	let disposed = false;
	let initialized = false;
	let epoch = 0;
	let activeController = null;
	let inFlight = null;
	let debounceTimer = null;
	let snapshot = {
		configured: false,
		data: null,
		fetchedAt: null,
		error: null,
		refreshing: false,
		activitySeq: 0
	};
	function clearDebounce() {
		if (debounceTimer !== null) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
	}
	function abortActive() {
		if (activeController !== null) {
			activeController.abort();
			activeController = null;
		}
		inFlight = null;
	}
	async function runRefresh() {
		if (disposed) return snapshot;
		const currentEpoch = epoch;
		let configured = false;
		try {
			configured = await options.isConfigured();
		} catch (error) {
			if (disposed || currentEpoch !== epoch) return snapshot;
			initialized = true;
			snapshot = {
				...snapshot,
				configured: false,
				data: null,
				fetchedAt: null,
				error: error instanceof Error ? error.message : String(error),
				refreshing: false
			};
			return snapshot;
		}
		if (disposed || currentEpoch !== epoch) return snapshot;
		if (!configured) {
			initialized = true;
			snapshot = {
				configured: false,
				data: null,
				fetchedAt: null,
				error: null,
				refreshing: false,
				activitySeq: snapshot.activitySeq
			};
			return snapshot;
		}
		const controller = new AbortController();
		activeController = controller;
		snapshot = {
			...snapshot,
			configured: true,
			refreshing: true
		};
		try {
			const raw = await options.fetchSubscription(controller.signal);
			if (disposed || currentEpoch !== epoch) return snapshot;
			const parsed = parseAccountSubscription(raw);
			initialized = true;
			snapshot = {
				configured: true,
				data: parsed,
				fetchedAt: now(),
				error: null,
				refreshing: false,
				activitySeq: snapshot.activitySeq
			};
			return snapshot;
		} catch (error) {
			if (disposed || currentEpoch !== epoch) return snapshot;
			initialized = true;
			snapshot = {
				...snapshot,
				configured: true,
				error: error instanceof Error ? error.message : String(error),
				refreshing: false
			};
			return snapshot;
		} finally {
			if (activeController === controller) activeController = null;
		}
	}
	function refresh() {
		if (disposed) return Promise.resolve(snapshot);
		clearDebounce();
		if (inFlight !== null) return inFlight;
		const task = runRefresh().finally(() => {
			if (inFlight === task) inFlight = null;
		});
		inFlight = task;
		return task;
	}
	async function getOrRefresh() {
		if (disposed) return snapshot;
		if (inFlight !== null) return inFlight;
		if (!initialized) return refresh();
		if (snapshot.configured && snapshot.data === null && !snapshot.refreshing) return refresh();
		if (snapshot.configured && snapshot.fetchedAt !== null && now() - snapshot.fetchedAt >= staleMs) return refresh();
		return snapshot;
	}
	function recordSubscription(raw) {
		const parsed = parseAccountSubscription(raw);
		initialized = true;
		snapshot = {
			configured: true,
			data: parsed,
			fetchedAt: now(),
			error: null,
			refreshing: inFlight !== null,
			activitySeq: snapshot.activitySeq
		};
		return snapshot;
	}
	function notifyQuotaUsed() {
		if (disposed) return;
		snapshot = {
			...snapshot,
			activitySeq: snapshot.activitySeq + 1
		};
		clearDebounce();
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			refresh();
		}, debounceMs);
		if (typeof debounceTimer.unref === "function") debounceTimer.unref();
	}
	async function handleCredentialChange() {
		if (disposed) return snapshot;
		epoch += 1;
		clearDebounce();
		abortActive();
		snapshot = {
			configured: false,
			data: null,
			fetchedAt: null,
			error: null,
			refreshing: false,
			activitySeq: snapshot.activitySeq + 1
		};
		return refresh();
	}
	function dispose() {
		disposed = true;
		epoch += 1;
		clearDebounce();
		abortActive();
	}
	return {
		get: () => snapshot,
		getOrRefresh,
		refresh,
		recordSubscription,
		notifyQuotaUsed,
		handleCredentialChange,
		dispose
	};
}
// src/node/api.ts
const IMAGE_ACCEPT = "application/json, application/zip, image/png, image/webp, */*;q=0.8";
const BINARY_ACCEPT = "application/octet-stream, application/json;q=0.9, */*;q=0.8";
var NovelAIClient = class {
	token;
	timeoutSeconds;
	origin;
	constructor(token, timeoutSeconds, origin = API_ORIGIN) {
		this.token = token;
		this.timeoutSeconds = timeoutSeconds;
		this.origin = origin;
	}
	async request(path, payload, signal, accept = "application/json") {
		const token = await this.token();
		const response = await fetch(new URL(path, this.origin), {
			method: payload === void 0 ? "GET" : "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				...payload === void 0 ? {} : { "Content-Type": "application/json" },
				Accept: accept,
				"User-Agent": "dsh-novelai/0.1.0"
			},
			...payload === void 0 ? {} : { body: JSON.stringify(payload) },
			signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutSeconds() * 1e3)]),
			redirect: "error"
		});
		if (!response.ok) {
			const body = (await response.text()).replaceAll(token, "[redacted]").slice(0, 2e3);
			throw new Error(`NovelAI HTTP ${response.status}: ${body}`);
		}
		return response;
	}
	async json(path, payload, signal) {
		return await (await this.request(path, payload, signal, "application/json")).json();
	}
	async binary(path, payload, signal) {
		const response = await this.request(path, payload, signal, BINARY_ACCEPT);
		return Buffer.from(await response.arrayBuffer());
	}
	async images(path, payload, signal) {
		const response = await this.request(path, payload, signal, IMAGE_ACCEPT);
		return decodeImages(Buffer.from(await response.arrayBuffer()), response.headers.get("content-type") ?? "");
	}
};
async function decodeImages(bytes, contentType) {
	if (!bytes.length) throw new Error("NovelAI 返回了空图片结果");
	let images;
	if (contentType.includes("json") || bytes[0] === 123) {
		const result = JSON.parse(bytes.toString("utf8"));
		if (!result || typeof result !== "object" || !("images" in result) || !Array.isArray(result.images)) throw new Error("NovelAI 未返回 images 数组");
		images = result.images.map((item) => {
			if (!item || typeof item !== "object" || !("image" in item) || typeof item.image !== "string") throw new Error("NovelAI 图片结果格式错误");
			const seed = "seed" in item && typeof item.seed === "number" ? item.seed : void 0;
			return {
				data: Buffer.from(item.image, "base64"),
				...seed === void 0 ? {} : { seed }
			};
		});
	} else if (bytes[0] === 80 && bytes[1] === 75) images = Object.entries(unzipSync(bytes)).filter(([name]) => /\.(?:png|webp|jpe?g)$/i.test(name)).map(([, data]) => ({ data: Buffer.from(data) }));
	else images = [{ data: bytes }];
	if (!images.length) throw new Error("NovelAI 返回了空图片结果");
	for (const image of images) {
		const info = await sharp(image.data).metadata();
		if (!info.width || !info.height) throw new Error("NovelAI 返回的图片无法解码");
	}
	return images;
}
// src/node/skill.ts
const SKILL_NAME = "novelai-v5-prompt";
const REQUIRED_FILES = [
	"SKILL.md",
	"references/prompt-syntax.md",
	"references/tools.md"
];
function resolveSkillDirectory() {
	for (const rel of ["../assets/novelai-v5-prompt", "../../assets/novelai-v5-prompt"]) {
		const candidate = fileURLToPath(new URL(rel, import.meta.url));
		if (existsSync(join(candidate, "SKILL.md"))) return candidate;
	}
	return fileURLToPath(new URL("../assets/novelai-v5-prompt", import.meta.url));
}
function parseSkillDocument(raw, filePath) {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw);
	if (!match?.[1]) throw new Error(`dsh-novelai: ${filePath} 缺少 YAML frontmatter`);
	const fields = {};
	for (const line of match[1].split(/\r?\n/u)) {
		const entry = /^([A-Za-z0-9_-]+):\s*(.+?)\s*$/u.exec(line);
		if (!entry) continue;
		fields[entry[1]] = entry[2].replace(/^(['"])([\s\S]*)\1$/u, "$2");
	}
	if (!fields.name) throw new Error(`dsh-novelai: ${filePath} 缺少 name 字段`);
	if (!fields.description) throw new Error(`dsh-novelai: ${filePath} 缺少 description 字段`);
	return {
		name: fields.name,
		description: fields.description,
		content: raw.slice(match[0].length).trimStart()
	};
}
function registerSkill(ctx) {
	const directoryNative = resolveSkillDirectory();
	for (const rel of REQUIRED_FILES) {
		const target = join(directoryNative, rel);
		if (!statSync(target).isFile()) throw new Error(`dsh-novelai: 缺少内置 Skill 资源文件 ${target}`);
	}
	const directory = directoryNative.replaceAll("\\", "/").replace(/\/+$/u, "");
	const skillPath = `${directory}/SKILL.md`;
	const parsed = parseSkillDocument(readFileSync(join(directoryNative, "SKILL.md"), "utf8"), skillPath);
	if (parsed.name !== SKILL_NAME) throw new Error(`dsh-novelai: SKILL.md 名称不匹配 (${parsed.name})`);
	const candidate = {
		name: parsed.name,
		description: parsed.description,
		invocation: {
			modelInvocable: true,
			userInvocable: true
		},
		provider: "dsh-novelai",
		source: "bundled",
		rank: BUNDLED_SKILL_RANK,
		resourceBase: {
			kind: "directory",
			path: directory
		},
		path: skillPath,
		locator: skillPath
	};
	ctx.skills.registerProvider(() => ({
		name: "dsh-novelai",
		list: async () => [candidate],
		get: async (_candidate, options) => {
			const { rank: _rank, locator: _locator, ...summary } = candidate;
			const text = await readFile(join(directoryNative, "SKILL.md"), {
				encoding: "utf8",
				signal: options.signal
			});
			return {
				...summary,
				content: parseSkillDocument(text, skillPath).content
			};
		}
	}));
}
// src/generated/api.json
var definitions$1 = {
	"image.RequestParameters": {
		"type": "object",
		"properties": {
			"add_original_image": { "type": "boolean" },
			"cfg_rescale": { "type": "number" },
			"color_correct": { "type": "boolean" },
			"controlnet_condition": {
				"description": "used by ControlNet",
				"type": "string"
			},
			"controlnet_model": { "type": "string" },
			"controlnet_strength": { "type": "number" },
			"deliberate_euler_ancestral_bug": {
				"description": "(Summer Sampler update) add ancestral noise even on the final step of sampling, despite the fact we're not going to run the denoiser again, default true (maintaining bug-for-bug compatibility)",
				"type": "boolean"
			},
			"director_reference_descriptions": {
				"description": "For CR: set `caption` with a `base_caption` of `\"character\"` or `\"character&style\"`",
				"type": "array",
				"items": { "$ref": "#/definitions/image.V4ConditionInput" }
			},
			"director_reference_images": {
				"description": "For CR: 1024x1536 or 1536x1024 or 1472x1472 with black padding to fit",
				"type": "array",
				"items": { "type": "string" }
			},
			"director_reference_information_extracted": {
				"description": "For CR: 0-1",
				"type": "array",
				"items": { "type": "number" }
			},
			"director_reference_secondary_strength_values": {
				"description": "For CR: Maps to Fidelity slider (0-1)",
				"type": "array",
				"items": { "type": "number" }
			},
			"director_reference_strength_values": {
				"description": "API external name. 0-1",
				"type": "array",
				"items": { "type": "number" }
			},
			"dynamic_thresholding": { "type": "boolean" },
			"extra_noise_seed": { "type": "integer" },
			"height": { "type": "integer" },
			"image": { "type": "string" },
			"image_format": { "$ref": "#/definitions/image.ImageFormat" },
			"img2img": {
				"description": "used by inpaint",
				"allOf": [{ "$ref": "#/definitions/image.Img2ImgParams" }]
			},
			"legacy": { "type": "boolean" },
			"legacy_v3_extend": { "type": "boolean" },
			"mask": { "type": "string" },
			"n_samples": { "type": "integer" },
			"negative_prompt": { "type": "string" },
			"noise": { "type": "number" },
			"noise_schedule": { "type": "string" },
			"params_version": { "type": "integer" },
			"prefer_brownian": { "type": "boolean" },
			"prompt": { "type": "string" },
			"qualityToggle": { "type": "boolean" },
			"reference_image": { "type": "string" },
			"reference_image_multiple": {
				"type": "array",
				"items": { "type": "string" }
			},
			"reference_information_extracted": { "type": "number" },
			"reference_information_extracted_multiple": {
				"type": "array",
				"items": { "type": "number" }
			},
			"reference_strength": { "type": "number" },
			"reference_strength_multiple": {
				"type": "array",
				"items": { "type": "number" }
			},
			"sampler": { "type": "string" },
			"scale": { "type": "number" },
			"seed": { "type": "integer" },
			"skip_cfg_above_sigma": {
				"description": "(Summer Sampler update) triggers Variety Boost",
				"type": "number"
			},
			"sm": { "type": "boolean" },
			"sm_dyn": { "type": "boolean" },
			"steps": { "type": "number" },
			"straight_alpha": { "type": "boolean" },
			"stream": { "$ref": "#/definitions/image.StreamingType" },
			"strength": { "type": "number" },
			"tag_hint_qt": { "type": "integer" },
			"tag_hint_transparent_background": {
				"description": "Pure pass-through hint for the model: the prompt is asking for a transparent\nbackground. Omegalaser does not interpret it.",
				"type": "boolean"
			},
			"tag_hint_uc_preset": { "type": "integer" },
			"ucPreset": { "type": "integer" },
			"upscale": { "$ref": "#/definitions/image.UpscaleParams" },
			"upscaled_enhance": { "type": "boolean" },
			"v4_negative_prompt": { "$ref": "#/definitions/image.V4ConditionInput" },
			"v4_prompt": { "$ref": "#/definitions/image.V4ConditionInput" },
			"width": { "type": "integer" }
		}
	},
	"image.V4ConditionInput": {
		"type": "object",
		"properties": {
			"caption": { "$ref": "#/definitions/image.V4ExternalCaption" },
			"legacy_uc": { "type": "boolean" },
			"use_coords": { "type": "boolean" },
			"use_order": { "type": "boolean" }
		}
	},
	"image.V4ExternalCaption": {
		"type": "object",
		"properties": {
			"base_caption": { "type": "string" },
			"char_captions": {
				"type": "array",
				"items": { "$ref": "#/definitions/image.V4ExternalCharacterCaption" }
			}
		}
	},
	"image.V4ExternalCharacterCaption": {
		"type": "object",
		"properties": {
			"centers": {
				"type": "array",
				"items": { "$ref": "#/definitions/image.Coordinates" }
			},
			"char_caption": { "type": "string" }
		}
	},
	"image.Coordinates": {
		"type": "object",
		"properties": {
			"x": { "type": "number" },
			"y": { "type": "number" }
		}
	},
	"image.ImageFormat": {
		"type": "string",
		"enum": ["png", "webp"],
		"x-enum-varnames": ["ImageFormatPNG", "ImageFormatWEBP"]
	},
	"image.Img2ImgParams": {
		"type": "object",
		"properties": {
			"color_correct": { "type": "boolean" },
			"extra_noise_seed": { "type": "integer" },
			"noise": { "type": "number" },
			"strength": { "type": "number" }
		}
	},
	"image.StreamingType": {
		"type": "string",
		"enum": ["msgpack", "sse"],
		"x-enum-varnames": ["StreamingTypeMsgpack", "StreamingTypeSSE"]
	},
	"image.UpscaleParams": {
		"type": "object",
		"properties": { "declared_blur_sigma": {
			"description": "round it to one of these values: [0.0, 0.30, 0.35, 0.40, 0.45, 0.50]",
			"type": "number"
		} }
	},
	"image.AugmentImageRequest": {
		"type": "object",
		"properties": {
			"defry": { "type": "integer" },
			"height": { "type": "integer" },
			"image": { "type": "string" },
			"prompt": { "type": "string" },
			"req_type": { "type": "string" },
			"width": { "type": "integer" }
		}
	},
	"image.UpscaleRequest": {
		"type": "object",
		"properties": {
			"declared_blur_sigma": {
				"description": "same param as generation param",
				"type": "number"
			},
			"image": {
				"description": "can be given as base64 or as multipart pointer",
				"type": "string"
			},
			"model": {
				"description": "must be an existing image model API name",
				"type": "string"
			}
		}
	},
	"image.EncodeVibeRequest": {
		"type": "object",
		"properties": {
			"crop_to_mask": {
				"description": "Whether to crop the image to the bounding box of the mask's visible area (if a mask is provided)",
				"type": "boolean"
			},
			"focus_seed": {
				"description": "seed used for random choice of which areas of the image to give a closer look to. leave unspecified to use a deterministic seed chosen based on the image content (recommended).",
				"type": "integer"
			},
			"image": {
				"description": "base64 encoded image",
				"type": "string"
			},
			"info_extract_seed": {
				"description": "seed used for random noising out of the image's information (to extent specified by information_extracted). leave unspecified to use a deterministic seed chosen based on the image content (recommended)",
				"type": "integer"
			},
			"information_extracted": {
				"type": "number",
				"maximum": 1,
				"minimum": 0
			},
			"mask": {
				"description": "Base64 encoded mask to be applied to the image",
				"type": "string"
			},
			"model": { "type": "string" }
		}
	}
};
// src/node/schema.ts
const definitions = definitions$1;
function apiSchema(name) {
	return convert(definitions[name]);
}
function convert(schema) {
	if (schema.$ref) return convert(definitions[schema.$ref.replace("#/definitions/", "")]);
	if (schema.allOf) return convert(schema.allOf[0]);
	const description = schema.description ? { description: schema.description } : {};
	if (schema.type === "object") return {
		type: "object",
		additionalProperties: false,
		properties: Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, value]) => [key, convert(value)])),
		...description
	};
	if (schema.type === "array") return {
		type: "array",
		items: convert(schema.items),
		...description
	};
	if (schema.type === "string") return {
		type: "string",
		...schema.enum ? { enum: schema.enum } : {},
		...description
	};
	if (schema.type === "integer" || schema.type === "number" || schema.type === "boolean") return {
		type: schema.type,
		...description
	};
	throw new Error(`未支持的官方 schema：${JSON.stringify(schema)}`);
}
const generationParameters = apiSchema("image.RequestParameters");
delete generationParameters.properties.stream;
const API_DEFINITIONS = definitions$1;
const text = (description) => ({
	type: "string",
	description
});
const number = (description) => ({
	type: "number",
	description
});
const integer = (description) => ({
	type: "integer",
	description
});
const bool = (description) => ({
	type: "boolean",
	description
});
const object = (properties) => ({
	type: "object",
	additionalProperties: false,
	properties
});
const array = (items) => ({
	type: "array",
	items
});
// src/node/storage.ts
function formatImageMarkdown(label, filePath) {
	return `![${label}](<${filePath.replaceAll("\\", "/").replace(/[%#?<>]/gu, (ch) => encodeURIComponent(ch))}>)`;
}
async function saveImages(images, cwd, directory, metadata, signal, policy) {
	if (!directory.trim()) throw new Error("outputDirectory 不能为空");
	const folder = resolve(cwd, directory, `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
	await assertWritablePaths([folder], policy);
	await mkdir(folder, { recursive: true });
	const saved = [];
	for (const [index, image] of images.entries()) {
		const info = await sharp(image.data).metadata();
		const path = join(folder, `${String(index + 1).padStart(2, "0")}.${info.format === "webp" ? "webp" : info.format === "jpeg" ? "jpg" : "png"}`);
		await writeFile(path, image.data, {
			signal,
			flag: "wx"
		});
		saved.push({
			path,
			width: info.width,
			height: info.height,
			...image.seed === void 0 ? {} : { seed: image.seed },
			markdown: formatImageMarkdown(`NovelAI 图片 ${index + 1}`, path)
		});
	}
	const metadata_path = join(folder, "generation.json");
	const result = {
		images: saved,
		metadata_path,
		...typeof metadata.model === "string" ? { model: metadata.model } : {}
	};
	await writeFile(metadata_path, JSON.stringify({
		created_at: (/* @__PURE__ */ new Date()).toISOString(),
		...metadata,
		...result
	}, null, 2) + "\n", {
		signal,
		flag: "wx"
	});
	return result;
}
function safeMetadata(input) {
	if (Array.isArray(input)) return input.map(safeMetadata);
	if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, /^(?:image|mask|reference_image|reference_image_multiple|director_reference_images|controlnet_condition)$/u.test(key) ? "[binary omitted]" : safeMetadata(value)]));
	return input;
}
function canonicalTargetSync(targetPath) {
	const absolute = resolve(targetPath);
	const suffix = [];
	let cursor = absolute;
	while (true) try {
		const physical = realpathSync.native(cursor);
		return suffix.length ? join(physical, ...suffix.reverse()) : physical;
	} catch (error) {
		const code = error.code;
		if (code !== "ENOENT" && code !== "ENOTDIR") return absolute;
		const parent = dirname(cursor);
		if (parent === cursor) return absolute;
		suffix.push(cursor.slice(parent.endsWith(sep) ? parent.length : parent.length + 1));
		cursor = parent;
	}
}
function resolveAdditionalRoot(root) {
	const physical = realpathSync.native(root);
	if (!statSync(physical).isDirectory()) throw new Error(`无效的额外可写目录 ${root}：目标不是目录`);
	if (physical !== resolve(root)) throw new Error(`无效的额外可写目录 ${root}：不支持符号链接目录授权`);
	return physical;
}
async function statIfPresent(path) {
	try {
		return await stat(path, { bigint: true });
	} catch (error) {
		const code = error.code;
		if (code === "ENOENT" || code === "ENOTDIR") return void 0;
		throw error;
	}
}
async function isPathUnder(target, root) {
	const caseSensitive = process.platform !== "win32";
	const left = caseSensitive ? target : target.toLowerCase();
	const right = caseSensitive ? root : root.toLowerCase();
	if (left === right || left.startsWith(right.endsWith(sep) ? right : right + sep)) return true;
	const rootStat = await statIfPresent(root);
	if (!rootStat) return false;
	let cursor = target;
	while (true) {
		const info = await statIfPresent(cursor);
		if (info && info.dev === rootStat.dev && info.ino === rootStat.ino) return true;
		const parent = dirname(cursor);
		if (parent === cursor) return false;
		cursor = parent;
	}
}
async function assertWritablePaths(paths, policy) {
	if (!policy || policy.mode === "danger-full-access") return;
	if (policy.mode === "read-only") throw new Error("[sandbox: read-only] 当前会话处于只读（read-only）模式，禁止保存生成的图片或缓存文件。请先切换会话权限后再执行。");
	const roots = [
		canonicalTargetSync(policy.workspaceRoot),
		...(policy.additionalWritableRoots ?? []).map(resolveAdditionalRoot),
		canonicalTargetSync(tmpdir()),
		...process.platform === "win32" ? [] : [canonicalTargetSync("/tmp")]
	];
	for (const rawPath of paths) {
		const canonical = canonicalTargetSync(rawPath);
		let allowed = false;
		for (const root of roots) if (await isPathUnder(canonical, root)) {
			allowed = true;
			break;
		}
		if (!allowed) throw new Error(`[sandbox: workspace-write] 输出目录 "${rawPath}" 超出当前会话允许写入的工作区范围（${policy.workspaceRoot}）。`);
	}
}
// src/node/generation.ts
const MAX_DIMENSION = 2048;
const MAX_AUTO_AREA = 3145728;
const MAX_STEPS = 50;
const MAX_SAMPLES = 8;
async function normalizeImage(bytes) {
	const meta = await sharp(bytes).metadata();
	if (!meta.width || !meta.height) throw new Error("输入图片缺少有效宽高信息");
	if (meta.orientation && meta.orientation > 1) {
		const { data, info } = await sharp(bytes).rotate().png().toBuffer({ resolveWithObject: true });
		return {
			data,
			width: info.width,
			height: info.height
		};
	}
	return {
		data: bytes,
		width: meta.width,
		height: meta.height
	};
}
function fitCanvasSize(width, height) {
	const scale = Math.min(1, MAX_DIMENSION / width, MAX_DIMENSION / height, Math.sqrt(MAX_AUTO_AREA / (width * height)));
	return {
		width: Math.min(MAX_DIMENSION, Math.max(64, Math.round(width * scale / 64) * 64)),
		height: Math.min(MAX_DIMENSION, Math.max(64, Math.round(height * scale / 64) * 64))
	};
}
function validateBlurSigma(value) {
	if (typeof value !== "number" || !BLUR_SIGMA_VALUES.includes(value)) throw new Error(`declared_blur_sigma 必须为 ${BLUR_SIGMA_VALUES.join("、")} 之一`);
	return value;
}
async function generationPayload(args, defaultModel, read, encode) {
	if (!args.prompt.trim()) throw new Error("prompt 不能为空");
	const requested = args.model ?? defaultModel;
	const action = args.action === "enhance" ? "img2img" : args.action ?? "generate";
	const { targetId, model } = resolveGenerationModel(requested, action);
	const p = {
		params_version: model.family >= 5 ? 4 : 3,
		width: 1024,
		height: 1024,
		steps: 28,
		scale: 6,
		sampler: "k_euler_ancestral",
		noise_schedule: "karras",
		seed: randomInt(0, 2 ** 32),
		n_samples: 1,
		image_format: "png",
		negative_prompt: args.negative_prompt ?? "",
		cfg_rescale: 0,
		deliberate_euler_ancestral_bug: false,
		prefer_brownian: true,
		...args.parameters
	};
	delete p.stream;
	if (args.image_path) {
		const normalized = await normalizeImage(await read(args.image_path));
		const fitted = fitCanvasSize(normalized.width, normalized.height);
		p.width = args.parameters?.width ?? fitted.width;
		p.height = args.parameters?.height ?? fitted.height;
		for (const name of ["width", "height"]) validateDimension(name, p[name]);
		p.image = (await sharp(normalized.data).resize(p.width, p.height, { fit: "fill" }).png().toBuffer()).toString("base64");
	}
	for (const name of ["width", "height"]) validateDimension(name, p[name]);
	if (typeof p.steps !== "number" || !Number.isInteger(p.steps) || p.steps < 1 || p.steps > MAX_STEPS) throw new Error(`steps 必须为 1..${MAX_STEPS} 的整数`);
	if (typeof p.n_samples !== "number" || !Number.isInteger(p.n_samples) || p.n_samples < 1 || p.n_samples > MAX_SAMPLES) throw new Error(`n_samples 必须为 1..${MAX_SAMPLES} 的整数`);
	if (typeof p.seed !== "number" || !Number.isInteger(p.seed) || p.seed < 0 || p.seed >= 2 ** 32) throw new Error("seed 必须位于 0..4294967295");
	if (typeof p.scale !== "number" || !Number.isFinite(p.scale) || p.scale <= 0) throw new Error("scale 必须大于 0");
	if (p.upscale && typeof p.upscale === "object" && !Array.isArray(p.upscale) && "declared_blur_sigma" in p.upscale && p.upscale.declared_blur_sigma !== void 0) validateBlurSigma(p.upscale.declared_blur_sigma);
	if (args.negative_prompt !== void 0) p.negative_prompt = args.negative_prompt;
	if (args.mask_path) {
		const normalizedMask = await normalizeImage(await read(args.mask_path));
		p.mask = (await sharp(normalizedMask.data).flatten({ background: "#000" }).greyscale().resize(p.width, p.height, {
			fit: "fill",
			kernel: "nearest"
		}).png().toBuffer()).toString("base64");
	}
	if (action !== "generate" && !p.image) throw new Error(`${action} 需要 image_path`);
	if (action === "infill" && !p.mask) throw new Error("局部重绘需要 mask_path（白色重绘、黑色保留）");
	if (action === "img2img") {
		p.strength = range("strength", typeof p.strength === "number" ? p.strength : args.action === "enhance" ? .2 : .7);
		p.noise = range("noise", typeof p.noise === "number" ? p.noise : args.action === "enhance" ? 0 : .2);
	} else if (action === "infill") {
		const strength = range("strength", typeof p.strength === "number" ? p.strength : 1);
		const noise = range("noise", typeof p.noise === "number" ? p.noise : 0);
		p.strength = strength;
		p.noise = noise;
		p.add_original_image ??= true;
		p.color_correct ??= true;
		const rawImg2Img = p.img2img && typeof p.img2img === "object" && !Array.isArray(p.img2img) ? p.img2img : {};
		p.img2img = {
			strength,
			noise,
			color_correct: Boolean(p.color_correct),
			...rawImg2Img
		};
	}
	if (args.characters?.length && (args.parameters?.v4_prompt || args.parameters?.v4_negative_prompt)) throw new Error("不能同时传入顶层 characters 与原始 parameters.v4_prompt / v4_negative_prompt");
	if (model.family >= 4) {
		if (!p.v4_prompt || !p.v4_negative_prompt) {
			const characters = args.characters ?? [];
			if (characters.length > model.characters) throw new Error(`${model.label} 最多支持 ${model.characters} 个角色提示词`);
			const use_coords = args.use_coords ?? characters.some((character) => character.positions?.length);
			for (const character of characters) for (const pos of character.positions ?? []) {
				range("角色 x", pos.x);
				range("角色 y", pos.y);
			}
			const caption = (negative) => ({
				base_caption: negative ? p.negative_prompt : args.prompt,
				char_captions: characters.map((character) => ({
					char_caption: negative ? character.negative_prompt ?? "" : character.prompt,
					centers: character.positions?.length ? character.positions : [{
						x: .5,
						y: .5
					}]
				}))
			});
			p.v4_prompt ??= {
				caption: caption(false),
				use_coords: Boolean(use_coords),
				use_order: true
			};
			p.v4_negative_prompt ??= {
				caption: caption(true),
				legacy_uc: false
			};
		}
	} else if (args.characters?.length) throw new Error("独立角色提示词需要 V4 或更高模型");
	const hasVibes = Boolean(args.vibes?.length || p.reference_image || p.reference_image_multiple?.length);
	const hasReferences = Boolean(args.references?.length || p.director_reference_images?.length);
	if (hasVibes && !model.vibe) throw new Error(`${model.label} 尚不支持 Vibe Transfer，请显式选择 V4.5/V4/V3`);
	if (hasReferences && !model.precise) throw new Error("Precise Reference 当前只支持 V4.5 模型，请显式指定模型");
	if (hasVibes && hasReferences) throw new Error("NovelAI 当前不支持同时使用 Vibe Transfer 与 Precise Reference");
	if (args.vibes?.length) {
		if (args.vibes.length > 16) throw new Error("最多支持 16 个 Vibe");
		const baseVibeModel = model.id;
		const encoded = await Promise.all(args.vibes.map(async (vibe) => {
			if (model.family >= 4) return encode(vibe, baseVibeModel);
			if (!vibe.image_path) throw new Error("V3 Vibe 需要原始 image_path");
			return {
				encoding: (await normalizeImage(await read(vibe.image_path))).data.toString("base64"),
				information_extracted: vibe.information_extracted ?? 1,
				model: baseVibeModel
			};
		}));
		p.reference_image_multiple = encoded.map((vibe) => vibe.encoding);
		p.reference_information_extracted_multiple = encoded.map((vibe) => range("information_extracted", vibe.information_extracted));
		p.reference_strength_multiple = args.vibes.map((vibe) => range("Vibe strength", vibe.strength ?? .6));
	}
	if (args.references?.length) {
		p.director_reference_images = await Promise.all(args.references.map(async (reference) => (await prepareReference(await read(reference.image_path))).toString("base64")));
		p.director_reference_descriptions = args.references.map((reference) => ({ caption: {
			base_caption: reference.type ?? "character",
			char_captions: []
		} }));
		p.director_reference_information_extracted = args.references.map((reference) => range("information_extracted", reference.information_extracted ?? 1));
		p.director_reference_strength_values = args.references.map((reference) => range("reference strength", reference.strength ?? 1));
		p.director_reference_secondary_strength_values = args.references.map((reference) => 1 - range("fidelity", reference.fidelity ?? 1));
	}
	if (model.family >= 5) {
		if (p.sm || p.sm_dyn || p.dynamic_thresholding || p.skip_cfg_above_sigma || p.controlnet_model) throw new Error("V5 不支持 SMEA、Decrisper、Variety+ 或 ControlNet；请使用支持这些选项的模型");
		if (p.noise_schedule !== "karras") throw new Error("V5 的 noise_schedule 需要使用 karras");
	}
	return {
		input: args.prompt,
		model: targetId,
		action,
		parameters: p
	};
}
async function prepareReference(data) {
	const normalized = await normalizeImage(data);
	const ratio = normalized.width / normalized.height;
	const size = [
		[1024, 1536],
		[1472, 1472],
		[1536, 1024]
	].sort((a, b) => Math.abs(Math.log(ratio / (a[0] / a[1]))) - Math.abs(Math.log(ratio / (b[0] / b[1]))))[0];
	return sharp(normalized.data).flatten({ background: "#000" }).resize(size[0], size[1], {
		fit: "contain",
		background: "#000"
	}).png().toBuffer();
}
async function encodeVibe(client, data, model, information, cacheDirectory, signal, options = {}, policy) {
	const info = modelInfo(model);
	if (model.endsWith("-inpainting") || !info.vibe || info.family < 4) throw new Error("独立 Vibe 编码需要基础 V4/V4.5 模型；V3 直接使用原图，V5 暂不支持 Vibe");
	range("information_extracted", information);
	const normalized = await normalizeImage(data);
	const hash = createHash("sha256").update(normalized.data).update(JSON.stringify({
		model,
		information,
		options
	})).digest("hex");
	const path = join(cacheDirectory, `${hash}.nai-vibe.json`);
	try {
		return {
			path,
			value: parseVibe(await readFile(path, "utf8"), model, information),
			cached: true
		};
	} catch (error) {
		if (!(error.code === "ENOENT" || error instanceof SyntaxError || error instanceof Error && error.message.startsWith("Vibe "))) throw error;
	}
	await assertWritablePaths([cacheDirectory], policy);
	const encoding = (await client.binary("/ai/encode-vibe", {
		...options,
		image: normalized.data.toString("base64"),
		model,
		information_extracted: information
	}, signal)).toString("base64");
	if (!encoding.length) throw new Error("NovelAI 返回空 Vibe 编码");
	const value = {
		model,
		information_extracted: information,
		encoding
	};
	await assertWritablePaths([cacheDirectory], policy);
	await mkdir(cacheDirectory, { recursive: true });
	const tempPath = `${path}.${randomUUID().slice(0, 8)}.tmp`;
	try {
		await writeFile(tempPath, JSON.stringify(value) + "\n", {
			signal,
			flag: "wx"
		});
		await rename(tempPath, path);
	} catch (error) {
		await rm(tempPath, { force: true }).catch(() => void 0);
		throw error;
	}
	return {
		path,
		value,
		cached: false
	};
}
function parseVibe(text, model, information) {
	const value = JSON.parse(text);
	if (!value || typeof value !== "object" || !("model" in value) || value.model !== model || !("encoding" in value) || typeof value.encoding !== "string" || !value.encoding.length || !("information_extracted" in value) || typeof value.information_extracted !== "number") throw new Error("Vibe 缓存格式或模型不匹配");
	if (information !== void 0 && value.information_extracted !== information) throw new Error("Vibe information_extracted 与缓存不匹配，需要重新编码");
	return value;
}
function validateDimension(name, value) {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 64 || value > MAX_DIMENSION || value % 64 !== 0) throw new Error(`${name} 必须是 64..${MAX_DIMENSION} 之间的 64 倍数`);
}
function range(name, value) {
	if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} 必须位于 0..1`);
	return value;
}
// src/node/tools.ts
function fileLocations(paths) {
	const unique = [...new Set(paths.filter((item) => Boolean(item?.trim())))];
	return unique.length ? unique.map((path) => ({ path })) : void 0;
}
function presentImageResult(baseTitle, result) {
	if (result.isError || !result.meta || typeof result.meta !== "object" || Array.isArray(result.meta)) return void 0;
	const meta = result.meta;
	const count = typeof meta.count === "number" ? meta.count : void 0;
	const size = typeof meta.size === "string" && meta.size ? meta.size : void 0;
	const model = typeof meta.model === "string" && meta.model ? meta.model : void 0;
	return {
		card: "generic",
		title: [
			baseTitle,
			count ? `${count} 张` : "",
			size ?? "",
			model ?? ""
		].filter(Boolean).join(" · ")
	};
}
function registerTools(ctx, client, settings, hooks) {
	const jsonOutput = {
		schema: { type: "json" },
		render: (_args, value) => [{
			type: "text",
			text: JSON.stringify(value)
		}]
	};
	const imageOutput = {
		schema: object({
			images: {
				type: "array",
				required: true,
				items: object({
					path: {
						...text("Saved local file path."),
						required: true
					},
					width: {
						...integer("Image width in pixels."),
						required: true
					},
					height: {
						...integer("Image height in pixels."),
						required: true
					},
					seed: integer("Generation seed when applicable."),
					markdown: {
						...text("Embeddable Markdown image syntax."),
						required: true
					}
				})
			},
			metadata_path: {
				...text("Saved generation.json path."),
				required: true
			},
			model: text("Effective NovelAI model ID.")
		}),
		render: (_args, value) => [{
			type: "text",
			text: JSON.stringify(value)
		}],
		presentationMeta: (_args, value) => {
			const data = value;
			const first = data.images[0];
			return {
				count: data.images.length,
				size: first ? `${first.width}×${first.height}` : "",
				...data.model ? { model: data.model } : {}
			};
		}
	};
	const vibeOutput = {
		schema: object({
			encoding_path: {
				...text("Saved .nai-vibe.json cache path."),
				required: true
			},
			cached: {
				...bool("Whether a cached encoding was reused."),
				required: true
			},
			model: {
				...text("Encoded Vibe model ID."),
				required: true
			},
			information_extracted: {
				...number("Information extracted value."),
				required: true
			}
		}),
		render: (_args, value) => [{
			type: "text",
			text: JSON.stringify(value)
		}]
	};
	function register(options) {
		const out = options.output ?? jsonOutput;
		ctx.tools.register(defineTool({
			name: options.name,
			description: options.description,
			parameters: options.parameters,
			output: out,
			...options.concurrencySafe ? { isConcurrencySafe: () => true } : {},
			...options.presentCall ? { presentCall: (args) => options.presentCall(args) } : {},
			...options.presentResult ? { presentResult: (args, result) => options.presentResult(args, result) } : {},
			execute: async (args, exec) => await options.execute(args, exec)
		}));
	}
	async function files(exec) {
		if (!exec.agent) throw new Error("此工具需要当前会话");
		const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
		const root = await ctx.fs.resolve(cwd, { signal: exec.signal });
		const local = ctx.fs.processPath(root);
		if (ctx.fs.processPathFromHostPath(local) === void 0) throw new Error("NovelAI 输出需要本机工作目录；当前文件系统未映射到 Host");
		const directory = settings().outputDirectory.trim();
		if (!directory) throw new Error("outputDirectory 不能为空");
		const policy = (typeof ctx.get === "function" ? ctx.get("sandboxPolicy") : void 0)?.resolve(exec.agent.session ? { session: exec.agent.session } : {});
		const outputRoot = resolve(local, directory);
		const cache = resolve(outputRoot, ".vibe-cache");
		await assertWritablePaths([outputRoot], policy);
		const read = async (path) => {
			const target = await ctx.fs.resolve(path, {
				cwd,
				signal: exec.signal
			});
			return Buffer.from(await ctx.fs.readBytes(target, exec.signal, 52428800));
		};
		const readImage = async (path) => {
			const bytes = await read(path);
			await sharp(bytes).metadata();
			return bytes;
		};
		return {
			cwd: local,
			directory,
			policy,
			read,
			readImage,
			cache
		};
	}
	const actionTitle = (action) => action === "img2img" ? "NovelAI 图生图" : action === "infill" ? "NovelAI 局部重绘" : action === "enhance" ? "NovelAI 细节增强" : "NovelAI 生成图片";
	register({
		name: "novelai_generate",
		description: "Generate or edit images with NovelAI. Load skill novelai-v5-prompt first. Supports text-to-image, img2img, infill, Enhance, multi-character positions, Vibe Transfer, Precise Reference, transparent PNG/WebP and the complete official generation parameters. Returns saved paths, seeds, metadata and Markdown to insert into the response. Use model-specific capabilities; never silently switch models. A submitted paid request is not automatically retried.",
		parameters: {
			prompt: {
				...text("Base prompt; use NovelAI tags, natural language, weighting, and Text: for lettering."),
				required: true
			},
			negative_prompt: text("Undesired Content base prompt."),
			model: text("Model ID from novelai_capabilities; defaults to configured V5 Full."),
			action: {
				type: "string",
				enum: [
					"generate",
					"img2img",
					"infill",
					"enhance"
				],
				description: "Enhance is a prompt-guided img2img pass. infill selects the matching inpainting model."
			},
			image_path: text("Local source image for img2img, Enhance or infill."),
			mask_path: text("Infill mask image: white regenerates, black preserves. Match the source canvas."),
			characters: array(object({
				prompt: {
					...text("Per-character prompt without a subject count."),
					required: true
				},
				negative_prompt: text("Per-character Undesired Content."),
				positions: array(object({
					x: {
						...number("0..1"),
						required: true
					},
					y: {
						...number("0..1"),
						required: true
					}
				}))
			})),
			use_coords: bool("Use explicit character positions; otherwise layout is automatic."),
			vibes: array(object({
				image_path: text("Original image; V4+ caches the paid encoding for reuse."),
				encoding_path: text("Previously returned .nai-vibe.json; avoids another encoding charge."),
				strength: number("0..1, default 0.6"),
				information_extracted: number("0..1, default 1 for new encodings; cached encoding keeps its own value.")
			})),
			references: array(object({
				image_path: {
					...text("Reference image, automatically resized and black-padded to the accepted canvas."),
					required: true
				},
				type: {
					type: "string",
					enum: [
						"character",
						"style",
						"character&style"
					]
				},
				fidelity: number("0..1, default 1"),
				strength: number("0..1, default 1"),
				information_extracted: number("0..1, default 1")
			})),
			parameters: {
				...generationParameters,
				description: "Complete official generation parameter object. width/height, steps, scale, sampler, seed, n_samples, strength/noise, quality, SMEA, Variety+, ControlNet, alpha and upscaling. Top-level image paths and characters are encoded by the plugin. Raw image fields, if used, require base64."
			}
		},
		output: imageOutput,
		presentCall: (args) => {
			const locations = fileLocations([
				args.image_path,
				args.mask_path,
				...args.vibes?.flatMap((vibe) => [vibe.image_path, vibe.encoding_path]) ?? [],
				...args.references?.map((ref) => ref.image_path) ?? []
			]);
			return {
				card: "generic",
				kind: "execute",
				title: actionTitle(args.action),
				rawInput: args.prompt,
				...locations ? { locations } : {}
			};
		},
		presentResult: (args, result) => presentImageResult(actionTitle(args.action), result),
		execute: async (args, exec) => {
			const io = await files(exec);
			let quotaTouched = false;
			try {
				const encode = async (vibe, model) => {
					if (vibe.encoding_path) return parseVibe((await io.read(vibe.encoding_path)).toString("utf8"), model, vibe.information_extracted);
					if (!vibe.image_path) throw new Error("每个 Vibe 需要 image_path 或 encoding_path");
					const encoded = await encodeVibe(client, await io.readImage(vibe.image_path), model, vibe.information_extracted ?? 1, io.cache, exec.signal, {}, io.policy);
					if (!encoded.cached) quotaTouched = true;
					return encoded.value;
				};
				const payload = await generationPayload(args, settings().model, io.readImage, encode);
				const images = await client.images("/ai/generate-image", payload, exec.signal);
				quotaTouched = true;
				const seed = payload.parameters.seed;
				for (const [index, image] of images.entries()) image.seed ??= (seed + index) % 2 ** 32;
				return await saveImages(images, io.cwd, io.directory, {
					operation: args.action ?? "generate",
					model: payload.model,
					input: safeMetadata(args),
					request: safeMetadata(payload)
				}, exec.signal, io.policy);
			} finally {
				if (quotaTouched) hooks?.onQuotaUsed?.();
			}
		}
	});
	register({
		name: "novelai_augment",
		description: "Use all NovelAI Director Tools: remove background (all returned variants), lineart, sketch, colorize, emotion, and declutter. Saves every returned image and returns embeddable Markdown.",
		parameters: {
			image_path: {
				...text("Local source image."),
				required: true
			},
			operation: {
				type: "string",
				required: true,
				enum: [
					"bg-removal",
					"lineart",
					"sketch",
					"colorize",
					"emotion",
					"declutter"
				]
			},
			prompt: text("Colorization tags or emotion prompt (e.g. happy;; smiling)."),
			defry: integer("Colorize/Emotion strength level, 0..5.")
		},
		output: imageOutput,
		presentCall: (args) => ({
			card: "generic",
			kind: "execute",
			title: `NovelAI Director Tools (${args.operation})`,
			locations: [{ path: args.image_path }],
			...args.prompt ? { rawInput: args.prompt } : {}
		}),
		presentResult: (args, result) => presentImageResult(`NovelAI Director Tools (${args.operation})`, result),
		execute: async (args, exec) => {
			if (args.defry !== void 0 && (!Number.isInteger(args.defry) || args.defry < 0 || args.defry > 5)) throw new Error("defry 必须位于 0..5");
			const io = await files(exec);
			const normalized = await normalizeImage(await io.readImage(args.image_path));
			const data = await sharp(normalized.data).png().toBuffer();
			const info = await sharp(data).metadata();
			const payload = {
				image: data.toString("base64"),
				width: info.width,
				height: info.height,
				req_type: args.operation,
				prompt: args.prompt ?? "",
				defry: args.defry ?? 0
			};
			const images = await client.images("/ai/augment-image", payload, exec.signal);
			hooks?.onQuotaUsed?.();
			return saveImages(images, io.cwd, io.directory, {
				operation: args.operation,
				input: args
			}, exec.signal, io.policy);
		}
	});
	register({
		name: "novelai_upscale",
		description: "NovelAI dedicated 2x image upscaler. Doubles width and height without a creative diffusion pass. For prompt-guided enhancement use novelai_generate action enhance.",
		parameters: {
			image_path: {
				...text("Local input image."),
				required: true
			},
			model: text("Source NovelAI model; defaults to configured model."),
			declared_blur_sigma: number("Optional blur sigma: must be 0, 0.3, 0.35, 0.4, 0.45 or 0.5.")
		},
		output: imageOutput,
		presentCall: (args) => ({
			card: "generic",
			kind: "execute",
			title: "NovelAI 2x 放大",
			locations: [{ path: args.image_path }]
		}),
		presentResult: (_args, result) => presentImageResult("NovelAI 2x 放大", result),
		execute: async (args, exec) => {
			if (args.declared_blur_sigma !== void 0) validateBlurSigma(args.declared_blur_sigma);
			const io = await files(exec);
			const normalized = await normalizeImage(await io.readImage(args.image_path));
			const payload = {
				model: args.model ?? settings().model,
				image: normalized.data.toString("base64")
			};
			if (args.declared_blur_sigma !== void 0) payload.declared_blur_sigma = args.declared_blur_sigma;
			const images = await client.images("/ai/upscale", payload, exec.signal);
			hooks?.onQuotaUsed?.();
			for (const image of images) if (image.seed === 0) delete image.seed;
			return saveImages(images, io.cwd, io.directory, {
				operation: "upscale",
				model: payload.model,
				input: args
			}, exec.signal, io.policy);
		}
	});
	register({
		name: "novelai_encode_vibe",
		description: "Encode a V4/V4.5 Vibe once and save a reusable encoding. Content-addressed local caching avoids paying for identical encodings again. Supports masks, crop-to-mask and encoding seeds. Supply encoding_path to novelai_generate vibes.",
		parameters: {
			image_path: {
				...text("Local source image."),
				required: true
			},
			model: text("Base V4/V4.5 model ID; defaults to configured model when V4/V4.5, otherwise nai-diffusion-4-5-full."),
			information_extracted: number("0..1, default 1"),
			mask_path: text("Optional local mask (white focuses, black ignores)."),
			crop_to_mask: bool("Crop encoding to mask bounds."),
			focus_seed: integer("Optional focus sampling seed."),
			info_extract_seed: integer("Optional information extraction seed.")
		},
		output: vibeOutput,
		presentCall: (args) => {
			const locations = fileLocations([args.image_path, args.mask_path]);
			return {
				card: "generic",
				kind: "execute",
				title: "NovelAI 编码 Vibe",
				...locations ? { locations } : {}
			};
		},
		execute: async (args, exec) => {
			const io = await files(exec);
			const options = {};
			for (const key of [
				"crop_to_mask",
				"focus_seed",
				"info_extract_seed"
			]) if (args[key] !== void 0) options[key] = args[key];
			if (args.mask_path) {
				const normalizedMask = await normalizeImage(await io.readImage(args.mask_path));
				options.mask = (await sharp(normalizedMask.data).flatten({ background: "#000" }).greyscale().png().toBuffer()).toString("base64");
			}
			const configured = settings().model;
			const canUseConfigured = !configured.endsWith("-inpainting") && (() => {
				try {
					const m = modelInfo(configured);
					return m.vibe && m.family >= 4;
				} catch {
					return false;
				}
			})();
			const targetModel = args.model ?? (canUseConfigured ? configured : "nai-diffusion-4-5-full");
			const result = await encodeVibe(client, await io.readImage(args.image_path), targetModel, args.information_extracted ?? 1, io.cache, exec.signal, options, io.policy);
			if (!result.cached) hooks?.onQuotaUsed?.();
			return {
				encoding_path: result.path,
				cached: result.cached,
				model: result.value.model,
				information_extracted: result.value.information_extracted
			};
		}
	});
	register({
		name: "novelai_suggest_tags",
		description: "Query official NovelAI tag suggestions and tag knowledge for a model. Useful when composing precise character, style or scene tags.",
		parameters: {
			prompt: {
				...text("Incomplete tag query."),
				required: true
			},
			model: text("NovelAI image model ID."),
			lang: {
				type: "string",
				enum: ["en", "jp"]
			}
		},
		concurrencySafe: true,
		presentCall: (args) => ({
			card: "generic",
			kind: "search",
			title: `NovelAI 标签查询: ${args.prompt.slice(0, 40)}`
		}),
		execute: async (args, exec) => client.json(`/ai/generate-image/suggest-tags?${new URLSearchParams({
			model: args.model ?? settings().model,
			prompt: args.prompt,
			lang: args.lang ?? "en"
		})}`, void 0, exec.signal)
	});
	register({
		name: "novelai_account",
		description: "Read NovelAI subscription, Anlas balance and available usage limits. Does not generate an image or return the API token.",
		parameters: {},
		concurrencySafe: true,
		presentCall: () => ({
			card: "generic",
			kind: "fetch",
			title: "NovelAI 账户与额度查询"
		}),
		execute: async (_args, exec) => {
			const data = await client.json("/user/subscription", void 0, exec.signal);
			try {
				hooks?.onAccountData?.(data);
			} catch {}
			return data;
		}
	});
	register({
		name: "novelai_capabilities",
		description: "List supported NovelAI models, model-specific capabilities, operations and optionally the full official parameter definitions. Inspect before choosing advanced generation options.",
		parameters: { include_parameters: bool("Include full official schemas for generation, Director Tools, upscaling and vibe encoding.") },
		concurrencySafe: true,
		presentCall: () => ({
			card: "generic",
			kind: "read",
			title: "NovelAI 模型能力查询"
		}),
		execute: async (args) => ({
			models: MODELS,
			configured_model: settings().model,
			operations: [
				"generate",
				"img2img",
				"infill",
				"enhance",
				"multi-character",
				"vibe-transfer",
				"precise-reference",
				"bg-removal",
				"lineart",
				"sketch",
				"colorize",
				"emotion",
				"declutter",
				"upscale",
				"encode-vibe",
				"suggest-tags",
				"account"
			],
			...args.include_parameters ? { parameters: API_DEFINITIONS } : {}
		})
	});
}
// src/node/index.ts
const name = "novelai";
const inject = [
	"tools",
	"skills",
	"credentials",
	"fs",
	"workingDirectory",
	"settings"
];
const Config = z.object({
	model: z.string().min(1).default(DEFAULT_SETTINGS.model),
	outputDirectory: z.string().min(1).default(DEFAULT_SETTINGS.outputDirectory),
	timeoutSeconds: z.number().min(1).default(DEFAULT_SETTINGS.timeoutSeconds)
}).volatile();
function apply(ctx, config) {
	const ref = credentialRef(CREDENTIAL_REF);
	ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber));
	const client = new NovelAIClient(async () => {
		const credential = await ctx.credentials.resolve(ref);
		if (!credential) throw new Error("尚未配置 NovelAI API Token，请在插件设置中保存");
		return credential.value;
	}, () => config.get().timeoutSeconds);
	const tracker = createAccountTracker({
		isConfigured: async () => (await ctx.credentials.describe(ref)).configured,
		fetchSubscription: (signal) => client.json("/user/subscription", void 0, signal)
	});
	ctx.effect(() => {
		const disposeCredentialWatch = ctx.on("credentials/reference-updated", (subject) => {
			if (subject === ref) tracker.handleCredentialChange();
		});
		tracker.refresh();
		return () => {
			disposeCredentialWatch();
			tracker.dispose();
		};
	}, "novelai: account tracker");
	registerTools(ctx, client, () => config.get(), {
		onQuotaUsed: () => tracker.notifyQuotaUsed(),
		onAccountData: (raw) => {
			tracker.recordSubscription(raw);
		}
	});
	registerSkill(ctx);
	ctx.inject(["connection"], (child) => {
		const dispose = child.connection.rpc.handle(RPC_CHANNEL, async (endpoint, _payload, signal) => {
			try {
				if (endpoint === "get") return {
					ok: true,
					value: await tracker.getOrRefresh()
				};
				if (endpoint === "refresh") return {
					ok: true,
					value: await tracker.refresh()
				};
				if (endpoint === "account") {
					const raw = await client.json("/user/subscription", void 0, signal);
					try {
						tracker.recordSubscription(raw);
					} catch {}
					return {
						ok: true,
						value: raw
					};
				}
				return {
					ok: false,
					error: {
						code: "invalidRequest",
						message: "未知 NovelAI 配置操作",
						details: {}
					}
				};
			} catch (error) {
				return {
					ok: false,
					error: {
						code: "novelai",
						message: error instanceof Error ? error.message : String(error),
						details: {}
					}
				};
			}
		});
		return async () => {
			await dispose();
		};
	});
}
export { Config, apply, inject, name };

//# sourceMappingURL=node.js.map