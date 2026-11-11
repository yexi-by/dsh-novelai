export const CREDENTIAL_REF = 'NOVELAI_API_TOKEN'
export const RPC_CHANNEL = '/dsh-novelai'
export const DEFAULT_MODEL = 'nai-diffusion-5-full'
export const API_ORIGIN = 'https://image.novelai.net'
export const BLUR_SIGMA_VALUES = [0, 0.3, 0.35, 0.4, 0.45, 0.5] as const

export interface Settings {
  model: string
  outputDirectory: string
  timeoutSeconds: number
}

export const DEFAULT_SETTINGS: Settings = {
  model: DEFAULT_MODEL,
  outputDirectory: 'novelai-output',
  timeoutSeconds: 300,
}

export interface SavedImage {
  path: string
  width: number
  height: number
  seed?: number
  markdown: string
}

export interface ImageResult {
  images: SavedImage[]
  metadata_path: string
  model?: string
}

export interface ModelSpec {
  readonly id: string
  readonly label: string
  readonly family: 3 | 4 | 4.5 | 5
  readonly characters: number
  readonly vibe: boolean
  readonly precise: boolean
  readonly inpaint: string
  readonly alpha: boolean
}

export const MODELS: readonly ModelSpec[] = [
  { id: 'nai-diffusion-5-full', label: 'V5 Full', family: 5, characters: 22, vibe: false, precise: false, inpaint: 'nai-diffusion-5-full-inpainting', alpha: true },
  { id: 'nai-diffusion-5-curated', label: 'V5 Curated', family: 5, characters: 22, vibe: false, precise: false, inpaint: 'nai-diffusion-4-5-curated-inpainting', alpha: true },
  { id: 'nai-diffusion-4-5-full', label: 'V4.5 Full', family: 4.5, characters: 6, vibe: true, precise: true, inpaint: 'nai-diffusion-4-5-full-inpainting', alpha: false },
  { id: 'nai-diffusion-4-5-curated', label: 'V4.5 Curated', family: 4.5, characters: 6, vibe: true, precise: true, inpaint: 'nai-diffusion-4-5-curated-inpainting', alpha: false },
  { id: 'nai-diffusion-4-full', label: 'V4 Full', family: 4, characters: 6, vibe: true, precise: false, inpaint: 'nai-diffusion-4-full-inpainting', alpha: false },
  { id: 'nai-diffusion-4-curated-preview', label: 'V4 Curated', family: 4, characters: 6, vibe: true, precise: false, inpaint: 'nai-diffusion-4-curated-inpainting', alpha: false },
  { id: 'nai-diffusion-3', label: 'V3 Anime', family: 3, characters: 0, vibe: true, precise: false, inpaint: 'nai-diffusion-3-inpainting', alpha: false },
  { id: 'nai-diffusion-furry-3', label: 'V3 Furry', family: 3, characters: 0, vibe: true, precise: false, inpaint: 'nai-diffusion-furry-3-inpainting', alpha: false },
]

export function modelInfo(id: string): ModelSpec {
  const exact = MODELS.find(model => model.id === id)
  if (exact) return exact
  // V5 Curated 复用 nai-diffusion-4-5-curated-inpainting；按命名前缀优先归属到真实的 V4.5 Curated 规格。
  const inpaint = MODELS.find(model => model.inpaint === id && `${model.id}-inpainting` === id)
    ?? MODELS.findLast(model => model.inpaint === id)
  if (!inpaint) throw new Error(`未知模型 ${id}。使用 novelai_capabilities 查询支持的模型。`)
  return inpaint
}

export function resolveGenerationModel(requested: string, action: string): { targetId: string; model: ModelSpec } {
  const base = modelInfo(requested)
  const targetId = action === 'infill'
    ? (requested.endsWith('-inpainting') ? requested : base.inpaint)
    : requested
  return { targetId, model: modelInfo(targetId) }
}

export interface NovelAIUsageBar {
  /** 归一化后的常规 V5 体力百分比（0..100）。 */
  percent: number
  /** 服务端返回的原始 percent 数值。 */
  rawPercent: number
  /** Opus Usage Boost 额外购买百分比（每个 Boost 为 +100%）。 */
  purchasedPercent: number
  /** 是否已跌破常规阈值进入透支/耗尽状态（耗尽后标准 V5 生图改扣 Anlas）。 */
  isNegative: boolean
  /** 服务端返回的恢复 +1% 所需秒数（注意：满血 100% 时服务端仍可能返回滚动计时值）。 */
  timeUntilNextPercent: number
}

export interface NovelAIAccountData {
  active: boolean
  /** 订阅档位：0 = Free/Paper, 1 = Tablet, 2 = Scroll, 3 = Opus。 */
  tier: number
  /** 订阅到期秒级时间戳；无有效时间戳时为 null。 */
  expiresAt: number | null
  anlas: {
    /** 月度订阅赠送点数（fixedTrainingStepsLeft）。 */
    monthly: number
    /** 永久购买点数（purchasedTrainingSteps）。 */
    paid: number
    /** 总可用点数（monthly + paid）。 */
    total: number
  }
  /** V5 Opus 血条信息；服务端未返回时为 null。 */
  usage: NovelAIUsageBar | null
}

export interface NovelAIAccountSnapshot {
  /** 当前凭据服务是否已配置 NOVELAI_API_TOKEN。 */
  configured: boolean
  /** 最近一次成功解析的账户与额度数据。 */
  data: NovelAIAccountData | null
  /** 最近一次成功拉取的毫秒级时间戳。 */
  fetchedAt: number | null
  /** 最近一次查询错误（仅在 configured 为 true 且请求失败时非空）。 */
  error: string | null
  /** 是否正在向 NovelAI 请求最新额度。 */
  refreshing: boolean
  /** 每次扣费/生图工具完成后递增的序号，供前端感知额度变动。 */
  activitySeq: number
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * 解析并校验 NovelAI `/user/subscription` 响应体。
 */
export function parseAccountSubscription(raw: unknown): NovelAIAccountData {
  if (!isPlainRecord(raw) || typeof raw.active !== 'boolean' || !isPlainRecord(raw.trainingStepsLeft)) {
    throw new Error('NovelAI 账户响应格式不正确')
  }
  const monthlyRaw = finiteNumber(raw.trainingStepsLeft.fixedTrainingStepsLeft)
  const paidRaw = finiteNumber(raw.trainingStepsLeft.purchasedTrainingSteps)
  if (monthlyRaw === undefined || paidRaw === undefined) {
    throw new Error('NovelAI 账户响应缺少有效的 Anlas 点数字段')
  }
  const monthly = Math.max(0, Math.round(monthlyRaw))
  const paid = Math.max(0, Math.round(paidRaw))
  const tierRaw = finiteNumber(raw.tier)
  const tier = tierRaw !== undefined ? Math.max(0, Math.trunc(tierRaw)) : 0
  const expiresRaw = finiteNumber(raw.expiresAt)
  const expiresAt = expiresRaw !== undefined && expiresRaw > 0 ? Math.trunc(expiresRaw) : null

  let usage: NovelAIUsageBar | null = null
  if (isPlainRecord(raw.usage)) {
    const percentRaw = finiteNumber(raw.usage.percent)
    if (percentRaw !== undefined) {
      const isNegative = raw.usage.isNegative === true || percentRaw < 0
      const normalizedPercent = isNegative
        ? 0
        : Math.max(0, Math.min(100, Math.round(percentRaw * 10) / 10))
      const purchasedRaw = finiteNumber(raw.usage.purchasedPercent) ?? 0
      const nextRaw = finiteNumber(raw.usage.timeUntilNextPercent) ?? 0
      usage = {
        percent: normalizedPercent,
        rawPercent: Math.round(percentRaw * 10) / 10,
        purchasedPercent: Math.max(0, Math.round(purchasedRaw * 10) / 10),
        isNegative,
        timeUntilNextPercent: Math.max(0, Math.round(nextRaw)),
      }
    }
  }

  return {
    active: raw.active,
    tier,
    expiresAt,
    anlas: {
      monthly,
      paid,
      total: monthly + paid,
    },
    usage,
  }
}

/** 仅生效中的 Opus（tier >= 3）享有 0 点数标准生图的 V5 血条机制。 */
export function hasOpusUsageBar(data: NovelAIAccountData): data is NovelAIAccountData & { usage: NovelAIUsageBar } {
  return data.active && data.tier >= 3 && data.usage !== null
}

/** 根据剩余血量判定血条状态色档位。 */
export function usageTone(usage: NovelAIUsageBar): 'healthy' | 'warn' | 'low' {
  if (usage.isNegative || usage.percent < 25) return 'low'
  if (usage.percent < 60) return 'warn'
  return 'healthy'
}

/**
 * 计算距离恢复 +1% 血量的剩余秒数。
 * 满血（>=100% 且未透支）时不显示恢复倒计时，避免服务端固定返回滚动周期造成误导。
 */
export function remainingRegenSeconds(usage: NovelAIUsageBar, fetchedAt: number | null, now: number): number | null {
  if (!usage.isNegative && usage.percent >= 100) return null
  if (usage.timeUntilNextPercent <= 0) return null
  const elapsedSeconds = fetchedAt !== null ? Math.max(0, (now - fetchedAt) / 1000) : 0
  return Math.max(0, Math.round(usage.timeUntilNextPercent - elapsedSeconds))
}

export type SubscriptionTierKind = 'opus' | 'scroll' | 'tablet' | 'free' | 'inactive'

export function subscriptionTierKind(data: NovelAIAccountData): SubscriptionTierKind {
  if (!data.active) return data.tier > 0 ? 'inactive' : 'free'
  if (data.tier >= 3) return 'opus'
  if (data.tier === 2) return 'scroll'
  if (data.tier === 1) return 'tablet'
  return 'free'
}
