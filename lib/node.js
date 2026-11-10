import { credentialRef } from "@deepseek-ai/dsh-credentials";
import z from "@deepseek-ai/schemastery";
import { unzipSync } from "fflate";
import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { BUNDLED_SKILL_RANK } from "@deepseek-ai/dsh-skill";
import { join, resolve } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createHash, randomInt, randomUUID } from "node:crypto";
// src/shared.ts
const CREDENTIAL_REF = "NOVELAI_API_TOKEN";
const RPC_CHANNEL = "/dsh-novelai";
const DEFAULT_MODEL = "nai-diffusion-5-full";
const API_ORIGIN = "https://image.novelai.net";
const DEFAULT_SETTINGS = {
	model: DEFAULT_MODEL,
	outputDirectory: "novelai-output",
	timeoutSeconds: 300
};
// src/node/api.ts
var NovelAIClient = class {
	token;
	timeoutSeconds;
	origin;
	constructor(token, timeoutSeconds, origin = API_ORIGIN) {
		this.token = token;
		this.timeoutSeconds = timeoutSeconds;
		this.origin = origin;
	}
	async request(path, payload, signal) {
		const token = await this.token();
		const response = await fetch(new URL(path, this.origin), {
			method: payload === void 0 ? "GET" : "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				Accept: "application/json",
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
		return await (await this.request(path, payload, signal)).json();
	}
	async images(path, payload, signal) {
		const response = await this.request(path, payload, signal);
		return decodeImages(Buffer.from(await response.arrayBuffer()), response.headers.get("content-type") ?? "");
	}
};
async function decodeImages(bytes, contentType) {
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
function registerSkill(ctx) {
	const directory = fileURLToPath(new URL("../assets/novelai-v5-prompt/", import.meta.url)).replaceAll("\\", "/");
	const candidate = {
		name: "novelai-v5-prompt",
		description: "使用 NovelAI 生成或编辑图片：V5 标签与自然语言提示词、多角色、文字与漫画；通过 novelai 工具完成图生图、局部重绘、Vibe、Precise Reference、Director Tools 和放大，并在回复正文插入图片。",
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
		path: `${directory}/SKILL.md`,
		locator: `${directory}/SKILL.md`
	};
	ctx.skills.registerProvider(() => ({
		name: "dsh-novelai",
		list: async () => [candidate],
		get: async (_candidate, options) => {
			const { rank: _rank, locator: _locator, ...summary } = candidate;
			const text = await readFile(candidate.path, {
				encoding: "utf8",
				signal: options.signal
			});
			return {
				...summary,
				content: text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, "")
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
// src/node/models.ts
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
	const model = MODELS.find((model) => model.id === id || model.inpaint === id);
	if (!model) throw new Error(`未知模型 ${id}。使用 novelai_capabilities 查询支持的模型。`);
	return model;
}
// src/node/generation.ts
async function generationPayload(args, defaultModel, read, encode) {
	if (!args.prompt.trim()) throw new Error("prompt 不能为空");
	const model = modelInfo(args.model ?? defaultModel);
	const requested = args.model ?? defaultModel;
	const action = args.action === "enhance" ? "img2img" : args.action ?? "generate";
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
		const image = await read(args.image_path);
		const size = await sharp(image).metadata();
		p.width = args.parameters?.width ?? Math.max(64, Math.round(size.width / 64) * 64);
		p.height = args.parameters?.height ?? Math.max(64, Math.round(size.height / 64) * 64);
		p.image = (await sharp(image).resize(p.width, p.height, { fit: "fill" }).png().toBuffer()).toString("base64");
	}
	for (const name of ["width", "height"]) {
		const value = p[name];
		if (typeof value !== "number" || !Number.isInteger(value) || value < 64 || value % 64 !== 0) throw new Error(`${name} 必须是至少 64 的 64 倍数`);
	}
	for (const name of ["steps", "n_samples"]) if (typeof p[name] !== "number" || !Number.isInteger(p[name]) || p[name] < 1) throw new Error(`${name} 必须为正整数`);
	if (typeof p.seed !== "number" || !Number.isInteger(p.seed) || p.seed < 0 || p.seed >= 2 ** 32) throw new Error("seed 必须位于 0..4294967295");
	if (typeof p.scale !== "number" || p.scale <= 0) throw new Error("scale 必须大于 0");
	if (args.negative_prompt !== void 0) p.negative_prompt = args.negative_prompt;
	if (args.mask_path) p.mask = (await sharp(await read(args.mask_path)).resize(p.width, p.height, {
		fit: "fill",
		kernel: "nearest"
	}).png().toBuffer()).toString("base64");
	if (action !== "generate" && !p.image) throw new Error(`${action} 需要 image_path`);
	if (action === "infill" && !p.mask) throw new Error("局部重绘需要 mask_path（白色重绘、黑色保留）");
	if (action === "img2img") {
		p.strength ??= args.action === "enhance" ? .2 : .7;
		p.noise ??= args.action === "enhance" ? 0 : .2;
	}
	if (model.family >= 4 && !p.v4_prompt) {
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
		p.v4_prompt = {
			caption: caption(false),
			use_coords: Boolean(use_coords),
			use_order: true
		};
		p.v4_negative_prompt ??= {
			caption: caption(true),
			legacy_uc: false
		};
	} else if (model.family < 4 && args.characters?.length) throw new Error("独立角色提示词需要 V4 或更高模型");
	const hasVibes = Boolean(args.vibes?.length || p.reference_image || p.reference_image_multiple?.length);
	const hasReferences = Boolean(args.references?.length || p.director_reference_images?.length);
	if (hasVibes && !model.vibe) throw new Error(`${model.label} 尚不支持 Vibe Transfer，请显式选择 V4.5/V4/V3`);
	if (hasReferences && !model.precise) throw new Error("Precise Reference 当前只支持 V4.5 模型，请显式指定模型");
	if (hasVibes && hasReferences) throw new Error("NovelAI 当前不支持同时使用 Vibe Transfer 与 Precise Reference");
	if (args.vibes?.length) {
		if (args.vibes.length > 16) throw new Error("最多支持 16 个 Vibe");
		const encoded = await Promise.all(args.vibes.map(async (vibe) => {
			if (model.family >= 4) return encode(vibe, model.id);
			if (!vibe.image_path) throw new Error("V3 Vibe 需要原始 image_path");
			return {
				encoding: (await read(vibe.image_path)).toString("base64"),
				information_extracted: vibe.information_extracted ?? 1,
				model: model.id
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
		model: action === "infill" ? model.inpaint : requested,
		action,
		parameters: p
	};
}
async function prepareReference(data) {
	const info = await sharp(data).metadata();
	const ratio = info.width / info.height;
	const size = [
		[1024, 1536],
		[1472, 1472],
		[1536, 1024]
	].sort((a, b) => Math.abs(Math.log(ratio / (a[0] / a[1]))) - Math.abs(Math.log(ratio / (b[0] / b[1]))))[0];
	return sharp(data).flatten({ background: "#000" }).resize(size[0], size[1], {
		fit: "contain",
		background: "#000"
	}).png().toBuffer();
}
async function encodeVibe(client, data, model, information, cacheDirectory, signal, options = {}) {
	if (!modelInfo(model).vibe || modelInfo(model).family < 4) throw new Error("独立 Vibe 编码需要 V4/V4.5；V3 直接使用原图，V5 暂不支持 Vibe");
	range("information_extracted", information);
	const hash = createHash("sha256").update(data).update(JSON.stringify({
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
		if (error.code !== "ENOENT") throw error;
	}
	const response = await client.request("/ai/encode-vibe", {
		...options,
		image: data.toString("base64"),
		model,
		information_extracted: information
	}, signal);
	const encoding = Buffer.from(await response.arrayBuffer()).toString("base64");
	if (!encoding.length) throw new Error("NovelAI 返回空 Vibe 编码");
	const value = {
		model,
		information_extracted: information,
		encoding
	};
	await mkdir(cacheDirectory, { recursive: true });
	await writeFile(path, JSON.stringify(value) + "\n", { signal });
	return {
		path,
		value,
		cached: false
	};
}
function parseVibe(text, model, information) {
	const value = JSON.parse(text);
	if (!value || typeof value !== "object" || !("model" in value) || value.model !== model || !("encoding" in value) || typeof value.encoding !== "string" || !("information_extracted" in value) || typeof value.information_extracted !== "number") throw new Error("Vibe 缓存格式或模型不匹配");
	if (information !== void 0 && value.information_extracted !== information) throw new Error("Vibe information_extracted 与缓存不匹配，需要重新编码");
	return value;
}
function range(name, value) {
	if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} 必须位于 0..1`);
	return value;
}
// src/node/storage.ts
async function saveImages(images, cwd, directory, metadata, signal) {
	const folder = resolve(cwd, directory, `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
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
			markdown: `![NovelAI 图片 ${index + 1}](<${path.replaceAll("\\", "/")}>)`
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
// src/node/tools.ts
function registerTools(ctx, client, settings) {
	const output = {
		schema: { type: "json" },
		render: (_args, value) => [{
			type: "text",
			text: JSON.stringify(value)
		}]
	};
	function register(name, description, parameters, execute) {
		ctx.tools.register(defineTool({
			name,
			description,
			parameters,
			output,
			execute: async (args, exec) => await execute(args, exec)
		}));
	}
	async function files(exec) {
		if (!exec.agent) throw new Error("此工具需要当前会话");
		const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
		const root = await ctx.fs.resolve(cwd, { signal: exec.signal });
		const local = ctx.fs.processPath(root);
		if (ctx.fs.processPathFromHostPath(local) === void 0) throw new Error("NovelAI 输出需要本机工作目录；当前文件系统未映射到 Host");
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
			read,
			readImage,
			cache: resolve(local, settings().outputDirectory, ".vibe-cache")
		};
	}
	register("novelai_generate", "Generate or edit images with NovelAI. Load skill novelai-v5-prompt first. Supports text-to-image, img2img, infill, Enhance, multi-character positions, Vibe Transfer, Precise Reference, transparent PNG/WebP and the complete official generation parameters. Returns saved paths, seeds, metadata and Markdown to insert into the response. Use model-specific capabilities; never silently switch models. A submitted paid request is not automatically retried.", {
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
	}, async (args, exec) => {
		const io = await files(exec);
		const encode = async (vibe, model) => {
			if (vibe.encoding_path) return parseVibe((await io.read(vibe.encoding_path)).toString("utf8"), model, vibe.information_extracted);
			if (!vibe.image_path) throw new Error("每个 Vibe 需要 image_path 或 encoding_path");
			return (await encodeVibe(client, await io.readImage(vibe.image_path), model, vibe.information_extracted ?? 1, io.cache, exec.signal)).value;
		};
		const payload = await generationPayload(args, settings().model, io.readImage, encode);
		const images = await client.images("/ai/generate-image", payload, exec.signal);
		const seed = payload.parameters.seed;
		for (const [index, image] of images.entries()) image.seed ??= (seed + index) % 2 ** 32;
		return saveImages(images, io.cwd, settings().outputDirectory, {
			operation: args.action ?? "generate",
			model: payload.model,
			input: safeMetadata(args),
			request: safeMetadata(payload)
		}, exec.signal);
	});
	register("novelai_augment", "Use all NovelAI Director Tools: remove background (all returned variants), lineart, sketch, colorize, emotion, and declutter. Saves every returned image and returns embeddable Markdown.", {
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
	}, async (args, exec) => {
		if (args.defry !== void 0 && (!Number.isInteger(args.defry) || args.defry < 0 || args.defry > 5)) throw new Error("defry 必须位于 0..5");
		const io = await files(exec);
		const data = await sharp(await io.readImage(args.image_path)).png().toBuffer();
		const info = await sharp(data).metadata();
		const payload = {
			image: data.toString("base64"),
			width: info.width,
			height: info.height,
			req_type: args.operation,
			prompt: args.prompt ?? "",
			defry: args.defry ?? 0
		};
		return saveImages(await client.images("/ai/augment-image", payload, exec.signal), io.cwd, settings().outputDirectory, {
			operation: args.operation,
			input: args
		}, exec.signal);
	});
	register("novelai_upscale", "NovelAI dedicated 4x image upscaler. Preserves the artwork without a creative diffusion pass. For prompt-guided enhancement use novelai_generate action enhance.", {
		image_path: {
			...text("Local input image."),
			required: true
		},
		model: text("Source NovelAI model; defaults to configured model."),
		declared_blur_sigma: number("0, 0.30, 0.35, 0.40, 0.45 or 0.50.")
	}, async (args, exec) => {
		const io = await files(exec);
		const payload = {
			model: args.model ?? settings().model,
			image: (await io.readImage(args.image_path)).toString("base64")
		};
		if (args.declared_blur_sigma !== void 0) payload.declared_blur_sigma = args.declared_blur_sigma;
		return saveImages(await client.images("/ai/upscale", payload, exec.signal), io.cwd, settings().outputDirectory, {
			operation: "upscale",
			model: payload.model,
			input: args
		}, exec.signal);
	});
	register("novelai_encode_vibe", "Encode a V4/V4.5 Vibe once and save a reusable encoding. Content-addressed local caching avoids paying for identical encodings again. Supports masks, crop-to-mask and encoding seeds. Supply encoding_path to novelai_generate vibes.", {
		image_path: {
			...text("Local source image."),
			required: true
		},
		model: text("V4/V4.5 model, default nai-diffusion-4-5-full."),
		information_extracted: number("0..1, default 1"),
		mask_path: text("Optional local mask."),
		crop_to_mask: bool("Crop encoding to mask bounds."),
		focus_seed: integer("Optional focus sampling seed."),
		info_extract_seed: integer("Optional information extraction seed.")
	}, async (args, exec) => {
		const io = await files(exec);
		const options = {};
		for (const key of [
			"crop_to_mask",
			"focus_seed",
			"info_extract_seed"
		]) if (args[key] !== void 0) options[key] = args[key];
		if (args.mask_path) options.mask = (await io.readImage(args.mask_path)).toString("base64");
		const result = await encodeVibe(client, await io.readImage(args.image_path), args.model ?? "nai-diffusion-4-5-full", args.information_extracted ?? 1, io.cache, exec.signal, options);
		return {
			encoding_path: result.path,
			cached: result.cached,
			model: result.value.model,
			information_extracted: result.value.information_extracted
		};
	});
	register("novelai_suggest_tags", "Query official NovelAI tag suggestions and tag knowledge for a model. Useful when composing precise character, style or scene tags.", {
		prompt: {
			...text("Incomplete tag query."),
			required: true
		},
		model: text("NovelAI image model ID."),
		lang: {
			type: "string",
			enum: ["en", "jp"]
		}
	}, async (args, exec) => client.json(`/ai/generate-image/suggest-tags?${new URLSearchParams({
		model: args.model ?? settings().model,
		prompt: args.prompt,
		lang: args.lang ?? "en"
	})}`, void 0, exec.signal));
	register("novelai_account", "Read NovelAI subscription, Anlas balance and available usage limits. Does not generate an image or return the API token.", {}, async (_args, exec) => client.json("/user/subscription", void 0, exec.signal));
	register("novelai_capabilities", "List supported NovelAI models, model-specific capabilities, operations and optionally the full official parameter definitions. Inspect before choosing advanced generation options.", { include_parameters: bool("Include full official schemas for generation, Director Tools, upscaling and vibe encoding.") }, async (args) => ({
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
	}));
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
	model: z.string().default(DEFAULT_SETTINGS.model),
	outputDirectory: z.string().default(DEFAULT_SETTINGS.outputDirectory),
	timeoutSeconds: z.number().min(1).default(DEFAULT_SETTINGS.timeoutSeconds)
}).volatile();
function apply(ctx, config) {
	ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber));
	const client = new NovelAIClient(async () => {
		const credential = await ctx.credentials.resolve(credentialRef(CREDENTIAL_REF));
		if (!credential) throw new Error("尚未配置 NovelAI API Token，请在插件设置中保存");
		return credential.value;
	}, () => config.get().timeoutSeconds);
	registerTools(ctx, client, () => config.get());
	registerSkill(ctx);
	ctx.inject(["connection"], (child) => {
		const dispose = child.connection.rpc.handle(RPC_CHANNEL, async (endpoint, _payload, signal) => {
			try {
				if (endpoint === "status") return {
					ok: true,
					value: {
						credential: await ctx.credentials.describe(credentialRef(CREDENTIAL_REF)),
						models: MODELS
					}
				};
				if (endpoint === "account") return {
					ok: true,
					value: await client.json("/user/subscription", void 0, signal)
				};
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