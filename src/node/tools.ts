import { resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ParameterSchemaSpec, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-working-directory'
import sharp from 'sharp'
import { API_DEFINITIONS, array, bool, generationParameters, integer, number, object, text } from './schema.ts'
import { encodeVibe, generationPayload, parseVibe } from './generation.ts'
import type { EncodedVibe, GenerateArgs, Vibe } from './generation.ts'
import type { ApiPayload, Json, NovelAIClient } from './api.ts'
import { MODELS } from './models.ts'
import { safeMetadata, saveImages } from './storage.ts'
import type { Settings } from '../shared.ts'

export function registerTools(ctx: Context, client: NovelAIClient, settings: () => Settings): void {
  const output = {
    schema: { type: 'json' as const },
    render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
  }
  function register<Args>(name: string, description: string, parameters: ParameterSchemaSpec, execute: (args: Args, exec: ToolRunContext) => Promise<unknown>) {
    ctx.tools.register(defineTool({ name, description, parameters, output,
      execute: async (args, exec) => await execute(args as unknown as Args, exec) as Json,
    }))
  }

  async function files(exec: ToolRunContext) {
    if (!exec.agent) throw new Error('此工具需要当前会话')
    const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
    const root = await ctx.fs.resolve(cwd, { signal: exec.signal })
    const local = ctx.fs.processPath(root)
    if (ctx.fs.processPathFromHostPath(local) === undefined) throw new Error('NovelAI 输出需要本机工作目录；当前文件系统未映射到 Host')
    const read = async (path: string) => {
      const target = await ctx.fs.resolve(path, { cwd, signal: exec.signal })
      return Buffer.from(await ctx.fs.readBytes(target, exec.signal, 50 * 1024 * 1024))
    }
    const readImage = async (path: string) => {
      const bytes = await read(path)
      await sharp(bytes).metadata()
      return bytes
    }
    return { cwd: local, read, readImage, cache: resolve(local, settings().outputDirectory, '.vibe-cache') }
  }

  register<GenerateArgs>('novelai_generate',
    'Generate or edit images with NovelAI. Load skill novelai-v5-prompt first. Supports text-to-image, img2img, infill, Enhance, multi-character positions, Vibe Transfer, Precise Reference, transparent PNG/WebP and the complete official generation parameters. Returns saved paths, seeds, metadata and Markdown to insert into the response. Use model-specific capabilities; never silently switch models. A submitted paid request is not automatically retried.',
    {
      prompt: { ...text('Base prompt; use NovelAI tags, natural language, weighting, and Text: for lettering.'), required: true },
      negative_prompt: text('Undesired Content base prompt.'),
      model: text('Model ID from novelai_capabilities; defaults to configured V5 Full.'),
      action: { type: 'string', enum: ['generate', 'img2img', 'infill', 'enhance'], description: 'Enhance is a prompt-guided img2img pass. infill selects the matching inpainting model.' },
      image_path: text('Local source image for img2img, Enhance or infill.'),
      mask_path: text('Infill mask image: white regenerates, black preserves. Match the source canvas.'),
      characters: array(object({ prompt: { ...text('Per-character prompt without a subject count.'), required: true }, negative_prompt: text('Per-character Undesired Content.'), positions: array(object({ x: { ...number('0..1'), required: true }, y: { ...number('0..1'), required: true } })) })),
      use_coords: bool('Use explicit character positions; otherwise layout is automatic.'),
      vibes: array(object({ image_path: text('Original image; V4+ caches the paid encoding for reuse.'), encoding_path: text('Previously returned .nai-vibe.json; avoids another encoding charge.'), strength: number('0..1, default 0.6'), information_extracted: number('0..1, default 1 for new encodings; cached encoding keeps its own value.') })),
      references: array(object({ image_path: { ...text('Reference image, automatically resized and black-padded to the accepted canvas.'), required: true }, type: { type: 'string', enum: ['character', 'style', 'character&style'] }, fidelity: number('0..1, default 1'), strength: number('0..1, default 1'), information_extracted: number('0..1, default 1') })),
      parameters: { ...generationParameters, description: 'Complete official generation parameter object. width/height, steps, scale, sampler, seed, n_samples, strength/noise, quality, SMEA, Variety+, ControlNet, alpha and upscaling. Top-level image paths and characters are encoded by the plugin. Raw image fields, if used, require base64.' },
    }, async (args, exec) => {
      const io = await files(exec)
      const encode = async (vibe: Vibe, model: string): Promise<EncodedVibe> => {
        if (vibe.encoding_path) return parseVibe((await io.read(vibe.encoding_path)).toString('utf8'), model, vibe.information_extracted)
        if (!vibe.image_path) throw new Error('每个 Vibe 需要 image_path 或 encoding_path')
        return (await encodeVibe(client, await io.readImage(vibe.image_path), model, vibe.information_extracted ?? 1, io.cache, exec.signal)).value
      }
      const payload = await generationPayload(args, settings().model, io.readImage, encode)
      const images = await client.images('/ai/generate-image', payload, exec.signal)
      const seed = (payload.parameters as ApiPayload).seed as number
      for (const [index, image] of images.entries()) image.seed ??= (seed + index) % 2 ** 32
      return saveImages(images, io.cwd, settings().outputDirectory, {
        operation: args.action ?? 'generate', model: payload.model,
        input: safeMetadata(args), request: safeMetadata(payload),
      }, exec.signal)
    })

  register<{ image_path: string; operation: string; prompt?: string; defry?: number }>('novelai_augment',
    'Use all NovelAI Director Tools: remove background (all returned variants), lineart, sketch, colorize, emotion, and declutter. Saves every returned image and returns embeddable Markdown.',
    {
      image_path: { ...text('Local source image.'), required: true },
      operation: { type: 'string', required: true, enum: ['bg-removal', 'lineart', 'sketch', 'colorize', 'emotion', 'declutter'] },
      prompt: text('Colorization tags or emotion prompt (e.g. happy;; smiling).'),
      defry: integer('Colorize/Emotion strength level, 0..5.'),
    }, async (args, exec) => {
      if (args.defry !== undefined && (!Number.isInteger(args.defry) || args.defry < 0 || args.defry > 5)) throw new Error('defry 必须位于 0..5')
      const io = await files(exec)
      const data = await sharp(await io.readImage(args.image_path)).png().toBuffer()
      const info = await sharp(data).metadata()
      const payload = { image: data.toString('base64'), width: info.width!, height: info.height!, req_type: args.operation, prompt: args.prompt ?? '', defry: args.defry ?? 0 }
      const images = await client.images('/ai/augment-image', payload, exec.signal)
      return saveImages(images, io.cwd, settings().outputDirectory, { operation: args.operation, input: args }, exec.signal)
    })

  register<{ image_path: string; model?: string; declared_blur_sigma?: number }>('novelai_upscale',
    'NovelAI dedicated 4x image upscaler. Preserves the artwork without a creative diffusion pass. For prompt-guided enhancement use novelai_generate action enhance.',
    { image_path: { ...text('Local input image.'), required: true }, model: text('Source NovelAI model; defaults to configured model.'), declared_blur_sigma: number('0, 0.30, 0.35, 0.40, 0.45 or 0.50.') },
    async (args, exec) => {
      const io = await files(exec)
      const payload: ApiPayload = { model: args.model ?? settings().model, image: (await io.readImage(args.image_path)).toString('base64') }
      if (args.declared_blur_sigma !== undefined) payload.declared_blur_sigma = args.declared_blur_sigma
      const images = await client.images('/ai/upscale', payload, exec.signal)
      return saveImages(images, io.cwd, settings().outputDirectory, { operation: 'upscale', model: payload.model, input: args }, exec.signal)
    })

  register<{ image_path: string; model?: string; information_extracted?: number; mask_path?: string; crop_to_mask?: boolean; focus_seed?: number; info_extract_seed?: number }>('novelai_encode_vibe',
    'Encode a V4/V4.5 Vibe once and save a reusable encoding. Content-addressed local caching avoids paying for identical encodings again. Supports masks, crop-to-mask and encoding seeds. Supply encoding_path to novelai_generate vibes.',
    { image_path: { ...text('Local source image.'), required: true }, model: text('V4/V4.5 model, default nai-diffusion-4-5-full.'), information_extracted: number('0..1, default 1'),
      mask_path: text('Optional local mask.'), crop_to_mask: bool('Crop encoding to mask bounds.'), focus_seed: integer('Optional focus sampling seed.'), info_extract_seed: integer('Optional information extraction seed.') },
    async (args, exec) => {
      const io = await files(exec)
      const options: ApiPayload = {}
      for (const key of ['crop_to_mask', 'focus_seed', 'info_extract_seed'] as const) if (args[key] !== undefined) options[key] = args[key]!
      if (args.mask_path) options.mask = (await io.readImage(args.mask_path)).toString('base64')
      const result = await encodeVibe(client, await io.readImage(args.image_path), args.model ?? 'nai-diffusion-4-5-full', args.information_extracted ?? 1, io.cache, exec.signal, options)
      return { encoding_path: result.path, cached: result.cached, model: result.value.model, information_extracted: result.value.information_extracted }
    })

  register<{ prompt: string; model?: string; lang?: string }>('novelai_suggest_tags', 'Query official NovelAI tag suggestions and tag knowledge for a model. Useful when composing precise character, style or scene tags.',
    { prompt: { ...text('Incomplete tag query.'), required: true }, model: text('NovelAI image model ID.'), lang: { type: 'string', enum: ['en', 'jp'] } },
    async (args, exec) => client.json(`/ai/generate-image/suggest-tags?${new URLSearchParams({ model: args.model ?? settings().model, prompt: args.prompt, lang: args.lang ?? 'en' })}`, undefined, exec.signal))

  register<Record<string, never>>('novelai_account', 'Read NovelAI subscription, Anlas balance and available usage limits. Does not generate an image or return the API token.', {},
    async (_args, exec) => client.json('/user/subscription', undefined, exec.signal))

  register<{ include_parameters?: boolean }>('novelai_capabilities', 'List supported NovelAI models, model-specific capabilities, operations and optionally the full official parameter definitions. Inspect before choosing advanced generation options.',
    { include_parameters: bool('Include full official schemas for generation, Director Tools, upscaling and vibe encoding.') }, async args => ({
      models: MODELS, configured_model: settings().model,
      operations: ['generate', 'img2img', 'infill', 'enhance', 'multi-character', 'vibe-transfer', 'precise-reference', 'bg-removal', 'lineart', 'sketch', 'colorize', 'emotion', 'declutter', 'upscale', 'encode-vibe', 'suggest-tags', 'account'],
      ...(args.include_parameters ? { parameters: API_DEFINITIONS } : {}),
    }))
}
