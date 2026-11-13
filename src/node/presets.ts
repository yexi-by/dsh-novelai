import type { ModelSpec, QualityPresetId, UcPresetId } from '../shared.ts'

/**
 * 官方质量标签与 Undesired Content 预设。
 * 文本与顺序取自 docs.novelai.net（qualitytags / undesiredcontent）及官网前端；
 * 质量标签作为后缀拼到基础提示词（Text: 段之前），UC 预设作为前缀拼到负向基础提示词。
 */
type QualityTable = Partial<Record<Exclude<QualityPresetId, 'none'>, string>>
type UcTable = Partial<Record<Exclude<UcPresetId, 'none'>, string>>

const V5_HEAVY = 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page'
const FURRY_FOCUS = '{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic'
const HUMAN_FOCUS_SUFFIX = '@_@, mismatched pupils, glowing eyes, bad anatomy'

const V5_UC: UcTable = {
  heavy: V5_HEAVY,
  light: 'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::',
  furryFocus: FURRY_FOCUS,
  humanFocus: `${V5_HEAVY}, ${HUMAN_FOCUS_SUFFIX}`,
}

const QUALITY: Record<string, QualityTable> = {
  'nai-diffusion-5-full': { standard: 'very aesthetic, masterpiece, no text', light: 'very aesthetic, amazing quality, no text' },
  'nai-diffusion-5-curated': { standard: 'very aesthetic, masterpiece, no text', light: 'very aesthetic, amazing quality, no text' },
  'nai-diffusion-4-5-full': { standard: 'very aesthetic, masterpiece, no text' },
  'nai-diffusion-4-5-curated': { standard: 'very aesthetic, masterpiece, no text, -0.8::feet::, rating:general' },
  'nai-diffusion-4-full': { standard: 'no text, best quality, very aesthetic, absurdres' },
  'nai-diffusion-4-curated-preview': { standard: 'rating:general, best quality, very aesthetic, absurdres' },
  'nai-diffusion-3': { standard: 'best quality, amazing quality, very aesthetic, absurdres' },
  'nai-diffusion-furry-3': { standard: '{best quality}, {amazing quality}' },
}

const UC: Record<string, UcTable> = {
  'nai-diffusion-5-full': V5_UC,
  'nai-diffusion-5-curated': V5_UC,
  'nai-diffusion-4-5-full': {
    heavy: V5_HEAVY,
    light: 'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
    furryFocus: FURRY_FOCUS,
    humanFocus: `${V5_HEAVY}, ${HUMAN_FOCUS_SUFFIX}`,
  },
  'nai-diffusion-4-5-curated': {
    heavy: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page',
    light: 'blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page',
    humanFocus: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page',
  },
  'nai-diffusion-4-full': {
    heavy: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks',
    light: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing',
  },
  'nai-diffusion-4-curated-preview': {
    heavy: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts',
    light: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature',
  },
  'nai-diffusion-3': {
    heavy: 'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]',
    light: 'lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing',
    humanFocus: 'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract], bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes',
  },
  'nai-diffusion-furry-3': {
    heavy: '{{worst quality}}, [displeasing], {unusual pupils}, guide lines, {{unfinished}}, {bad}, url, artist name, {{tall image}}, mosaic, {sketch page}, comic panel, impact (font), [dated], {logo}, ych, {what}, {where is your god now}, {distorted text}, repeated text, {floating head}, {1994}, {widescreen}, absolutely everyone, sequence, {compression artifacts}, hard translated, {cropped}, {commissioner name}, unknown text, high contrast',
    light: '{worst quality}, guide lines, unfinished, bad, url, tall image, widescreen, compression artifacts, unknown text',
  },
}

/** 官网请求中 tag_hint_qt / tag_hint_uc_preset 使用的预设序号。 */
const PRESET_INDEX: Record<string, number> = { none: 0, standard: 1, heavy: 2, light: 3, humanFocus: 4, furryFocus: 5 }

/** 官网在当前模型缺少所选 UC 预设时的回退顺序。 */
const UC_FALLBACK: Record<UcPresetId, UcPresetId[]> = {
  none: ['none', 'light', 'heavy'],
  light: ['light', 'none', 'heavy'],
  heavy: ['heavy', 'light', 'none'],
  humanFocus: ['humanFocus', 'heavy', 'light', 'none'],
  furryFocus: ['furryFocus', 'heavy', 'light', 'none'],
}

/** 匹配官网判定的 `Text:` 标记（大小写不敏感，排除 `text::` 数值权重）。 */
export const TEXT_MARKER = /(?:^|\s|[,.:[\]{}、。])text:(?!:)/i

export interface ResolvedPreset { id: string; text: string; index: number }

export function resolveQualityPreset(model: ModelSpec, requested: QualityPresetId): ResolvedPreset {
  const table = QUALITY[model.id] ?? {}
  if (requested !== 'none') {
    const id = table[requested] ? requested : (table.standard ? 'standard' : undefined)
    if (id) return { id, text: table[id]!, index: PRESET_INDEX[id] }
  }
  return { id: 'none', text: '', index: 0 }
}

export function resolveUcPreset(model: ModelSpec, requested: UcPresetId): ResolvedPreset {
  const table = UC[model.id] ?? {}
  for (const id of UC_FALLBACK[requested]) {
    if (id === 'none') return { id, text: '', index: 0 }
    if (table[id]) return { id, text: table[id]!, index: PRESET_INDEX[id] }
  }
  return { id: 'none', text: '', index: 0 }
}

function joinTags(...parts: string[]): string {
  return parts.map(part => part.trim().replace(/^[\s,]+|[\s,]+$/gu, '')).filter(Boolean).join(', ')
}

/**
 * 按官网规则把质量标签（以及透明背景标签）拼到基础提示词：
 * 存在 `Text:` 段时插入到其之前，避免标签被渲染成画面文字；此时去掉 `no text` 以免压制文字渲染。
 */
export function applyQualityTags(prompt: string, quality: ResolvedPreset, transparent: boolean): string {
  const marker = TEXT_MARKER.exec(prompt)
  const head = marker ? prompt.slice(0, marker.index) : prompt
  const tail = marker ? prompt.slice(marker.index).replace(/^[\s,.]+/u, '') : ''
  let suffix = quality.text
  if (marker) suffix = suffix.split(',').map(tag => tag.trim()).filter(tag => tag && tag !== 'no text').join(', ')
  const tags = joinTags(transparent ? 'transparent background' : '', suffix)
  const body = tags ? joinTags(head, tags) : head.trimEnd()
  return tail ? `${body}${body ? ', ' : ''}${tail}` : body
}

export function applyUcPreset(negative: string, uc: ResolvedPreset): string {
  return joinTags(uc.text, negative)
}

export function presetIndex(id: string): number {
  return PRESET_INDEX[id] ?? 0
}

// ---------------------------------------------------------------------------
// 中文台词自动转画面文字（仿照官网 V5 autoText，仅收集含汉字的引号内容）

const QUOTE_PAIRS: Record<string, string> = { '"': '"', '“': '”', '「': '」', '『': '』', "'": "'", '‘': '’' }
const CJK = /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uFF00-\uFF9F\u4E00-\u9FAF\u3400-\u4DBF]/gu
const HAN = /\p{Script=Han}/u

/** 提取引号内文本；单引号仅在前一字符为空白或标点时视为开引号，并跳过英文缩写撇号。 */
export function extractQuotes(text: string): string[] {
  const result: string[] = []
  let index = 0
  while (index < text.length) {
    const close = QUOTE_PAIRS[text[index]]
    const previous = text[index - 1]
    if (close === undefined || (text[index] === "'" && previous !== undefined && !/[\s,.]/u.test(previous))) { index++; continue }
    const apostrophe = close === "'" || close === '’'
    let end = index + 1
    while (end < text.length && (text[end] !== close || (apostrophe && text[end + 1] !== undefined && /[\p{L}\p{N}]/u.test(text[end + 1])))) end++
    if (end >= text.length) { index++; continue }
    const content = text.slice(index + 1, end).trim()
    if (content) result.push(content)
    index = end + 1
  }
  return result
}

interface PositionedPrompt { prompt: string; x: number; y: number }

/** 官网的阅读顺序：先按 y 递归切分成行，每行再按 x 从左到右。 */
function readingOrder(items: PositionedPrompt[]): PositionedPrompt[] {
  const rows = (list: PositionedPrompt[]): PositionedPrompt[][] => {
    if (list.length <= 1) return [list]
    const span = list[list.length - 1].y - list[0].y
    let split = 1
    let maxGap = -1
    for (let i = 1; i < list.length; i++) {
      const gap = list[i].y - list[i - 1].y
      if (gap > maxGap) { maxGap = gap; split = i }
    }
    return span <= 0.15 && maxGap <= 0.1 ? [list] : [...rows(list.slice(0, split)), ...rows(list.slice(split))]
  }
  return rows([...items].sort((a, b) => a.y - b.y)).flatMap(row => row.sort((a, b) => a.x - b.x))
}

/**
 * 当基础与角色提示词都没有 `Text:` 时，把含汉字的引号台词按官网顺序追加为 `Text:` 段。
 * 返回追加后的基础提示词；没有中文台词时原样返回。
 */
export function applyChineseAutoText(prompt: string, characters: readonly { prompt: string; positions?: readonly { x: number; y: number }[] }[], useCoords: boolean): string {
  if (TEXT_MARKER.test(prompt) || characters.some(character => TEXT_MARKER.test(character.prompt))) return prompt
  const positioned = characters
    .filter(character => character.prompt.trim())
    .map(character => ({ prompt: character.prompt, x: character.positions?.[0]?.x ?? 0.5, y: character.positions?.[0]?.y ?? 0.5 }))
  const ordered = useCoords ? readingOrder(positioned) : positioned
  const groups = [prompt, ...ordered.map(item => item.prompt)].map(text => extractQuotes(text).filter(quote => HAN.test(quote)))
  const joined = groups.flat().join('')
  if (!joined) return prompt
  if ((joined.match(CJK)?.length ?? 0) / joined.length > 0.3) for (const group of groups) group.reverse()
  const base = prompt.replace(/[\s,]+$/u, '')
  const text = `Text: ${groups.flat().join('\n\n')}`
  return base ? `${base}, ${text}` : text
}
