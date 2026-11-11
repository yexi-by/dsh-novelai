window.__ModuleLoader__.load({
	id: "dsh-novelai",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		// src/shared.ts
		const CREDENTIAL_REF = "NOVELAI_API_TOKEN";
		const RPC_CHANNEL = "/dsh-novelai";
		const DEFAULT_SETTINGS = {
			model: "nai-diffusion-5-full",
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
		// src/client/index.tsx
		const zh = {
			title: "NovelAI 生图",
			token: "Persistent API Token",
			configured: "已配置",
			configuredEnv: "已配置（环境变量）",
			missing: "未配置",
			saveToken: "保存密钥",
			removeToken: "移除密钥",
			removedKeepEnv: "已移除凭据库中的密钥；当前仍由环境变量提供",
			check: "验证连接并查询额度",
			model: "默认模型",
			directory: "图片输出目录",
			timeout: "请求超时（秒）",
			save: "保存设置",
			saved: "已保存",
			intro: "Agent 可调用生成、编辑、参考图、Director Tools、2 倍放大和标签工具。随附 novelai-v5-prompt Skill，生成图片可直接显示在回复正文。",
			tokenHint: "从 NovelAI 账户设置获取 Persistent API Token。密钥保存到 DSH 凭据服务，不进入对话历史。",
			connected: "连接正常",
			balance: "可用 Anlas",
			subscription: "订阅",
			active: "生效中",
			inactive: "未生效",
			paid: "购买额度",
			monthly: "订阅额度"
		};
		const en = {
			title: "NovelAI Images",
			token: "Persistent API Token",
			configured: "Configured",
			configuredEnv: "Configured (environment)",
			missing: "Not configured",
			saveToken: "Save token",
			removeToken: "Remove token",
			removedKeepEnv: "Removed stored token; environment variable is still active",
			check: "Verify connection and balance",
			model: "Default model",
			directory: "Image output directory",
			timeout: "Request timeout (seconds)",
			save: "Save settings",
			saved: "Saved",
			intro: "Agent tools cover generation, editing, references, Director Tools, 2x upscaling and tags. The bundled novelai-v5-prompt skill guides prompts and inline images.",
			tokenHint: "Get a Persistent API Token from NovelAI account settings. It is saved through DSH credentials and is not included in conversation history.",
			connected: "Connected",
			balance: "Available Anlas",
			subscription: "Subscription",
			active: "Active",
			inactive: "Inactive",
			paid: "Purchased",
			monthly: "Subscription credits"
		};
		function createFace(ctx) {
			const form = ctx.configForms.get("novelai");
			const connection = ctx.connection;
			return {
				getSnapshot: () => form.getSnapshot(),
				subscribe: (listener) => form.subscribe(listener),
				async save(settings) {
					const outputDirectory = settings.outputDirectory.trim();
					if (!outputDirectory) throw new Error("图片输出目录不能为空");
					if (!MODELS.some((model) => model.id === settings.model)) throw new Error(`不支持的默认模型：${settings.model}`);
					if (!Number.isFinite(settings.timeoutSeconds) || settings.timeoutSeconds < 1) throw new Error("请求超时必须为不小于 1 的数字");
					const normalized = {
						model: settings.model,
						outputDirectory,
						timeoutSeconds: Math.round(settings.timeoutSeconds)
					};
					for (const key of [
						"model",
						"outputDirectory",
						"timeoutSeconds"
					]) if (!await form.set(key, normalized[key])) throw new Error("设置未保存，请刷新后重试");
					return normalized;
				},
				async status() {
					const result = await ctx.remote.credentials.describe([CREDENTIAL_REF]);
					if (!result.ok) throw new Error(result.error.message);
					return result.value[CREDENTIAL_REF];
				},
				async token(value) {
					if (value !== void 0 && !/^pst-\S+$/u.test(value.trim())) throw new Error("请输入有效的 NovelAI Persistent API Token（pst-…）");
					const result = value === void 0 ? await ctx.remote.credentials.unset(CREDENTIAL_REF) : await ctx.remote.credentials.set(CREDENTIAL_REF, value.trim());
					if (!result.ok) throw new Error(result.error.message);
				},
				async account() {
					const result = await connection.rpc.call(RPC_CHANNEL, "account", {}, AbortSignal.timeout(15e3));
					if (!result.ok) throw new Error(result.error.message);
					const value = result.value;
					if (!value || typeof value !== "object" || !("active" in value) || typeof value.active !== "boolean" || !("trainingStepsLeft" in value) || !value.trainingStepsLeft || typeof value.trainingStepsLeft !== "object" || !("fixedTrainingStepsLeft" in value.trainingStepsLeft) || typeof value.trainingStepsLeft.fixedTrainingStepsLeft !== "number" || !("purchasedTrainingSteps" in value.trainingStepsLeft) || typeof value.trainingStepsLeft.purchasedTrainingSteps !== "number") throw new Error("NovelAI 账户响应格式不正确");
					return {
						active: value.active,
						monthly: value.trainingStepsLeft.fixedTrainingStepsLeft,
						paid: value.trainingStepsLeft.purchasedTrainingSteps
					};
				}
			};
		}
		function NovelAICard({ t, getSnapshot, subscribe, status, token, account, save }) {
			const config = (0, react.useSyncExternalStore)(subscribe, getSnapshot);
			const [draft, setDraft] = (0, react.useState)(DEFAULT_SETTINGS);
			const [secret, setSecret] = (0, react.useState)("");
			const [credential, setCredential] = (0, react.useState)({
				configured: false,
				writable: true
			});
			const [busy, setBusy] = (0, react.useState)(false);
			const [message, setMessage] = (0, react.useState)("");
			const [balance, setBalance] = (0, react.useState)();
			(0, react.useEffect)(() => {
				if (config.value) setDraft(config.value);
			}, [config.value]);
			(0, react.useEffect)(() => {
				status().then(setCredential, (error) => setMessage(String(error)));
			}, [status]);
			async function run(action, fallback = t("saved")) {
				setBusy(true);
				setMessage("");
				try {
					const custom = await action();
					setMessage(custom ?? fallback);
				} catch (error) {
					setMessage(error instanceof Error ? error.message : String(error));
				} finally {
					setBusy(false);
				}
			}
			const statusKey = !credential.configured ? "missing" : credential.source && credential.source !== "file" ? "configuredEnv" : "configured";
			const inputStyle = {
				padding: "8px 10px",
				borderRadius: 8,
				border: "1px solid var(--dsw-alias-border-l2)",
				background: "var(--dsw-alias-bg-layer-3)",
				color: "var(--dsw-alias-label-primary)",
				width: "100%",
				boxSizing: "border-box"
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: {
					display: "grid",
					gap: 16,
					maxWidth: 720,
					color: "var(--dsw-alias-label-primary)"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						style: { margin: 0 },
						children: t("title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							margin: 0,
							lineHeight: 1.6
						},
						children: t("intro")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: {
							display: "grid",
							gap: 8
						},
						children: [
							t("token"),
							" · ",
							t(statusKey),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "password",
								autoComplete: "off",
								value: secret,
								placeholder: "pst-…",
								style: inputStyle,
								onChange: (event) => setSecret(event.target.value)
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							margin: 0,
							color: "var(--dsw-alias-label-secondary)",
							fontSize: 13
						},
						children: t("tokenHint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 8,
							flexWrap: "wrap"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								disabled: busy || !credential.writable || !secret.trim(),
								onClick: () => {
									run(async () => {
										await token(secret);
										setSecret("");
										setCredential(await status());
									});
								},
								children: t("saveToken")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								disabled: busy || !credential.writable || !credential.configured,
								onClick: () => {
									run(async () => {
										await token(void 0);
										const next = await status();
										setCredential(next);
										if (!next.configured) setBalance(void 0);
										if (next.configured && next.source && next.source !== "file") return t("removedKeepEnv");
									});
								},
								children: t("removeToken")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								disabled: busy || !credential.configured,
								onClick: () => {
									run(async () => {
										setBalance(await account());
									}, t("connected"));
								},
								children: t("check")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: {
							display: "grid",
							gap: 8
						},
						children: [t("model"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
							style: inputStyle,
							value: draft.model,
							onChange: (event) => setDraft({
								...draft,
								model: event.target.value
							}),
							children: MODELS.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: model.id,
								children: model.label
							}, model.id))
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: {
							display: "grid",
							gap: 8
						},
						children: [t("directory"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: inputStyle,
							value: draft.outputDirectory,
							onChange: (event) => setDraft({
								...draft,
								outputDirectory: event.target.value
							})
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: {
							display: "grid",
							gap: 8
						},
						children: [t("timeout"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: inputStyle,
							type: "number",
							min: 1,
							value: draft.timeoutSeconds,
							onChange: (event) => setDraft({
								...draft,
								timeoutSeconds: Number(event.target.value)
							})
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						disabled: busy || config.status !== "ready",
						onClick: () => {
							run(async () => {
								setDraft(await save(draft));
							});
						},
						children: t("save")
					}) }),
					message && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						style: {
							margin: 0,
							overflowWrap: "anywhere"
						},
						children: message
					}),
					balance !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: 16,
							borderRadius: 12,
							background: "var(--dsw-alias-bg-layer-3)",
							display: "grid",
							gap: 8
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [
								t("balance"),
								"：",
								balance.monthly + balance.paid
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								t("monthly"),
								"：",
								balance.monthly,
								" · ",
								t("paid"),
								"：",
								balance.paid
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								t("subscription"),
								"：",
								t(balance.active ? "active" : "inactive")
							] })
						]
					})
				]
			});
		}
		const inject = [
			"slots",
			"locale",
			"connection",
			"remote",
			"remote.credentials",
			"configForms"
		];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register("settings.novelai", {
				zh,
				en
			}));
			const face = createFace(ctx);
			ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
				name: "plugins.bundle.config",
				key: "dsh-novelai",
				locale: "settings.novelai",
				inject: () => face
			}, NovelAICard));
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map