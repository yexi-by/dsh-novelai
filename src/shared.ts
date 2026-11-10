export const CREDENTIAL_REF = 'NOVELAI_API_TOKEN'
export const RPC_CHANNEL = '/dsh-novelai'
export const DEFAULT_MODEL = 'nai-diffusion-5-full'
export const API_ORIGIN = 'https://image.novelai.net'

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
