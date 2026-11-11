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
