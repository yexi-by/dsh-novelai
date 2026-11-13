import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { zipSync } from 'fflate'
import { harness } from '../scripts/dsh-runtime.mjs'
import { fitCanvasSize, generationPayload, prepareReference, parseVibe } from '../src/node/generation.ts'
import { applyChineseAutoText, extractQuotes } from '../src/node/presets.ts'
import { modelInfo } from '../src/node/models.ts'
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared.ts'
import { formatImageMarkdown, saveImages } from '../src/node/storage.ts'
import { decodeImages } from '../src/node/api.ts'

const { parseFileLink } = await import(new URL('packages/client/ui-primitives/src/markdown/file-link.ts', harness))

const png = await sharp({ create: { width: 64, height: 128, channels: 4, background: '#46aaff' } }).png().toBuffer()
const read = async () => png
const encode = async () => { throw new Error('unexpected paid encoding') }

test('多角色 caption、官方默认参数、质量标签与 UC 预设按官网规则组装', async () => {
  const body = await generationPayload({ prompt: '2girls, park', negative_prompt: 'hat', characters: [
    { prompt: 'girl, black hair', negative_prompt: 'glasses', positions: [{ x: 0.2, y: 0.7 }] }, { prompt: 'girl, blonde hair' },
  ], parameters: { width: 1216, height: 832, seed: 21 } }, DEFAULT_SETTINGS, read, encode)
  const p = body.parameters
  assert.equal(body.model, 'nai-diffusion-5-full')
  assert.equal(p.params_version, 4)
  assert.equal(p.steps, 23)
  assert.equal(p.scale, 7)
  assert.equal(p.sampler, 'k_euler_ancestral')
  assert.equal(p.cfg_rescale, 0)
  assert.equal(p.n_samples, 1)
  assert.equal('noise_schedule' in p, false)
  assert.equal(body.input, '2girls, park, very aesthetic, masterpiece, no text')
  assert.equal(p.v4_prompt.caption.base_caption, body.input)
  assert.match(p.negative_prompt, /^lowres, artistic error, film grain.*blank page, hat$/)
  assert.equal(p.v4_negative_prompt.caption.base_caption, p.negative_prompt)
  assert.equal(p.tag_hint_qt, 1)
  assert.equal(p.tag_hint_uc_preset, 2)
  assert.equal(p.v4_prompt.caption.char_captions[0].char_caption, 'girl, black hair')
  assert.equal(p.v4_negative_prompt.caption.char_captions[0].char_caption, 'glasses')
  assert.deepEqual(p.v4_prompt.caption.char_captions[0].centers, [{ x: 0.2, y: 0.7 }])
  assert.equal(p.v4_prompt.use_coords, true)
  assert.equal(p.v4_prompt.use_order, true)

  const defaults = await generationPayload({ prompt: '1girl' }, DEFAULT_SETTINGS, read, encode)
  assert.deepEqual([defaults.parameters.width, defaults.parameters.height], [832, 1216])
})

test('插件设置控制采样器与预设：Light / Human Focus / 关闭预设 / 旧模型噪声调度与网格吸附', async () => {
  const light = await generationPayload({ prompt: '1girl, solo' }, { ...DEFAULT_SETTINGS, qualityPreset: 'light', ucPreset: 'humanFocus', sampler: 'k_dpmpp_2m', scale: 5.5 }, read, encode)
  assert.equal(light.input, '1girl, solo, very aesthetic, amazing quality, no text')
  assert.match(light.parameters.negative_prompt, /blank page, @_@, mismatched pupils, glowing eyes, bad anatomy$/)
  assert.equal(light.parameters.tag_hint_qt, 3)
  assert.equal(light.parameters.tag_hint_uc_preset, 4)
  assert.equal(light.parameters.sampler, 'k_dpmpp_2m')
  assert.equal(light.parameters.scale, 5.5)
  assert.equal('noise_schedule' in light.parameters, false)

  const none = await generationPayload({ prompt: '1girl', negative_prompt: 'hat' }, { ...DEFAULT_SETTINGS, qualityPreset: 'none', ucPreset: 'none' }, read, encode)
  assert.equal(none.input, '1girl')
  assert.equal(none.parameters.negative_prompt, 'hat')
  assert.deepEqual([none.parameters.tag_hint_qt, none.parameters.tag_hint_uc_preset], [0, 0])

  // V4 Full 无 Light 质量 / Human Focus UC：按官网回退到 Standard / Heavy；DPM++ 2M 推导 exponential；坐标吸附 5×5 网格
  const v4 = await generationPayload({ prompt: '2girls', model: 'nai-diffusion-4-full', characters: [{ prompt: 'girl', positions: [{ x: 0.05, y: 0.62 }] }] },
    { ...DEFAULT_SETTINGS, qualityPreset: 'light', ucPreset: 'humanFocus', sampler: 'k_dpmpp_2m' }, read, encode)
  assert.equal(v4.input, '2girls, no text, best quality, very aesthetic, absurdres')
  assert.match(v4.parameters.negative_prompt, /^blurry, lowres, error, film grain/)
  assert.equal(v4.parameters.noise_schedule, 'exponential')
  assert.deepEqual(v4.parameters.v4_prompt.caption.char_captions[0].centers, [{ x: 0.1, y: 0.7 }])
})

test('中文引号台词自动转 Text:，按官网阅读顺序排列，质量标签插在 Text: 之前且移除 no text', async () => {
  const body = await generationPayload({
    prompt: '2girls, cafe, speech bubble, the two girls greet each other',
    use_coords: true,
    characters: [
      { prompt: 'girl, blonde hair, replying “今天也要加油”', positions: [{ x: 0.7, y: 0.5 }] },
      { prompt: 'girl, black hair, saying “早上好！”', positions: [{ x: 0.3, y: 0.5 }] },
    ],
  }, DEFAULT_SETTINGS, read, encode)
  assert.equal(body.input, '2girls, cafe, speech bubble, the two girls greet each other, very aesthetic, masterpiece, Text: 早上好！\n\n今天也要加油')

  const english = await generationPayload({ prompt: '1girl, holding a sign that says "OPEN"' }, DEFAULT_SETTINGS, read, encode)
  assert.equal(english.input, '1girl, holding a sign that says "OPEN", very aesthetic, masterpiece, no text')

  const manual = await generationPayload({ prompt: '1girl, sign, “不会被重复提取”\nText: 手写文字' }, DEFAULT_SETTINGS, read, encode)
  assert.equal(manual.input, '1girl, sign, “不会被重复提取”, very aesthetic, masterpiece, Text: 手写文字')

  const disabled = await generationPayload({ prompt: '1girl, says “你好”' }, { ...DEFAULT_SETTINGS, autoText: false }, read, encode)
  assert.equal(disabled.input, '1girl, says “你好”, very aesthetic, masterpiece, no text')

  const transparent = await generationPayload({ prompt: '1girl, full body', transparent_background: true }, DEFAULT_SETTINGS, read, encode)
  assert.equal(transparent.input, '1girl, full body, transparent background, very aesthetic, masterpiece, no text')
  assert.equal(transparent.parameters.tag_hint_transparent_background, true)
  await assert.rejects(generationPayload({ prompt: 'x', model: 'nai-diffusion-4-5-full', transparent_background: true }, DEFAULT_SETTINGS, read, encode), /不支持透明背景/)
})

test('引号提取兼容中英文引号与撇号，同一提示词多段中文台词按官网规则逆序', () => {
  assert.deepEqual(extractQuotes(`她说“你好”，又说「再见」，英文 'It's fine' 不截断撇号`), ['你好', '再见', "It's fine"])
  assert.equal(applyChineseAutoText('1girl, “第一句”, “第二句”', [], false), '1girl, “第一句”, “第二句”, Text: 第二句\n\n第一句')
})

test('不支持的模型组合、超出免费范围或由设置控制的参数在编码或扣费请求前报错', async () => {
  await assert.rejects(generationPayload({ prompt: 'landscape', vibes: [{ image_path: 'style.png' }] }, DEFAULT_SETTINGS, read, encode), /不支持 Vibe/)
  await assert.rejects(generationPayload({ prompt: 'portrait', references: [{ image_path: 'ref.png' }] }, DEFAULT_SETTINGS, read, encode), /只支持 V4.5/)
  await assert.rejects(generationPayload({ prompt: 'portrait', model: 'nai-diffusion-4-5-full', references: [{ image_path: 'r' }], vibes: [{ image_path: 'v' }] }, DEFAULT_SETTINGS, read, encode), /同时使用/)
  await assert.rejects(generationPayload({ prompt: 'portrait', parameters: { width: 1000 } }, DEFAULT_SETTINGS, read, encode), /64 倍数/)
  await assert.rejects(generationPayload({ prompt: 'portrait', parameters: { width: 4096 } }, DEFAULT_SETTINGS, read, encode), /64\.\.2048/)
  await assert.rejects(generationPayload({ prompt: 'portrait', parameters: { width: 1216, height: 1216 } }, DEFAULT_SETTINGS, read, encode), /免费范围/)
  await assert.rejects(generationPayload({ prompt: 'portrait', parameters: { sampler: 'k_euler', n_samples: 2 } }, DEFAULT_SETTINGS, read, encode), /由插件设置统一控制/)
  await assert.rejects(generationPayload({ prompt: 'portrait' }, { ...DEFAULT_SETTINGS, steps: 32 }, read, encode), /1\.\.28/)
  assert.throws(() => normalizeSettings({ steps: 29 }), /消耗 Anlas/)
  assert.deepEqual(fitCanvasSize(3000, 2000), { width: 1216, height: 832 })
  const square = fitCanvasSize(1500, 1500)
  assert.ok(square.width * square.height <= 1024 * 1024)
})

test('局部重绘补齐 strength、img2img、add_original_image，正确处理透明 RGBA 蒙版与 V4.5 inpainting 规格', async () => {
  // 构造上半透明白色 (255,255,255,0)、下半不透明白色 (255,255,255,255) 的 RGBA 蒙版
  const rawRgba = Buffer.alloc(64 * 128 * 4)
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 64; x++) {
      const idx = (y * 64 + x) * 4
      rawRgba[idx] = 255; rawRgba[idx + 1] = 255; rawRgba[idx + 2] = 255
      rawRgba[idx + 3] = y < 64 ? 0 : 255
    }
  }
  const rgbaMask = await sharp(rawRgba, { raw: { width: 64, height: 128, channels: 4 } }).png().toBuffer()
  const readByPath = async path => path === 'mask.png' ? rgbaMask : png

  const body = await generationPayload({
    action: 'infill', model: 'nai-diffusion-5-curated', prompt: 'flower',
    image_path: 'in.png', mask_path: 'mask.png', parameters: { width: 64, height: 128 },
  }, DEFAULT_SETTINGS, readByPath, encode)

  assert.equal(body.model, 'nai-diffusion-4-5-curated-inpainting')
  assert.equal(body.action, 'infill')
  // V5 Curated 的 infill 实际由 V4.5 Curated inpainting 执行，与官网一致使用 params_version 4，并采用 V4.5 Curated 预设
  assert.equal(body.parameters.params_version, 4)
  assert.equal(body.input, 'flower, very aesthetic, masterpiece, no text, -0.8::feet::, rating:general')
  assert.equal(body.parameters.strength, 1)
  assert.equal(body.parameters.noise, 0)
  assert.equal(body.parameters.add_original_image, true)
  assert.equal(body.parameters.color_correct, true)
  assert.deepEqual(body.parameters.img2img, { strength: 1, noise: 0, color_correct: true })

  // 校验 modelInfo 直接查询 inpainting 模型 ID 时归属到 V4.5 Curated 而非误配 V5 Curated
  const resolvedSpec = modelInfo('nai-diffusion-4-5-curated-inpainting')
  assert.equal(resolvedSpec.family, 4.5)
  assert.equal(resolvedSpec.vibe, true)
  assert.equal(resolvedSpec.characters, 6)

  const maskRaw = await sharp(Buffer.from(body.parameters.mask, 'base64')).raw().toBuffer({ resolveWithObject: true })
  assert.equal(maskRaw.info.width, 64)
  assert.equal(maskRaw.info.height, 128)
  // 透明区域 flatten 到黑色保留 (0)，不透明白色保持重绘 (255)
  assert.equal(maskRaw.data[0], 0)
  assert.equal(maskRaw.data[maskRaw.data.length - 1], 255)
})

test('EXIF 旋转图片在图生图与 Precise Reference 中按视觉方向自动摆正', async () => {
  // 存储为 128×64 横图，但带 EXIF Orientation=6（顺时针旋转 90° 后视觉为 64×128 竖图）
  const exifRotatedJpeg = await sharp({ create: { width: 128, height: 64, channels: 3, background: '#ff5500' } })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer()

  const reference = await prepareReference(exifRotatedJpeg)
  const refInfo = await sharp(reference).metadata()
  assert.deepEqual([refInfo.width, refInfo.height], [1024, 1536])

  const body = await generationPayload({
    action: 'img2img', prompt: 'portrait', image_path: 'rotated.jpg',
  }, DEFAULT_SETTINGS, async () => exifRotatedJpeg, encode)
  assert.equal(body.parameters.width, 64)
  assert.equal(body.parameters.height, 128)
})

test('Precise Reference 真正完成缩放填充，fidelity 映射为 secondary strength', async () => {
  const reference = await prepareReference(png)
  const info = await sharp(reference).metadata()
  assert.deepEqual([info.width, info.height], [1024, 1536])
  const body = await generationPayload({ model: 'nai-diffusion-4-5-full', prompt: 'portrait', references: [{ image_path: 'ref.png', type: 'style', fidelity: 0.8 }] }, DEFAULT_SETTINGS, read, encode)
  assert.equal(body.parameters.director_reference_descriptions[0].caption.base_caption, 'style')
  assert.ok(Math.abs(body.parameters.director_reference_secondary_strength_values[0] - 0.2) < 1e-10)
  assert.equal(body.parameters.director_reference_strength_values[0], 1)
})

test('JSON 与 ZIP 多图解码均保留真实图像，特殊字符落盘路径可被 DSH parseFileLink 无损解析', async () => {
  const json = await decodeImages(Buffer.from(JSON.stringify({ images: [{ image: png.toString('base64'), seed: 77 }] })), 'application/json')
  const zip = await decodeImages(Buffer.from(zipSync({ 'image_0.png': png, 'image_1.png': png, 'notes.txt': new Uint8Array([1]) })), 'application/zip')
  assert.equal(json[0].seed, 77)
  assert.equal(zip.length, 2)
  await assert.rejects(decodeImages(Buffer.alloc(0), 'application/octet-stream'), /空图片结果/)

  const dir = await mkdtemp(join(tmpdir(), 'dsh-novelai-'))
  try {
    const result = await saveImages(json, dir, '中文 空格 #1 50%', { model: 'nai-diffusion-5-full' }, new AbortController().signal)
    assert.deepEqual(await readFile(result.images[0].path), png)
    assert.match(result.images[0].markdown, /!\[.*\]\(<.*中文 空格.*>\)/u)
    const destMatch = /^!\[[^\]]*\]\(<([^>]+)>\)$/u.exec(result.images[0].markdown)
    assert.ok(destMatch)
    const parsedLink = parseFileLink(destMatch[1])
    assert.equal(parsedLink?.path, result.images[0].path.replaceAll('\\', '/'))
    assert.equal(JSON.parse(await readFile(result.metadata_path, 'utf8')).images[0].seed, 77)

    // 额外验证含 ? 与 > 的极端路径转义
    const extremePath = 'D:/work/a?b#c%25>d/01.png'
    const extremeMd = formatImageMarkdown('测试', extremePath)
    const extremeDest = /^!\[[^\]]*\]\(<([^>]+)>\)$/u.exec(extremeMd)[1]
    assert.equal(parseFileLink(extremeDest)?.path, extremePath)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('Vibe 复用遵守模型和 information_extracted，不静默使用不匹配编码', () => {
  const value = JSON.stringify({ model: 'nai-diffusion-4-5-full', information_extracted: 0.7, encoding: 'YWJj' })
  assert.equal(parseVibe(value, 'nai-diffusion-4-5-full').information_extracted, 0.7)
  assert.throws(() => parseVibe(value, 'nai-diffusion-4-full'), /模型不匹配/)
  assert.throws(() => parseVibe(value, 'nai-diffusion-4-5-full', 1), /需要重新编码/)
})
