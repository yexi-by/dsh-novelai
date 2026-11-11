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
			steps: 28,
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
		/** 仅生效中的 Opus（tier >= 3）享有 0 点数标准生图的 V5 血条机制。 */
		function hasOpusUsageBar(data) {
			return data.active && data.tier >= 3 && data.usage !== null;
		}
		/** 根据剩余血量判定血条状态色档位。 */
		function usageTone(usage) {
			if (usage.isNegative || usage.percent < 25) return "low";
			if (usage.percent < 60) return "warn";
			return "healthy";
		}
		/**
		* 计算距离恢复 +1% 血量的剩余秒数。
		* 满血（>=100% 且未透支）时不显示恢复倒计时，避免服务端固定返回滚动周期造成误导。
		*/
		function remainingRegenSeconds(usage, fetchedAt, now) {
			if (!usage.isNegative && usage.percent >= 100) return null;
			if (usage.timeUntilNextPercent <= 0) return null;
			const elapsedSeconds = fetchedAt !== null ? Math.max(0, (now - fetchedAt) / 1e3) : 0;
			return Math.max(0, Math.round(usage.timeUntilNextPercent - elapsedSeconds));
		}
		function subscriptionTierKind(data) {
			if (!data.active) return data.tier > 0 ? "inactive" : "free";
			if (data.tier >= 3) return "opus";
			if (data.tier === 2) return "scroll";
			if (data.tier === 1) return "tablet";
			return "free";
		}
		// src/client/controller.ts
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		function isAccountSnapshot(value) {
			if (!isRecord(value)) return false;
			return typeof value.configured === "boolean" && (value.data === null || isRecord(value.data)) && (value.fetchedAt === null || typeof value.fetchedAt === "number") && (value.error === null || typeof value.error === "string") && typeof value.refreshing === "boolean" && typeof value.activitySeq === "number";
		}
		function deriveAccountStatus(snap) {
			if (!snap.configured) return "unconfigured";
			if (snap.data !== null) return "ready";
			if (snap.error !== null) return "error";
			return "idle";
		}
		function createAccountController(ctx) {
			const connection = ctx.connection;
			let view = {
				status: "idle",
				configured: false,
				data: null,
				fetchedAt: null,
				error: null,
				refreshing: false,
				activitySeq: 0
			};
			const listeners = /* @__PURE__ */ new Set();
			let pendingGet = null;
			let pendingRefresh = null;
			const account = {
				getSnapshot: () => view,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				}
			};
			function publish(next) {
				view = next;
				for (const listener of listeners) listener();
				return view;
			}
			async function request(endpoint) {
				if (endpoint === "refresh") publish({
					...view,
					refreshing: true,
					error: null
				});
				let result;
				try {
					result = await connection.rpc.call(RPC_CHANNEL, endpoint, {}, AbortSignal.timeout(15e3));
				} catch {
					return publish({
						...view,
						status: view.data !== null ? "ready" : "unavailable",
						refreshing: false
					});
				}
				if (!result.ok) return publish({
					...view,
					status: view.data !== null ? "ready" : "error",
					error: result.error.message,
					refreshing: false
				});
				if (!isAccountSnapshot(result.value)) return publish({
					...view,
					status: view.data !== null ? "ready" : "error",
					error: "NovelAI 额度状态响应格式异常",
					refreshing: false
				});
				const snap = result.value;
				return publish({
					status: deriveAccountStatus(snap),
					configured: snap.configured,
					data: snap.data,
					fetchedAt: snap.fetchedAt,
					error: snap.error,
					refreshing: snap.refreshing,
					activitySeq: snap.activitySeq
				});
			}
			function get() {
				if (pendingRefresh !== null) return pendingRefresh;
				if (pendingGet !== null) return pendingGet;
				const task = request("get").finally(() => {
					if (pendingGet === task) pendingGet = null;
				});
				pendingGet = task;
				return task;
			}
			function refresh() {
				if (pendingRefresh !== null) return pendingRefresh;
				const task = request("refresh").finally(() => {
					if (pendingRefresh === task) pendingRefresh = null;
				});
				pendingRefresh = task;
				return task;
			}
			return {
				account,
				get,
				refresh,
				quotaFace: () => ({
					hooks: { account },
					get,
					refresh
				})
			};
		}
		// src/client/locales.ts
		const NS = "settings.novelai";
		const zh = {
			title: "NovelAI 生图",
			brand: "NovelAI",
			token: "Persistent API Token",
			configured: "已配置",
			configuredEnv: "已配置（环境变量）",
			missing: "未配置",
			saveToken: "保存密钥",
			removeToken: "移除密钥",
			removedKeepEnv: "已移除凭据库中的密钥；当前仍由环境变量提供",
			check: "验证连接并查询额度",
			model: "默认模型",
			steps: "生成步数",
			directory: "图片输出目录",
			timeout: "请求超时（秒）",
			save: "保存设置",
			saved: "已保存",
			tokenHint: "从 NovelAI 账户设置获取 Persistent API Token。密钥保存到 DSH 凭据服务，不进入对话历史。",
			connected: "连接正常，额度已刷新",
			balance: "剩余点数",
			totalAnlas: "可用总点数",
			subscription: "订阅状态",
			active: "生效中",
			inactive: "未生效",
			paid: "购买点数",
			monthly: "订阅点数",
			expiresAt: "到期日期",
			tierOpus: "Opus",
			tierScroll: "Scroll",
			tierTablet: "Tablet",
			tierFree: "免费档",
			tierInactive: "已过期",
			hpLabel: "V5 血条",
			hpFull: "满血",
			hpDepleted: "已耗尽 · 改扣点数",
			hpRegenSoon: "即将 +1%",
			hpRegenIn: "{duration} +1%",
			hpBoost: "+{percent}% Boost",
			hpNonOpus: "按次消耗点数",
			anlasUnit: "Anlas",
			anlasBreakdown: "订阅 {monthly} · 购买 {paid}",
			unconfiguredHint: "尚未配置 API Token（前往设置 → 插件 → NovelAI 生图）",
			queryError: "额度查询失败",
			refresh: "刷新额度",
			refreshing: "刷新中…",
			retry: "重试",
			updatedJustNow: "刚刚更新",
			updatedMinutes: "{minutes} 分钟前更新",
			updatedHours: "{hours} 小时前更新",
			durationHoursMinutes: "{hours}h{minutes}m",
			durationHours: "{hours}h",
			durationMinutes: "{minutes}m",
			durationSeconds: "{seconds}s"
		};
		const en = {
			title: "NovelAI Images",
			brand: "NovelAI",
			token: "Persistent API Token",
			configured: "Configured",
			configuredEnv: "Configured (environment)",
			missing: "Not configured",
			saveToken: "Save token",
			removeToken: "Remove token",
			removedKeepEnv: "Removed stored token; environment variable is still active",
			check: "Verify connection and refresh quota",
			model: "Default model",
			steps: "Generation steps",
			directory: "Image output directory",
			timeout: "Request timeout (seconds)",
			save: "Save settings",
			saved: "Saved",
			tokenHint: "Get a Persistent API Token from NovelAI account settings. Saved via DSH credentials and excluded from chat history.",
			connected: "Connected and quota refreshed",
			balance: "Remaining Anlas",
			totalAnlas: "Total Anlas",
			subscription: "Subscription",
			active: "Active",
			inactive: "Inactive",
			paid: "Purchased",
			monthly: "Monthly",
			expiresAt: "Expires",
			tierOpus: "Opus",
			tierScroll: "Scroll",
			tierTablet: "Tablet",
			tierFree: "Free",
			tierInactive: "Expired",
			hpLabel: "V5 Usage",
			hpFull: "Full",
			hpDepleted: "Depleted · Uses Anlas",
			hpRegenSoon: "+1% soon",
			hpRegenIn: "{duration} +1%",
			hpBoost: "+{percent}% Boost",
			hpNonOpus: "Pay per generation",
			anlasUnit: "Anlas",
			anlasBreakdown: "Monthly {monthly} · Paid {paid}",
			unconfiguredHint: "API token not configured (Settings → Plugins → NovelAI Images)",
			queryError: "Quota check failed",
			refresh: "Refresh quota",
			refreshing: "Refreshing…",
			retry: "Retry",
			updatedJustNow: "Updated just now",
			updatedMinutes: "Updated {minutes}m ago",
			updatedHours: "Updated {hours}h ago",
			durationHoursMinutes: "{hours}h{minutes}m",
			durationHours: "{hours}h",
			durationMinutes: "{minutes}m",
			durationSeconds: "{seconds}s"
		};
		// src/client/helpers.ts
		function formatNumber(value) {
			return Math.round(value).toLocaleString("en-US");
		}
		function formatPercent(value) {
			return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
		}
		function formatCompactDuration(seconds, t) {
			if (seconds >= 3600) {
				const hours = Math.floor(seconds / 3600);
				const minutes = Math.floor(seconds % 3600 / 60);
				return minutes > 0 ? t("durationHoursMinutes", {
					hours,
					minutes
				}) : t("durationHours", { hours });
			}
			if (seconds >= 60) return t("durationMinutes", { minutes: Math.floor(seconds / 60) });
			return t("durationSeconds", { seconds: Math.max(1, Math.round(seconds)) });
		}
		function formatRelativeUpdate(fetchedAt, now, t) {
			if (fetchedAt === null) return "";
			const elapsedMinutes = Math.max(0, Math.floor((now - fetchedAt) / 6e4));
			if (elapsedMinutes < 1) return t("updatedJustNow");
			if (elapsedMinutes < 60) return t("updatedMinutes", { minutes: elapsedMinutes });
			return t("updatedHours", { hours: Math.floor(elapsedMinutes / 60) });
		}
		function tierLabelOf(data, t) {
			switch (subscriptionTierKind(data)) {
				case "opus": return t("tierOpus");
				case "scroll": return t("tierScroll");
				case "tablet": return t("tierTablet");
				case "inactive": return t("tierInactive");
				default: return t("tierFree");
			}
		}
		function formatUsageNote(usage, fetchedAt, now, t) {
			if (usage.isNegative || usage.percent <= 0 && usage.purchasedPercent <= 0) return t("hpDepleted");
			if (usage.percent >= 100) return t("hpFull");
			const remaining = remainingRegenSeconds(usage, fetchedAt, now);
			if (remaining === null) return "";
			if (remaining <= 0) return t("hpRegenSoon");
			return t("hpRegenIn", { duration: formatCompactDuration(remaining, t) });
		}
		/** 与 DSH ConversationMainPanel 严格对齐的首页空白会话（Hero）判定。 */
		function isHeroConversationPhase(session, conversation, summaryBlank) {
			if (session === void 0 || conversation === void 0) return true;
			return (conversation.activeTargets.size > 0 || !session.blank && !session.awaitingFirstTurn || session.running ? "active" : session.promptAttempted ? "engaging" : "blank") === "blank" && (session.openState === "open" || summaryBlank === true);
		}
		/**
		* 提取会话内 NovelAI 工具活动信号（纯原始数值以避免流式输出期间重渲染）：
		* - `0`：当前会话未使用过 NovelAI 工具
		* - `< 0`：当前正在执行 `novelai_*` 工具
		* - `> 0`：最近一次完成的 `novelai_*` 工具结果事件序号
		*/
		function selectNovelAISessionSignal(chat) {
			let latestSeq = 0;
			for (const node of chat.legacy.nodes) if (node.kind === "tool-result" && typeof node.name === "string" && node.name.startsWith("novelai_")) {
				if (node.seq > latestSeq) latestSeq = node.seq;
			}
			return chat.legacy.runningCalls.some((call) => call.name.startsWith("novelai_")) ? -(latestSeq + 1) : latestSeq;
		}
		// src/client/QuotaBar.tsx
		function SparkleGlyph() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "14",
				height: "14",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M8 1.25L9.55 5.65L14 7.2L9.55 8.75L8 13.15L6.45 8.75L2 7.2L6.45 5.65L8 1.25Z",
					fill: "currentColor"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M12.9 10.6L13.5 12.2L15.1 12.8L13.5 13.4L12.9 15L12.3 13.4L10.7 12.8L12.3 12.2L12.9 10.6Z",
					fill: "currentColor",
					opacity: "0.75"
				})]
			});
		}
		function RefreshGlyph({ spinning }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "13",
				height: "13",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				className: spinning ? "nai-spin" : void 0,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M13.2 8A5.2 5.2 0 1 1 11.78 4.42M13.4 2.5V5.3H10.6",
					stroke: "currentColor",
					strokeWidth: "1.45",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		function buildTooltipSummary(view, now, t) {
			const parts = [];
			if (view.data !== null) {
				parts.push(`${t("brand")} · ${tierLabelOf(view.data, t)}`);
				if (hasOpusUsageBar(view.data)) {
					const note = formatUsageNote(view.data.usage, view.fetchedAt, now, t);
					parts.push(`${t("hpLabel")} ${formatPercent(view.data.usage.percent)}${note ? ` (${note})` : ""}`);
				}
				parts.push(`${t("anlasBreakdown", {
					monthly: formatNumber(view.data.anlas.monthly),
					paid: formatNumber(view.data.anlas.paid)
				})}`);
			}
			const updated = formatRelativeUpdate(view.fetchedAt, now, t);
			if (updated) parts.push(updated);
			if (view.error) parts.push(view.error);
			return parts.join(" · ");
		}
		function useClockAndCountdownRefresh(view, refresh) {
			const [, tick] = (0, react.useReducer)((n) => n + 1, 0);
			(0, react.useEffect)(() => {
				const timer = setInterval(tick, 3e4);
				return () => clearInterval(timer);
			}, []);
			const now = Date.now();
			const refreshedForStampRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (view.data === null || !hasOpusUsageBar(view.data) || view.fetchedAt === null || view.refreshing) return;
				if (remainingRegenSeconds(view.data.usage, view.fetchedAt, now) === 0 && view.data.usage.timeUntilNextPercent > 0 && refreshedForStampRef.current !== view.fetchedAt) {
					refreshedForStampRef.current = view.fetchedAt;
					refresh();
				}
			}, [
				now,
				refresh,
				view.data,
				view.fetchedAt,
				view.refreshing
			]);
			return now;
		}
		/**
		* 挂载在 DSH 首页（Hero 空白会话态）输入框正下方的 NovelAI V5 血条与 Anlas 剩余点数横条。
		*/
		const NovelAIHomeBar = (0, react.memo)(function NovelAIHomeBar({ session, sessionId, useConversation, useSessions, useAccount, get, refresh, t }) {
			const hero = isHeroConversationPhase(session, useConversation((s) => s), useSessions((s) => s.byId[sessionId]?.blank));
			const view = useAccount((s) => s);
			const now = useClockAndCountdownRefresh(view, refresh);
			(0, react.useEffect)(() => {
				if (!hero) return;
				get();
			}, [hero, get]);
			if (!hero) return null;
			if (view.status === "idle" || view.status === "unavailable") return null;
			if (view.status === "unconfigured") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "nai-home-wrap",
				"data-novelai-home": "unconfigured",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "nai-home-bar",
					"data-compact": "true",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "nai-brand",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SparkleGlyph, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("brand") })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "nai-sep",
							"aria-hidden": "true",
							children: "·"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "nai-label-muted",
							children: t("unconfiguredHint")
						})
					]
				})
			});
			if (view.data === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "nai-home-wrap",
				"data-novelai-home": "error",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "nai-home-bar",
					"data-compact": "true",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "nai-brand",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SparkleGlyph, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("brand") })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "nai-sep",
							"aria-hidden": "true",
							children: "·"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "nai-label-muted",
							title: view.error ?? void 0,
							children: t("queryError")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "nai-retry-btn",
							disabled: view.refreshing,
							onClick: () => {
								refresh();
							},
							children: t(view.refreshing ? "refreshing" : "retry")
						})
					]
				})
			});
			const { data } = view;
			const tierKind = subscriptionTierKind(data);
			const opus = hasOpusUsageBar(data);
			const tone = opus ? usageTone(data.usage) : "healthy";
			const usageNote = opus ? formatUsageNote(data.usage, view.fetchedAt, now, t) : "";
			const tooltipSummary = buildTooltipSummary(view, now, t);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "nai-home-wrap",
				"data-novelai-home": "ready",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "nai-home-bar",
					role: "region",
					"aria-label": t("title"),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "nai-cluster",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "nai-brand",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SparkleGlyph, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("brand") })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "nai-tier-badge",
								"data-tier": tierKind,
								children: tierLabelOf(data, t)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "nai-sep",
								"aria-hidden": "true",
								children: "·"
							}),
							opus ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "nai-hp-group",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "nai-label-muted",
										children: t("hpLabel")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "nai-hp-track",
										role: "progressbar",
										"aria-label": t("hpLabel"),
										"aria-valuemin": 0,
										"aria-valuemax": 100,
										"aria-valuenow": Math.round(data.usage.percent),
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "nai-hp-fill",
											"data-tone": tone,
											style: { width: `${Math.max(0, Math.min(100, data.usage.percent))}%` }
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "nai-hp-value",
										"data-tone": tone,
										children: formatPercent(data.usage.percent)
									}),
									data.usage.purchasedPercent > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "nai-boost-pill",
										children: t("hpBoost", { percent: formatNumber(data.usage.purchasedPercent) })
									}),
									usageNote && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "nai-subnote",
										children: usageNote
									})
								]
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "nai-subnote",
								children: t("hpNonOpus")
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "nai-cluster",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "nai-label-muted",
								children: t("balance")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "nai-anlas-strong",
								children: [
									formatNumber(data.anlas.total),
									" ",
									t("anlasUnit")
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "nai-subnote nai-hide-narrow",
								children: [
									"(",
									t("anlasBreakdown", {
										monthly: formatNumber(data.anlas.monthly),
										paid: formatNumber(data.anlas.paid)
									}),
									")"
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
								label: tooltipSummary || t("refresh"),
								side: "top",
								delayMs: 200,
								portal: true,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "nai-icon-btn",
									"aria-label": t(view.refreshing ? "refreshing" : "refresh"),
									disabled: view.refreshing,
									onClick: () => {
										refresh();
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RefreshGlyph, { spinning: view.refreshing })
								})
							})
						]
					})]
				})
			});
		});
		/**
		* 挂载在活跃会话输入框下方 `conversation.composer.dock` 的紧凑状态胶囊；
		* 仅在当前会话调用过 `novelai_*` 工具时显示，并在每次生图完成后自动刷新额度。
		*/
		const NovelAIComposerDock = (0, react.memo)(function NovelAIComposerDock({ useChat, useAccount, get, refresh, t }) {
			const signal = useChat(selectNovelAISessionSignal);
			const view = useAccount((s) => s);
			const now = useClockAndCountdownRefresh(view, refresh);
			(0, react.useEffect)(() => {
				if (signal === 0) return;
				get();
				if (signal > 0) {
					const followUp = setTimeout(() => {
						get();
					}, 900);
					return () => clearTimeout(followUp);
				}
			}, [signal, get]);
			if (signal === 0) return null;
			if (view.status === "unavailable" || view.status === "unconfigured") return null;
			if (view.data === null) {
				if (view.status !== "error") return null;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "nai-dock",
					"data-novelai-dock": "error",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
						t("brand"),
						" · ",
						t("queryError")
					] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "nai-retry-btn",
						disabled: view.refreshing,
						onClick: () => {
							refresh();
						},
						children: t("retry")
					})]
				});
			}
			const { data } = view;
			const opus = hasOpusUsageBar(data);
			const tone = opus ? usageTone(data.usage) : "healthy";
			const toolRunning = signal < 0;
			const tooltipSummary = buildTooltipSummary(view, now, t);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "nai-dock",
				"data-novelai-dock": "ready",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "nai-brand",
						style: {
							fontWeight: 500,
							color: "var(--dsw-alias-label-secondary)"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SparkleGlyph, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("brand") })]
					}),
					opus && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "nai-hp-track nai-dock-hp",
						"aria-hidden": "true",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "nai-hp-fill",
							"data-tone": tone,
							style: { width: `${Math.max(0, Math.min(100, data.usage.percent))}%` }
						})
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "nai-hp-value",
						"data-tone": tone,
						style: { fontWeight: 500 },
						children: formatPercent(data.usage.percent)
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "nai-sep",
						"aria-hidden": "true",
						children: "·"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
						formatNumber(data.anlas.total),
						" ",
						t("anlasUnit")
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
						label: tooltipSummary || t("refresh"),
						side: "top",
						delayMs: 200,
						portal: true,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "nai-icon-btn",
							style: {
								width: 18,
								height: 18
							},
							"aria-label": t(view.refreshing ? "refreshing" : "refresh"),
							disabled: view.refreshing,
							onClick: () => {
								refresh();
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RefreshGlyph, { spinning: view.refreshing || toolRunning })
						})
					})
				]
			});
		});
		/**
		* 插件配置卡片内嵌的完整 V5 血条与 Anlas 账户面板。
		*/
		function AccountQuotaPanel({ view, onRefresh, t }) {
			const now = useClockAndCountdownRefresh(view, async () => {
				onRefresh();
				return view;
			});
			if (view.data === null) return null;
			const { data } = view;
			const tierKind = subscriptionTierKind(data);
			const opus = hasOpusUsageBar(data);
			const tone = opus ? usageTone(data.usage) : "healthy";
			const usageNote = opus ? formatUsageNote(data.usage, view.fetchedAt, now, t) : "";
			const updated = formatRelativeUpdate(view.fetchedAt, now, t);
			const expiresText = data.expiresAt !== null ? (/* @__PURE__ */ new Date(data.expiresAt * 1e3)).toLocaleDateString() : "—";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "nai-quota-panel",
				"data-novelai-settings-quota": "",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "nai-quota-header",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "nai-cluster",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "nai-brand",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SparkleGlyph, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("brand") })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "nai-tier-badge",
									"data-tier": tierKind,
									children: tierLabelOf(data, t)
								}),
								updated && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "nai-subnote",
									children: updated
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "nai-retry-btn",
							disabled: view.refreshing,
							onClick: onRefresh,
							children: t(view.refreshing ? "refreshing" : "refresh")
						})]
					}),
					opus && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "nai-quota-hp-box",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "nai-quota-hp-top",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "nai-cluster",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("hpLabel") }), data.usage.purchasedPercent > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "nai-boost-pill",
									children: t("hpBoost", { percent: formatNumber(data.usage.purchasedPercent) })
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "nai-cluster",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "nai-hp-value",
									"data-tone": tone,
									children: formatPercent(data.usage.percent)
								}), usageNote && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "nai-subnote",
									children: [
										"(",
										usageNote,
										")"
									]
								})]
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "nai-hp-track nai-quota-hp-bar",
							role: "progressbar",
							"aria-label": t("hpLabel"),
							"aria-valuemin": 0,
							"aria-valuemax": 100,
							"aria-valuenow": Math.round(data.usage.percent),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "nai-hp-fill",
								"data-tone": tone,
								style: { width: `${Math.max(0, Math.min(100, data.usage.percent))}%` }
							})
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
						className: "nai-quota-grid",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "nai-quota-item",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("totalAnlas") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [
									formatNumber(data.anlas.total),
									" ",
									t("anlasUnit")
								] })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "nai-quota-item",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("monthly") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: formatNumber(data.anlas.monthly) })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "nai-quota-item",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("paid") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: formatNumber(data.anlas.paid) })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "nai-quota-item",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dt", { children: [
									t("subscription"),
									" / ",
									t("expiresAt")
								] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [
									t(data.active ? "active" : "inactive"),
									" · ",
									expiresText
								] })]
							})
						]
					})
				]
			});
		}
		// src/client/styles.ts
		const STYLE_ATTR = "dsh-novelai";
		const CSS = `
@keyframes nai-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.nai-spin {
  animation: nai-spin 0.85s linear infinite;
}

/* 首页 Hero 底部状态条容器：位于 conversation.input.dock，借 order: 2 排在首页输入卡片正下方 */
.nai-home-wrap {
  order: 2;
  display: flex;
  justify-content: center;
  width: 100%;
  box-sizing: border-box;
  padding: 2px var(--dsh-composer-side-clearance, 16px) 0;
}

.nai-home-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 14px;
  width: 100%;
  max-width: var(--dsh-composer-card-max-width, 760px);
  box-sizing: border-box;
  padding: 7px 14px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 76%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}

.nai-home-bar[data-compact='true'] {
  justify-content: center;
  width: auto;
  max-width: var(--dsh-composer-card-max-width, 760px);
  padding: 5px 12px;
  border-radius: 999px;
}

.nai-cluster {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  min-width: 0;
}

.nai-brand {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
}

.nai-brand svg {
  flex: none;
  color: var(--dsw-alias-state-business-primary);
}

.nai-tier-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  white-space: nowrap;
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-secondary);
}

.nai-tier-badge[data-tier='opus'] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 42%, var(--dsw-alias-border-l2));
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);
  color: var(--dsw-alias-state-business-primary);
}

.nai-tier-badge[data-tier='inactive'] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, var(--dsw-alias-border-l2));
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent);
  color: var(--dsw-alias-state-warn-primary);
}

.nai-sep {
  color: var(--dsw-alias-separator-primary, var(--dsw-alias-border-l3));
  user-select: none;
}

.nai-hp-group {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.nai-label-muted {
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
}

.nai-hp-track {
  position: relative;
  display: block;
  width: 88px;
  height: 7px;
  border-radius: 999px;
  overflow: hidden;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 13%, transparent);
  flex: none;
}

/* 四等分刻度线，增强“血条”直观刻度感 */
.nai-hp-track::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: linear-gradient(
    to right,
    transparent calc(25% - 0.5px),
    color-mix(in srgb, var(--dsw-alias-bg-base) 52%, transparent) calc(25% - 0.5px),
    color-mix(in srgb, var(--dsw-alias-bg-base) 52%, transparent) calc(25% + 0.5px),
    transparent calc(25% + 0.5px),
    transparent calc(50% - 0.5px),
    color-mix(in srgb, var(--dsw-alias-bg-base) 52%, transparent) calc(50% - 0.5px),
    color-mix(in srgb, var(--dsw-alias-bg-base) 52%, transparent) calc(50% + 0.5px),
    transparent calc(50% + 0.5px),
    transparent calc(75% - 0.5px),
    color-mix(in srgb, var(--dsw-alias-bg-base) 52%, transparent) calc(75% - 0.5px),
    color-mix(in srgb, var(--dsw-alias-bg-base) 52%, transparent) calc(75% + 0.5px),
    transparent calc(75% + 0.5px)
  );
  pointer-events: none;
}

.nai-hp-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  transition: width 260ms ease, background 260ms ease;
  background: linear-gradient(
    90deg,
    var(--dsw-alias-state-success-primary),
    var(--dsw-alias-state-success-secondary, var(--dsw-alias-state-success-primary))
  );
}

.nai-hp-fill[data-tone='warn'] {
  background: linear-gradient(
    90deg,
    var(--dsw-alias-state-warn-primary),
    var(--dsw-alias-state-warn-secondary, var(--dsw-alias-state-warn-primary))
  );
}

.nai-hp-fill[data-tone='low'] {
  background: linear-gradient(
    90deg,
    var(--dsw-alias-state-error-primary),
    var(--dsw-alias-state-error-secondary, var(--dsw-alias-state-error-primary))
  );
}

.nai-hp-value {
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
}

.nai-hp-value[data-tone='warn'] {
  color: var(--dsw-alias-state-warn-primary);
}

.nai-hp-value[data-tone='low'] {
  color: var(--dsw-alias-state-error-primary);
}

.nai-boost-pill {
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);
  color: var(--dsw-alias-state-business-primary);
  white-space: nowrap;
}

.nai-subnote {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  white-space: nowrap;
}

.nai-anlas-strong {
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
}

.nai-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0.5px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

@media (hover: hover) {
  .nai-icon-btn:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-primary);
  }
}

.nai-icon-btn:disabled {
  cursor: default;
  opacity: 0.6;
}

.nai-retry-btn {
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  padding: 1px 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
}

@media (hover: hover) {
  .nai-retry-btn:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}

/* 对话进行中底部 composer.dock 紧凑胶囊 */
.nai-dock {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 1px 6px;
  border-radius: var(--dsw-radius-sm, 6px);
  color: var(--dsw-alias-label-tertiary);
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.nai-dock-hp {
  width: 42px;
  height: 5px;
}

.nai-dock-hp::after {
  display: none;
}

/* 插件配置页额度面板 */
.nai-quota-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-xl, 12px);
  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-3));
  font-variant-numeric: tabular-nums;
}

.nai-quota-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
}

.nai-quota-hp-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.nai-quota-hp-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 10px;
  font-size: 13px;
}

.nai-quota-hp-bar {
  width: 100%;
  height: 9px;
}

.nai-quota-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px 14px;
  margin: 0;
  padding-top: 4px;
}

.nai-quota-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.nai-quota-item dt {
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}

.nai-quota-item dd {
  margin: 0;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

@media (max-width: 640px) {
  .nai-hide-narrow {
    display: none;
  }
  .nai-home-bar {
    padding: 7px 11px;
    gap: 6px 10px;
  }
  .nai-hp-track:not(.nai-quota-hp-bar):not(.nai-dock-hp) {
    width: 68px;
  }
}
`;
		function ensureStyles() {
			if (typeof document === "undefined") return () => {};
			const existing = document.querySelector(`style[data-plugin="${STYLE_ATTR}"]`);
			if (existing !== null) {
				existing.textContent = CSS;
				return () => {};
			}
			const tag = document.createElement("style");
			tag.dataset.plugin = STYLE_ATTR;
			tag.textContent = CSS;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}
		// src/client/index.tsx
		function createSettingsFace(ctx, controller) {
			const form = ctx.configForms.get("novelai");
			return {
				hooks: { account: controller.account },
				getSnapshot: () => form.getSnapshot(),
				subscribe: (listener) => form.subscribe(listener),
				getAccount: () => controller.get(),
				refreshAccount: async () => {
					const next = await controller.refresh();
					if (next.status === "error" && next.error) throw new Error(next.error);
					if (next.status === "unavailable") throw new Error("无法连接本机 NovelAI 插件服务");
					return next;
				},
				async save(settings) {
					const outputDirectory = settings.outputDirectory.trim();
					if (!outputDirectory) throw new Error("图片输出目录不能为空");
					if (!MODELS.some((model) => model.id === settings.model)) throw new Error(`不支持的默认模型：${settings.model}`);
					if (!Number.isInteger(settings.steps) || settings.steps < 1 || settings.steps > 50) throw new Error("生成步数必须为 1..50 的整数");
					if (!Number.isFinite(settings.timeoutSeconds) || settings.timeoutSeconds < 1) throw new Error("请求超时必须为不小于 1 的数字");
					const normalized = {
						model: settings.model,
						steps: settings.steps,
						outputDirectory,
						timeoutSeconds: Math.round(settings.timeoutSeconds)
					};
					for (const key of [
						"model",
						"steps",
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
					await controller.refresh();
				}
			};
		}
		function NovelAICard({ t, useAccount, getSnapshot, subscribe, status, token, getAccount, refreshAccount, save }) {
			const config = (0, react.useSyncExternalStore)(subscribe, getSnapshot);
			const accountView = useAccount((s) => s);
			const [draft, setDraft] = (0, react.useState)(DEFAULT_SETTINGS);
			const [secret, setSecret] = (0, react.useState)("");
			const [credential, setCredential] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [message, setMessage] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				if (config.value) setDraft(config.value);
			}, [config.value]);
			(0, react.useEffect)(() => {
				let active = true;
				status().then((next) => {
					if (!active) return;
					setCredential(next);
					if (next.configured) getAccount();
				}, (error) => {
					if (active) setMessage(String(error));
				});
				return () => {
					active = false;
				};
			}, [status, getAccount]);
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
			const configured = credential !== null ? credential.configured : accountView.status === "ready";
			const writable = credential?.writable ?? true;
			const statusKey = !configured ? "missing" : credential?.source && credential.source !== "file" ? "configuredEnv" : "configured";
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountQuotaPanel, {
						view: accountView,
						onRefresh: () => {
							run(async () => {
								await refreshAccount();
							}, t("connected"));
						},
						t
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
								disabled: busy || !writable || !secret.trim(),
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
								disabled: busy || !writable || !configured,
								onClick: () => {
									run(async () => {
										await token(void 0);
										const next = await status();
										setCredential(next);
										if (next.configured && next.source && next.source !== "file") return t("removedKeepEnv");
									});
								},
								children: t("removeToken")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								disabled: busy || !configured,
								onClick: () => {
									run(async () => {
										await refreshAccount();
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
						children: [t("steps"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: inputStyle,
							type: "number",
							min: 1,
							max: 50,
							step: 1,
							value: draft.steps,
							onChange: (event) => setDraft({
								...draft,
								steps: Number(event.target.value)
							})
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
					})
				]
			});
		}
		const inject = [
			"slots",
			"locale",
			"connection"
		];
		function apply(ctx) {
			ctx.effect(() => ensureStyles(), "novelai: styles");
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "novelai: locale");
			const controller = createAccountController(ctx);
			const quotaFace = controller.quotaFace();
			ctx.effect(() => {
				const disposeReset = ctx.on("connection/reset", () => {
					controller.get();
				});
				return () => {
					disposeReset();
				};
			}, "novelai: connection reset");
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "novelai-home-quota",
				order: 90,
				locale: NS,
				inject: () => quotaFace
			}, NovelAIHomeBar));
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "novelai-quota",
				order: 20,
				locale: NS,
				inject: () => quotaFace
			}, NovelAIComposerDock));
			ctx.inject([
				"remote",
				"remote.credentials",
				"configForms"
			], (settingsCtx) => {
				const settingsFace = createSettingsFace(settingsCtx, controller);
				settingsCtx.slots.inject("plugins.bundle.config", () => settingsCtx.slots.register({
					name: "plugins.bundle.config",
					key: "dsh-novelai",
					locale: NS,
					inject: () => settingsFace
				}, NovelAICard));
			});
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map