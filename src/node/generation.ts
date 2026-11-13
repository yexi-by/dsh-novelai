import { createHash, randomInt, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import sharp from 'sharp'
import { BLUR_SIGMA_VALUES, FREE_MAX_AREA, FREE_MAX_STEPS } from '../shared.ts'
import type { Settings } from '../shared.ts'
import type { ApiPayload, Json, NovelAIClient } from './api.ts'
import { modelInfo, resolveGenerationModel } from './models.ts'
import { applyChineseAutoText, applyQualityTags, applyUcPreset, resolveQualityPreset, resolveUcPreset } from './presets.ts'
import { assertWritablePaths } from './storage.ts'

export interface Character { prompt: string; negative_prompt?: string; positions?: { x: number; y: number }[] }
export interface Vibe { image_path?: string; encoding_path?: string; information_extracted?: number; strength?: number }
export interface PreciseReference { image_path: string; type?: 'character' | 'style' | 'character&style'; fidelity?: number; strength?: number; information_extracted?: number }
export interface GenerateArgs {
  prompt: string
  negative_prompt?: string
  model?: string
  action?: 'generate' | 'img2img' | 'infill' | 'enhance'
  image_path?: string
  mask_path?: string
  characters?: Character[]
  use_coords?: boolean
  transparent_background?: boolean
  vibes?: Vibe[]
  references?: PreciseReference[]
  parameters?: ApiPayload
}

export type ReadImage = (path: string) => Promise<Buffer>
export type GenerationSettings = Pick<Settings, 'model' | 'steps' | 'scale' | 'sampler' | 'cfgRescale' | 'qualityPreset' | 'ucPreset' | 'autoText'>

/** Agent 可调的生成参数；采样器、步数、CFG、预设等由插件设置统一控制。 */
export const AGENT_PARAMETERS = ['width', 'height', 'seed', 'strength', 'noise', 'extra_noise_seed', 'add_original_image', 'color_correct', 'image_format'] as const

const MAX_DIMENSION = 2048
/** V4/V4.5 自定义站位只支持 5×5 网格中心点。 */
const GRID = [0.1, 0.3, 0.5, 0.7, 0.9]

/** 官网按采样器推导噪声调度；V5 不发送该字段，由服务端决定。 */
export function noiseScheduleFor(sampler: string): string {
  switch (sampler) {
    case 'k_euler': case 'k_euler_ancestral': case 'k_dpmpp_sde': case 'k_dpmpp_2s_ancestral': case 'k_dpmpp_2m_sde': return 'karras'
    case 'k_dpm_2': case 'k_dpmpp_2m': return 'exponential'
    default: return 'native'
  }
}

export async function normalizeImage(bytes: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const meta = await sharp(bytes).metadata()
  if (!meta.width || !meta.height) throw new Error('输入图片缺少有效宽高信息')
  if (meta.orientation && meta.orientation > 1) {
    const { data, info } = await sharp(bytes).rotate().png().toBuffer({ resolveWithObject: true })
    return { data, width: info.width, height: info.height }
  }
  return { data: bytes, width: meta.width, height: meta.height }
}

/** 源图自动适配到 Opus 免费面积内的 64 倍数画布。 */
export function fitCanvasSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_DIMENSION / width, MAX_DIMENSION / height, Math.sqrt(FREE_MAX_AREA / (width * height)))
  let w = Math.min(MAX_DIMENSION, Math.max(64, Math.round((width * scale) / 64) * 64))
  let h = Math.min(MAX_DIMENSION, Math.max(64, Math.round((height * scale) / 64) * 64))
  while (w * h > FREE_MAX_AREA) {
    if (w >= h) w -= 64
    else h -= 64
  }
  return { width: w, height: h }
}

export function validateBlurSigma(value: unknown): number {
  if (typeof value !== 'number' || !BLUR_SIGMA_VALUES.includes(value as (typeof BLUR_SIGMA_VALUES)[number])) {
    throw new Error(`declared_blur_sigma 必须为 ${BLUR_SIGMA_VALUES.join('、')} 之一`)
  }
  return value
}

export async function generationPayload(
  args: GenerateArgs,
  settings: GenerationSettings,
  read: ReadImage,
  encode: (vibe: Vibe, model: string) => Promise<EncodedVibe>,
): Promise<ApiPayload> {
  if (!args.prompt.trim()) throw new Error('prompt 不能为空')
  const requested = args.model ?? settings.model
  const action = args.action === 'enhance' ? 'img2img' : args.action ?? 'generate'
  const { targetId, model } = resolveGenerationModel(requested, action)

  const extra = args.parameters ?? {}
  const blocked = Object.keys(extra).filter(key => !(AGENT_PARAMETERS as readonly string[]).includes(key))
  if (blocked.length) {
    throw new Error(`parameters 仅支持 ${AGENT_PARAMETERS.join('、')}；${blocked.join('、')} 由插件设置统一控制或会超出 Opus 免费范围`)
  }
  if (!Number.isInteger(settings.steps) || settings.steps < 1 || settings.steps > FREE_MAX_STEPS) {
    throw new Error(`插件设置中的生成步数必须为 1..${FREE_MAX_STEPS}`)
  }

  const p: ApiPayload = {
    params_version: model.family >= 4 ? 4 : 3,
    width: 832, height: 1216,
    scale: settings.scale,
    sampler: settings.sampler,
    steps: settings.steps,
    seed: randomInt(0, 2 ** 32), n_samples: 1, image_format: 'png',
    cfg_rescale: settings.cfgRescale,
    deliberate_euler_ancestral_bug: false, prefer_brownian: true,
    ...extra,
  }
  // V5 不开放噪声调度选择（官网不发送该字段）；旧模型按采样器推导。
  if (model.family < 5) p.noise_schedule = noiseScheduleFor(settings.sampler)

  if (args.image_path) {
    const normalized = await normalizeImage(await read(args.image_path))
    const fitted = fitCanvasSize(normalized.width, normalized.height)
    p.width = extra.width ?? fitted.width
    p.height = extra.height ?? fitted.height
    for (const name of ['width', 'height'] as const) validateDimension(name, p[name])
    p.image = (await sharp(normalized.data).resize(p.width as number, p.height as number, { fit: 'fill' }).png().toBuffer()).toString('base64')
  }
  for (const name of ['width', 'height'] as const) validateDimension(name, p[name])
  const area = (p.width as number) * (p.height as number)
  if (area > FREE_MAX_AREA) {
    throw new Error(`画布 ${p.width}×${p.height} 超出 Opus 免费范围（面积 ≤ ${FREE_MAX_AREA.toLocaleString('en-US')} 像素，例如 832×1216、1216×832、1024×1024）`)
  }
  if (typeof p.seed !== 'number' || !Number.isInteger(p.seed) || p.seed < 0 || p.seed >= 2 ** 32) throw new Error('seed 必须位于 0..4294967295')

  if (args.mask_path) {
    const normalizedMask = await normalizeImage(await read(args.mask_path))
    const mask = await sharp(normalizedMask.data)
      .flatten({ background: '#000' })
      .greyscale()
      .resize(p.width as number, p.height as number, { fit: 'fill', kernel: 'nearest' })
      .png()
      .toBuffer()
    p.mask = mask.toString('base64')
  }
  if (action !== 'generate' && !p.image) throw new Error(`${action} 需要 image_path`)
  if (action === 'infill' && !p.mask) throw new Error('局部重绘需要 mask_path（白色重绘、黑色保留）')

  if (action === 'img2img') {
    p.strength = range('strength', typeof p.strength === 'number' ? p.strength : (args.action === 'enhance' ? 0.2 : 0.7))
    p.noise = range('noise', typeof p.noise === 'number' ? p.noise : (args.action === 'enhance' ? 0 : 0.2))
  } else if (action === 'infill') {
    const strength = range('strength', typeof p.strength === 'number' ? p.strength : 1)
    const noise = range('noise', typeof p.noise === 'number' ? p.noise : 0)
    p.strength = strength
    p.noise = noise
    p.add_original_image ??= true
    p.color_correct ??= true
    p.img2img = { strength, noise, color_correct: Boolean(p.color_correct) }
  }

  // 提示词组装：中文台词自动转 Text: → 官方质量标签 / 透明背景标签 → 官方 UC 预设。
  const characters = args.characters ?? []
  if (characters.length && model.family < 4) throw new Error('独立角色提示词需要 V4 或更高模型')
  if (characters.length > model.characters) throw new Error(`${model.label} 最多支持 ${model.characters} 个角色提示词`)
  for (const character of characters) for (const pos of character.positions ?? []) {
    range('角色 x', pos.x); range('角色 y', pos.y)
  }
  const transparent = Boolean(args.transparent_background)
  if (transparent && !model.alpha) throw new Error(`${model.label} 不支持透明背景，请使用 V5 模型`)
  const useCoords = args.use_coords ?? characters.some(character => character.positions?.length)

  let prompt = args.prompt.trim()
  if (settings.autoText && model.family >= 5) prompt = applyChineseAutoText(prompt, characters, Boolean(useCoords))
  const quality = resolveQualityPreset(model, settings.qualityPreset)
  const uc = resolveUcPreset(model, settings.ucPreset)
  prompt = applyQualityTags(prompt, quality, transparent)
  const negative = applyUcPreset(args.negative_prompt ?? '', uc)
  p.negative_prompt = negative
  p.tag_hint_qt = quality.index
  p.tag_hint_uc_preset = uc.index
  if (transparent) p.tag_hint_transparent_background = true

  if (model.family >= 4) {
    const snap = (value: number) => model.family >= 5 ? value : GRID[Math.min(4, Math.max(0, Math.floor(5 * value)))]
    const centers = (character: Character) => (character.positions?.length ? character.positions : [{ x: 0.5, y: 0.5 }])
      .map(pos => ({ x: snap(pos.x), y: snap(pos.y) }))
    p.v4_prompt = {
      caption: { base_caption: prompt, char_captions: characters.map(character => ({ char_caption: character.prompt, centers: centers(character) })) },
      use_coords: Boolean(useCoords),
      use_order: true,
    } as Json
    p.v4_negative_prompt = {
      caption: { base_caption: negative, char_captions: characters.map(character => ({ char_caption: character.negative_prompt ?? '', centers: centers(character) })) },
      legacy_uc: false,
    } as Json
  }

  const hasVibes = Boolean(args.vibes?.length)
  const hasReferences = Boolean(args.references?.length)
  if (hasVibes && !model.vibe) throw new Error(`${model.label} 尚不支持 Vibe Transfer，请显式选择 V4.5/V4/V3`)
  if (hasReferences && !model.precise) throw new Error('Precise Reference 当前只支持 V4.5 模型，请显式指定模型')
  if (hasVibes && hasReferences) throw new Error('NovelAI 当前不支持同时使用 Vibe Transfer 与 Precise Reference')
  if (args.vibes?.length) {
    if (args.vibes.length > 16) throw new Error('最多支持 16 个 Vibe')
    const baseVibeModel = model.id
    const encoded = await Promise.all(args.vibes.map(async vibe => {
      if (model.family >= 4) return encode(vibe, baseVibeModel)
      if (!vibe.image_path) throw new Error('V3 Vibe 需要原始 image_path')
      const normalized = await normalizeImage(await read(vibe.image_path))
      return { encoding: normalized.data.toString('base64'), information_extracted: vibe.information_extracted ?? 1, model: baseVibeModel }
    }))
    p.reference_image_multiple = encoded.map(vibe => vibe.encoding)
    p.reference_information_extracted_multiple = encoded.map(vibe => range('information_extracted', vibe.information_extracted))
    p.reference_strength_multiple = args.vibes.map(vibe => range('Vibe strength', vibe.strength ?? 0.6))
  }
  if (args.references?.length) {
    p.director_reference_images = await Promise.all(args.references.map(async reference => (await prepareReference(await read(reference.image_path))).toString('base64')))
    p.director_reference_descriptions = args.references.map(reference => ({ caption: { base_caption: reference.type ?? 'character', char_captions: [] } }))
    p.director_reference_information_extracted = args.references.map(reference => range('information_extracted', reference.information_extracted ?? 1))
    p.director_reference_strength_values = args.references.map(reference => range('reference strength', reference.strength ?? 1))
    p.director_reference_secondary_strength_values = args.references.map(reference => 1 - range('fidelity', reference.fidelity ?? 1))
  }
  return { input: prompt, model: targetId, action, parameters: p }
}

export async function prepareReference(data: Buffer): Promise<Buffer> {
  const normalized = await normalizeImage(data)
  const ratio = normalized.width / normalized.height
  const size = [[1024, 1536], [1472, 1472], [1536, 1024]].sort((a, b) => Math.abs(Math.log(ratio / (a[0] / a[1]))) - Math.abs(Math.log(ratio / (b[0] / b[1]))))[0]
  return sharp(normalized.data).flatten({ background: '#000' }).resize(size[0], size[1], { fit: 'contain', background: '#000' }).png().toBuffer()
}

export interface EncodedVibe { model: string; information_extracted: number; encoding: string }

export async function encodeVibe(
  client: NovelAIClient,
  data: Buffer,
  model: string,
  information: number,
  cacheDirectory: string,
  signal: AbortSignal,
  options: ApiPayload = {},
  policy?: SandboxExecutionPolicy,
): Promise<{ path: string; value: EncodedVibe; cached: boolean }> {
  const info = modelInfo(model)
  if (model.endsWith('-inpainting') || !info.vibe || info.family < 4) {
    throw new Error('独立 Vibe 编码需要基础 V4/V4.5 模型；V3 直接使用原图，V5 暂不支持 Vibe')
  }
  range('information_extracted', information)
  const normalized = await normalizeImage(data)
  const hash = createHash('sha256').update(normalized.data).update(JSON.stringify({ model, information, options })).digest('hex')
  const path = join(cacheDirectory, `${hash}.nai-vibe.json`)
  try {
    return { path, value: parseVibe(await readFile(path, 'utf8'), model, information), cached: true }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    const recoverable = code === 'ENOENT' || error instanceof SyntaxError || (error instanceof Error && error.message.startsWith('Vibe '))
    if (!recoverable) throw error
  }
  await assertWritablePaths([cacheDirectory], policy)
  const rawEncoding = await client.binary('/ai/encode-vibe', { ...options, image: normalized.data.toString('base64'), model, information_extracted: information }, signal)
  const encoding = rawEncoding.toString('base64')
  if (!encoding.length) throw new Error('NovelAI 返回空 Vibe 编码')
  const value = { model, information_extracted: information, encoding }
  await assertWritablePaths([cacheDirectory], policy)
  await mkdir(cacheDirectory, { recursive: true })
  const tempPath = `${path}.${randomUUID().slice(0, 8)}.tmp`
  try {
    await writeFile(tempPath, JSON.stringify(value) + '\n', { signal, flag: 'wx' })
    await rename(tempPath, path)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
  return { path, value, cached: false }
}

export function parseVibe(text: string, model: string, information?: number): EncodedVibe {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || !('model' in value) || value.model !== model || !('encoding' in value) || typeof value.encoding !== 'string' || !value.encoding.length
    || !('information_extracted' in value) || typeof value.information_extracted !== 'number') throw new Error('Vibe 缓存格式或模型不匹配')
  if (information !== undefined && value.information_extracted !== information) throw new Error('Vibe information_extracted 与缓存不匹配，需要重新编码')
  return value as EncodedVibe
}

function validateDimension(name: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 64 || value > MAX_DIMENSION || value % 64 !== 0) {
    throw new Error(`${name} 必须是 64..${MAX_DIMENSION} 之间的 64 倍数`)
  }
}

function range(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} 必须位于 0..1`)
  return value
}
