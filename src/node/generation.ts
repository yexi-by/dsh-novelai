import { createHash, randomInt } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import type { ApiPayload, Json, NovelAIClient } from './api.ts'
import { modelInfo } from './models.ts'

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
  vibes?: Vibe[]
  references?: PreciseReference[]
  parameters?: ApiPayload
}

export type ReadImage = (path: string) => Promise<Buffer>

export async function generationPayload(args: GenerateArgs, defaultModel: string, read: ReadImage, encode: (vibe: Vibe, model: string) => Promise<EncodedVibe>): Promise<ApiPayload> {
  if (!args.prompt.trim()) throw new Error('prompt 不能为空')
  const model = modelInfo(args.model ?? defaultModel)
  const requested = args.model ?? defaultModel
  const action = args.action === 'enhance' ? 'img2img' : args.action ?? 'generate'
  const p: ApiPayload = {
    params_version: model.family >= 5 ? 4 : 3,
    width: 1024, height: 1024, steps: 28, scale: 6,
    sampler: 'k_euler_ancestral', noise_schedule: 'karras',
    seed: randomInt(0, 2 ** 32), n_samples: 1, image_format: 'png',
    negative_prompt: args.negative_prompt ?? '',
    cfg_rescale: 0, deliberate_euler_ancestral_bug: false, prefer_brownian: true,
    ...args.parameters,
  }
  delete p.stream
  if (args.image_path) {
    const image = await read(args.image_path)
    const size = await sharp(image).metadata()
    p.width = args.parameters?.width ?? Math.max(64, Math.round(size.width! / 64) * 64)
    p.height = args.parameters?.height ?? Math.max(64, Math.round(size.height! / 64) * 64)
    p.image = (await sharp(image).resize(p.width as number, p.height as number, { fit: 'fill' }).png().toBuffer()).toString('base64')
  }
  for (const name of ['width', 'height']) {
    const value = p[name]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 64 || value % 64 !== 0) throw new Error(`${name} 必须是至少 64 的 64 倍数`)
  }
  for (const name of ['steps', 'n_samples']) {
    if (typeof p[name] !== 'number' || !Number.isInteger(p[name]) || p[name] < 1) throw new Error(`${name} 必须为正整数`)
  }
  if (typeof p.seed !== 'number' || !Number.isInteger(p.seed) || p.seed < 0 || p.seed >= 2 ** 32) throw new Error('seed 必须位于 0..4294967295')
  if (typeof p.scale !== 'number' || p.scale <= 0) throw new Error('scale 必须大于 0')
  if (args.negative_prompt !== undefined) p.negative_prompt = args.negative_prompt
  if (args.mask_path) {
    const mask = await sharp(await read(args.mask_path)).resize(p.width as number, p.height as number, { fit: 'fill', kernel: 'nearest' }).png().toBuffer()
    p.mask = mask.toString('base64')
  }
  if (action !== 'generate' && !p.image) throw new Error(`${action} 需要 image_path`)
  if (action === 'infill' && !p.mask) throw new Error('局部重绘需要 mask_path（白色重绘、黑色保留）')
  if (action === 'img2img') {
    p.strength ??= args.action === 'enhance' ? 0.2 : 0.7
    p.noise ??= args.action === 'enhance' ? 0 : 0.2
  }
  if (model.family >= 4 && !p.v4_prompt) {
    const characters = args.characters ?? []
    if (characters.length > model.characters) throw new Error(`${model.label} 最多支持 ${model.characters} 个角色提示词`)
    const use_coords = args.use_coords ?? characters.some(character => character.positions?.length)
    for (const character of characters) for (const pos of character.positions ?? []) {
      range('角色 x', pos.x); range('角色 y', pos.y)
    }
    const caption = (negative: boolean) => ({
      base_caption: negative ? p.negative_prompt : args.prompt,
      char_captions: characters.map(character => ({ char_caption: negative ? character.negative_prompt ?? '' : character.prompt,
        centers: character.positions?.length ? character.positions : [{ x: 0.5, y: 0.5 }] })),
    })
    p.v4_prompt = { caption: caption(false), use_coords: Boolean(use_coords), use_order: true } as Json
    p.v4_negative_prompt ??= { caption: caption(true), legacy_uc: false } as Json
  } else if (model.family < 4 && args.characters?.length) throw new Error('独立角色提示词需要 V4 或更高模型')

  const hasVibes = Boolean(args.vibes?.length || p.reference_image || (p.reference_image_multiple as Json[] | undefined)?.length)
  const hasReferences = Boolean(args.references?.length || (p.director_reference_images as Json[] | undefined)?.length)
  if (hasVibes && !model.vibe) throw new Error(`${model.label} 尚不支持 Vibe Transfer，请显式选择 V4.5/V4/V3`)
  if (hasReferences && !model.precise) throw new Error('Precise Reference 当前只支持 V4.5 模型，请显式指定模型')
  if (hasVibes && hasReferences) throw new Error('NovelAI 当前不支持同时使用 Vibe Transfer 与 Precise Reference')
  if (args.vibes?.length) {
    if (args.vibes.length > 16) throw new Error('最多支持 16 个 Vibe')
    const encoded = await Promise.all(args.vibes.map(async vibe => {
      if (model.family >= 4) return encode(vibe, model.id)
      if (!vibe.image_path) throw new Error('V3 Vibe 需要原始 image_path')
      return { encoding: (await read(vibe.image_path)).toString('base64'), information_extracted: vibe.information_extracted ?? 1, model: model.id }
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
  if (model.family >= 5) {
    if (p.sm || p.sm_dyn || p.dynamic_thresholding || p.skip_cfg_above_sigma || p.controlnet_model) throw new Error('V5 不支持 SMEA、Decrisper、Variety+ 或 ControlNet；请使用支持这些选项的模型')
    if (p.noise_schedule !== 'karras') throw new Error('V5 的 noise_schedule 需要使用 karras')
  }
  return { input: args.prompt, model: action === 'infill' ? model.inpaint : requested, action, parameters: p }
}

export async function prepareReference(data: Buffer): Promise<Buffer> {
  const info = await sharp(data).metadata()
  const ratio = info.width! / info.height!
  const size = [[1024, 1536], [1472, 1472], [1536, 1024]].sort((a, b) => Math.abs(Math.log(ratio / (a[0] / a[1]))) - Math.abs(Math.log(ratio / (b[0] / b[1]))))[0]
  return sharp(data).flatten({ background: '#000' }).resize(size[0], size[1], { fit: 'contain', background: '#000' }).png().toBuffer()
}

export interface EncodedVibe { model: string; information_extracted: number; encoding: string }

export async function encodeVibe(client: NovelAIClient, data: Buffer, model: string, information: number, cacheDirectory: string, signal: AbortSignal, options: ApiPayload = {}): Promise<{ path: string; value: EncodedVibe; cached: boolean }> {
  if (!modelInfo(model).vibe || modelInfo(model).family < 4) throw new Error('独立 Vibe 编码需要 V4/V4.5；V3 直接使用原图，V5 暂不支持 Vibe')
  range('information_extracted', information)
  const hash = createHash('sha256').update(data).update(JSON.stringify({ model, information, options })).digest('hex')
  const path = join(cacheDirectory, `${hash}.nai-vibe.json`)
  try { return { path, value: parseVibe(await readFile(path, 'utf8'), model, information), cached: true } }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const response = await client.request('/ai/encode-vibe', { ...options, image: data.toString('base64'), model, information_extracted: information }, signal)
  const encoding = Buffer.from(await response.arrayBuffer()).toString('base64')
  if (!encoding.length) throw new Error('NovelAI 返回空 Vibe 编码')
  const value = { model, information_extracted: information, encoding }
  await mkdir(cacheDirectory, { recursive: true })
  await writeFile(path, JSON.stringify(value) + '\n', { signal })
  return { path, value, cached: false }
}

export function parseVibe(text: string, model: string, information?: number): EncodedVibe {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || !('model' in value) || value.model !== model || !('encoding' in value) || typeof value.encoding !== 'string'
    || !('information_extracted' in value) || typeof value.information_extracted !== 'number') throw new Error('Vibe 缓存格式或模型不匹配')
  if (information !== undefined && value.information_extracted !== information) throw new Error('Vibe information_extracted 与缓存不匹配，需要重新编码')
  return value as EncodedVibe
}

function range(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} 必须位于 0..1`)
  return value
}
