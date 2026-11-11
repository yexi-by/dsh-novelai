import { resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ParameterSchemaSpec, ToolCallView, ToolResult, ToolResultView, ToolRunContext, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-working-directory'
import sharp from 'sharp'
import { API_DEFINITIONS, array, bool, generationParameters, integer, number, object, text } from './schema.ts'
import { encodeVibe, generationPayload, normalizeImage, parseVibe, validateBlurSigma } from './generation.ts'
import type { EncodedVibe, GenerateArgs, Vibe } from './generation.ts'
import type { ApiPayload, Json, NovelAIClient } from './api.ts'
import { MODELS, modelInfo } from './models.ts'
import { assertWritablePaths, safeMetadata, saveImages } from './storage.ts'
import type { ImageResult, Settings } from '../shared.ts'

function fileLocations(paths: readonly (string | undefined)[]): { path: string }[] | undefined {
  const unique = [...new Set(paths.filter((item): item is string => Boolean(item?.trim())))]
  return unique.length ? unique.map(path => ({ path })) : undefined
}

function presentImageResult(baseTitle: string, result: ToolResult): ToolResultView | undefined {
  if (result.isError || !result.meta || typeof result.meta !== 'object' || Array.isArray(result.meta)) return undefined
  const meta = result.meta as Record<string, unknown>
  const count = typeof meta.count === 'number' ? meta.count : undefined
  const size = typeof meta.size === 'string' && meta.size ? meta.size : undefined
  const model = typeof meta.model === 'string' && meta.model ? meta.model : undefined
  const parts = [baseTitle, count ? `${count} 张` : '', size ?? '', model ?? ''].filter(Boolean)
  return { card: 'generic', title: parts.join(' · ') }
}

export function registerTools(ctx: Context, client: NovelAIClient, settings: () => Settings): void {
  const jsonOutput = {
    schema: { type: 'json' as const },
    render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
  }
  const imageSchema = object({
    images: {
      type: 'array' as const,
      required: true,
      items: object({
        path: { ...text('Saved local file path.'), required: true },
        width: { ...integer('Image width in pixels.'), required: true },
        height: { ...integer('Image height in pixels.'), required: true },
        seed: integer('Generation seed when applicable.'),
        markdown: { ...text('Embeddable Markdown image syntax.'), required: true },
      }),
    },
    metadata_path: { ...text('Saved generation.json path.'), required: true },
    model: text('Effective NovelAI model ID.'),
  })
  const imageOutput = {
    schema: imageSchema,
    render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    presentationMeta: (_args: unknown, value: unknown) => {
      const data = value as ImageResult
      const first = data.images[0]
      return {
        count: data.images.length,
        size: first ? `${first.width}×${first.height}` : '',
        ...(data.model ? { model: data.model } : {}),
      }
    },
  }
  const vibeSchema = object({
    encoding_path: { ...text('Saved .nai-vibe.json cache path.'), required: true },
    cached: { ...bool('Whether a cached encoding was reused.'), required: true },
    model: { ...text('Encoded Vibe model ID.'), required: true },
    information_extracted: { ...number('Information extracted value.'), required: true },
  })
  const vibeOutput = {
    schema: vibeSchema,
    render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
  }

  function register<Args>(options: {
    name: string
    description: string
    parameters: ParameterSchemaSpec
    output?: { schema: ValueSchemaSpec; render: (args: unknown, value: unknown) => { type: 'text'; text: string }[]; presentationMeta?: (args: unknown, value: unknown) => Json }
    concurrencySafe?: boolean
    presentCall?: (args: Args) => ToolCallView | undefined
    presentResult?: (args: Args, result: ToolResult) => ToolResultView | undefined
    execute: (args: Args, exec: ToolRunContext) => Promise<unknown>
  }): void {
    const out = options.output ?? jsonOutput
    ctx.tools.register(defineTool({
      name: options.name,
      description: options.description,
      parameters: options.parameters,
      output: out as typeof jsonOutput,
      ...(options.concurrencySafe ? { isConcurrencySafe: () => true } : {}),
      ...(options.presentCall ? { presentCall: args => options.presentCall!(args as unknown as Args) } : {}),
      ...(options.presentResult ? { presentResult: (args, result) => options.presentResult!(args as unknown as Args, result) } : {}),
      execute: async (args, exec) => await options.execute(args as unknown as Args, exec) as Json,
    }))
  }

  async function files(exec: ToolRunContext) {
    if (!exec.agent) throw new Error('此工具需要当前会话')
    const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
    const root = await ctx.fs.resolve(cwd, { signal: exec.signal })
    const local = ctx.fs.processPath(root)
    if (ctx.fs.processPathFromHostPath(local) === undefined) throw new Error('NovelAI 输出需要本机工作目录；当前文件系统未映射到 Host')
    const directory = settings().outputDirectory.trim()
    if (!directory) throw new Error('outputDirectory 不能为空')
    const sandboxPolicy = typeof ctx.get === 'function' ? ctx.get('sandboxPolicy') : undefined
    const policy = sandboxPolicy?.resolve(exec.agent.session ? { session: exec.agent.session } : {})
    const outputRoot = resolve(local, directory)
    const cache = resolve(outputRoot, '.vibe-cache')
    // 在发起任何付费请求或磁盘写入前先校验会话沙箱可写策略。
    await assertWritablePaths([outputRoot], policy)
    const read = async (path: string) => {
      const target = await ctx.fs.resolve(path, { cwd, signal: exec.signal })
      return Buffer.from(await ctx.fs.readBytes(target, exec.signal, 50 * 1024 * 1024))
    }
    const readImage = async (path: string) => {
      const bytes = await read(path)
      await sharp(bytes).metadata()
      return bytes
    }
    return { cwd: local, directory, policy, read, readImage, cache }
  }

  const actionTitle = (action?: string) =>
    action === 'img2img' ? 'NovelAI 图生图'
      : action === 'infill' ? 'NovelAI 局部重绘'
        : action === 'enhance' ? 'NovelAI 细节增强'
          : 'NovelAI 生成图片'

  register<GenerateArgs>({
    name: 'novelai_generate',
    description: 'Generate or edit images with NovelAI. Load skill novelai-v5-prompt first. Supports text-to-image, img2img, infill, Enhance, multi-character positions, Vibe Transfer, Precise Reference, transparent PNG/WebP and the complete official generation parameters. Returns saved paths, seeds, metadata and Markdown to insert into the response. Use model-specific capabilities; never silently switch models. A submitted paid request is not automatically retried.',
    parameters: {
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
    },
    output: imageOutput,
    presentCall: args => {
      const locations = fileLocations([
        args.image_path,
        args.mask_path,
        ...(args.vibes?.flatMap(vibe => [vibe.image_path, vibe.encoding_path]) ?? []),
        ...(args.references?.map(ref => ref.image_path) ?? []),
      ])
      return {
        card: 'generic',
        kind: 'execute',
        title: actionTitle(args.action),
        rawInput: args.prompt,
        ...(locations ? { locations } : {}),
      }
    },
    presentResult: (args, result) => presentImageResult(actionTitle(args.action), result),
    execute: async (args, exec) => {
      const io = await files(exec)
      const encode = async (vibe: Vibe, model: string): Promise<EncodedVibe> => {
        if (vibe.encoding_path) return parseVibe((await io.read(vibe.encoding_path)).toString('utf8'), model, vibe.information_extracted)
        if (!vibe.image_path) throw new Error('每个 Vibe 需要 image_path 或 encoding_path')
        return (await encodeVibe(client, await io.readImage(vibe.image_path), model, vibe.information_extracted ?? 1, io.cache, exec.signal, {}, io.policy)).value
      }
      const payload = await generationPayload(args, settings().model, io.readImage, encode)
      const images = await client.images('/ai/generate-image', payload, exec.signal)
      const seed = (payload.parameters as ApiPayload).seed as number
      for (const [index, image] of images.entries()) image.seed ??= (seed + index) % 2 ** 32
      return saveImages(images, io.cwd, io.directory, {
        operation: args.action ?? 'generate', model: payload.model,
        input: safeMetadata(args), request: safeMetadata(payload),
      }, exec.signal, io.policy)
    },
  })

  register<{ image_path: string; operation: string; prompt?: string; defry?: number }>({
    name: 'novelai_augment',
    description: 'Use all NovelAI Director Tools: remove background (all returned variants), lineart, sketch, colorize, emotion, and declutter. Saves every returned image and returns embeddable Markdown.',
    parameters: {
      image_path: { ...text('Local source image.'), required: true },
      operation: { type: 'string', required: true, enum: ['bg-removal', 'lineart', 'sketch', 'colorize', 'emotion', 'declutter'] },
      prompt: text('Colorization tags or emotion prompt (e.g. happy;; smiling).'),
      defry: integer('Colorize/Emotion strength level, 0..5.'),
    },
    output: imageOutput,
    presentCall: args => ({
      card: 'generic',
      kind: 'execute',
      title: `NovelAI Director Tools (${args.operation})`,
      locations: [{ path: args.image_path }],
      ...(args.prompt ? { rawInput: args.prompt } : {}),
    }),
    presentResult: (args, result) => presentImageResult(`NovelAI Director Tools (${args.operation})`, result),
    execute: async (args, exec) => {
      if (args.defry !== undefined && (!Number.isInteger(args.defry) || args.defry < 0 || args.defry > 5)) throw new Error('defry 必须位于 0..5')
      const io = await files(exec)
      const normalized = await normalizeImage(await io.readImage(args.image_path))
      const data = await sharp(normalized.data).png().toBuffer()
      const info = await sharp(data).metadata()
      const payload = { image: data.toString('base64'), width: info.width!, height: info.height!, req_type: args.operation, prompt: args.prompt ?? '', defry: args.defry ?? 0 }
      const images = await client.images('/ai/augment-image', payload, exec.signal)
      return saveImages(images, io.cwd, io.directory, { operation: args.operation, input: args }, exec.signal, io.policy)
    },
  })

  register<{ image_path: string; model?: string; declared_blur_sigma?: number }>({
    name: 'novelai_upscale',
    description: 'NovelAI dedicated 2x image upscaler. Doubles width and height without a creative diffusion pass. For prompt-guided enhancement use novelai_generate action enhance.',
    parameters: {
      image_path: { ...text('Local input image.'), required: true },
      model: text('Source NovelAI model; defaults to configured model.'),
      declared_blur_sigma: number('Optional blur sigma: must be 0, 0.3, 0.35, 0.4, 0.45 or 0.5.'),
    },
    output: imageOutput,
    presentCall: args => ({
      card: 'generic',
      kind: 'execute',
      title: 'NovelAI 2x 放大',
      locations: [{ path: args.image_path }],
    }),
    presentResult: (_args, result) => presentImageResult('NovelAI 2x 放大', result),
    execute: async (args, exec) => {
      if (args.declared_blur_sigma !== undefined) validateBlurSigma(args.declared_blur_sigma)
      const io = await files(exec)
      const normalized = await normalizeImage(await io.readImage(args.image_path))
      const payload: ApiPayload = { model: args.model ?? settings().model, image: normalized.data.toString('base64') }
      if (args.declared_blur_sigma !== undefined) payload.declared_blur_sigma = args.declared_blur_sigma
      const images = await client.images('/ai/upscale', payload, exec.signal)
      for (const image of images) if (image.seed === 0) delete image.seed
      return saveImages(images, io.cwd, io.directory, { operation: 'upscale', model: payload.model, input: args }, exec.signal, io.policy)
    },
  })

  register<{ image_path: string; model?: string; information_extracted?: number; mask_path?: string; crop_to_mask?: boolean; focus_seed?: number; info_extract_seed?: number }>({
    name: 'novelai_encode_vibe',
    description: 'Encode a V4/V4.5 Vibe once and save a reusable encoding. Content-addressed local caching avoids paying for identical encodings again. Supports masks, crop-to-mask and encoding seeds. Supply encoding_path to novelai_generate vibes.',
    parameters: {
      image_path: { ...text('Local source image.'), required: true },
      model: text('Base V4/V4.5 model ID; defaults to configured model when V4/V4.5, otherwise nai-diffusion-4-5-full.'),
      information_extracted: number('0..1, default 1'),
      mask_path: text('Optional local mask (white focuses, black ignores).'),
      crop_to_mask: bool('Crop encoding to mask bounds.'),
      focus_seed: integer('Optional focus sampling seed.'),
      info_extract_seed: integer('Optional information extraction seed.'),
    },
    output: vibeOutput,
    presentCall: args => {
      const locations = fileLocations([args.image_path, args.mask_path])
      return {
        card: 'generic',
        kind: 'execute',
        title: 'NovelAI 编码 Vibe',
        ...(locations ? { locations } : {}),
      }
    },
    execute: async (args, exec) => {
      const io = await files(exec)
      const options: ApiPayload = {}
      for (const key of ['crop_to_mask', 'focus_seed', 'info_extract_seed'] as const) if (args[key] !== undefined) options[key] = args[key]!
      if (args.mask_path) {
        const normalizedMask = await normalizeImage(await io.readImage(args.mask_path))
        const maskPng = await sharp(normalizedMask.data).flatten({ background: '#000' }).greyscale().png().toBuffer()
        options.mask = maskPng.toString('base64')
      }
      const configured = settings().model
      const canUseConfigured = !configured.endsWith('-inpainting') && (() => {
        try { const m = modelInfo(configured); return m.vibe && m.family >= 4 } catch { return false }
      })()
      const targetModel = args.model ?? (canUseConfigured ? configured : 'nai-diffusion-4-5-full')
      const result = await encodeVibe(client, await io.readImage(args.image_path), targetModel, args.information_extracted ?? 1, io.cache, exec.signal, options, io.policy)
      return { encoding_path: result.path, cached: result.cached, model: result.value.model, information_extracted: result.value.information_extracted }
    },
  })

  register<{ prompt: string; model?: string; lang?: string }>({
    name: 'novelai_suggest_tags',
    description: 'Query official NovelAI tag suggestions and tag knowledge for a model. Useful when composing precise character, style or scene tags.',
    parameters: { prompt: { ...text('Incomplete tag query.'), required: true }, model: text('NovelAI image model ID.'), lang: { type: 'string', enum: ['en', 'jp'] } },
    concurrencySafe: true,
    presentCall: args => ({ card: 'generic', kind: 'search', title: `NovelAI 标签查询: ${args.prompt.slice(0, 40)}` }),
    execute: async (args, exec) => client.json(`/ai/generate-image/suggest-tags?${new URLSearchParams({ model: args.model ?? settings().model, prompt: args.prompt, lang: args.lang ?? 'en' })}`, undefined, exec.signal),
  })

  register<Record<string, never>>({
    name: 'novelai_account',
    description: 'Read NovelAI subscription, Anlas balance and available usage limits. Does not generate an image or return the API token.',
    parameters: {},
    concurrencySafe: true,
    presentCall: () => ({ card: 'generic', kind: 'fetch', title: 'NovelAI 账户与额度查询' }),
    execute: async (_args, exec) => client.json('/user/subscription', undefined, exec.signal),
  })

  register<{ include_parameters?: boolean }>({
    name: 'novelai_capabilities',
    description: 'List supported NovelAI models, model-specific capabilities, operations and optionally the full official parameter definitions. Inspect before choosing advanced generation options.',
    parameters: { include_parameters: bool('Include full official schemas for generation, Director Tools, upscaling and vibe encoding.') },
    concurrencySafe: true,
    presentCall: () => ({ card: 'generic', kind: 'read', title: 'NovelAI 模型能力查询' }),
    execute: async args => ({
      models: MODELS, configured_model: settings().model,
      operations: ['generate', 'img2img', 'infill', 'enhance', 'multi-character', 'vibe-transfer', 'precise-reference', 'bg-removal', 'lineart', 'sketch', 'colorize', 'emotion', 'declutter', 'upscale', 'encode-vibe', 'suggest-tags', 'account'],
      ...(args.include_parameters ? { parameters: API_DEFINITIONS } : {}),
    }),
  })
}
