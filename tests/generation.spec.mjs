import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { generationPayload, prepareReference, parseVibe } from '../src/node/generation.ts'
import { saveImages } from '../src/node/storage.ts'
import { decodeImages } from '../src/node/api.ts'
import { zipSync } from 'fflate'

const png = await sharp({ create: { width: 64, height: 128, channels: 4, background: '#46aaff' } }).png().toBuffer()
const read = async () => png
const encode = async () => { throw new Error('unexpected paid encoding') }

test('多角色基础与负向 caption 一一对应，坐标和全部高级参数传给真实请求结构', async () => {
  const body = await generationPayload({ prompt: '2girls, park', negative_prompt: 'lowres', characters: [
    { prompt: 'girl, black hair', negative_prompt: 'hat', positions: [{ x: 0.2, y: 0.7 }] }, { prompt: 'girl, blonde hair' },
  ], parameters: { width: 1216, height: 832, seed: 21, n_samples: 2, straight_alpha: true, tag_hint_qt: 0, upscale: { declared_blur_sigma: 0.35 } } }, 'nai-diffusion-5-full', read, encode)
  assert.equal(body.model, 'nai-diffusion-5-full')
  assert.equal(body.parameters.v4_prompt.caption.char_captions[0].char_caption, 'girl, black hair')
  assert.equal(body.parameters.v4_negative_prompt.caption.char_captions[0].char_caption, 'hat')
  assert.deepEqual(body.parameters.v4_prompt.caption.char_captions[0].centers, [{ x: 0.2, y: 0.7 }])
  assert.equal(body.parameters.v4_prompt.use_coords, true)
  assert.equal(body.parameters.n_samples, 2)
  assert.equal(body.parameters.straight_alpha, true)
  assert.equal(body.parameters.upscale.declared_blur_sigma, 0.35)
})

test('不支持的模型组合在编码或扣费请求前报错', async () => {
  await assert.rejects(generationPayload({ prompt: 'landscape', vibes: [{ image_path: 'style.png' }] }, 'nai-diffusion-5-full', read, encode), /不支持 Vibe/)
  await assert.rejects(generationPayload({ prompt: 'portrait', references: [{ image_path: 'ref.png' }] }, 'nai-diffusion-5-full', read, encode), /只支持 V4.5/)
  await assert.rejects(generationPayload({ prompt: 'portrait', model: 'nai-diffusion-4-5-full', references: [{ image_path: 'r' }], vibes: [{ image_path: 'v' }] }, 'nai-diffusion-5-full', read, encode), /同时使用/)
  await assert.rejects(generationPayload({ prompt: 'portrait', parameters: { width: 1000 } }, 'nai-diffusion-5-full', read, encode), /64 倍数/)
})

test('局部重绘选择相应模型并编码源图和对应尺寸蒙版', async () => {
  const body = await generationPayload({ action: 'infill', model: 'nai-diffusion-5-curated', prompt: 'flower', image_path: 'in.png', mask_path: 'mask.png', parameters: { width: 64, height: 128 } }, 'nai-diffusion-5-full', read, encode)
  assert.equal(body.model, 'nai-diffusion-4-5-curated-inpainting')
  assert.equal(body.action, 'infill')
  assert.deepEqual(Buffer.from(body.parameters.image, 'base64'), png)
  const info = await sharp(Buffer.from(body.parameters.mask, 'base64')).metadata()
  assert.equal(info.width, 64)
  assert.equal(info.height, 128)
})

test('Precise Reference 真正完成缩放填充，fidelity 映射为 secondary strength', async () => {
  const reference = await prepareReference(png)
  const info = await sharp(reference).metadata()
  assert.deepEqual([info.width, info.height], [1024, 1536])
  const body = await generationPayload({ model: 'nai-diffusion-4-5-full', prompt: 'portrait', references: [{ image_path: 'ref.png', type: 'style', fidelity: 0.8 }] }, 'nai-diffusion-5-full', read, encode)
  assert.equal(body.parameters.director_reference_descriptions[0].caption.base_caption, 'style')
  assert.ok(Math.abs(body.parameters.director_reference_secondary_strength_values[0] - 0.2) < 1e-10)
  assert.equal(body.parameters.director_reference_strength_values[0], 1)
})

test('JSON 与 ZIP 多图解码均保留真实图像，落盘路径可直接用于 Markdown', async () => {
  const json = await decodeImages(Buffer.from(JSON.stringify({ images: [{ image: png.toString('base64'), seed: 77 }] })), 'application/json')
  const zip = await decodeImages(Buffer.from(zipSync({ 'image_0.png': png, 'image_1.png': png, 'notes.txt': new Uint8Array([1]) })), 'application/zip')
  assert.equal(json[0].seed, 77)
  assert.equal(zip.length, 2)
  const dir = await mkdtemp(join(tmpdir(), 'dsh-novelai-'))
  try {
    const result = await saveImages(json, dir, '中文 空格', { model: 'nai-diffusion-5-full' }, new AbortController().signal)
    assert.deepEqual(await readFile(result.images[0].path), png)
    assert.match(result.images[0].markdown, /!\[.*\]\(<.*中文 空格.*>\)/u)
    assert.equal(JSON.parse(await readFile(result.metadata_path, 'utf8')).images[0].seed, 77)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('Vibe 复用遵守模型和 information_extracted，不静默使用不匹配编码', () => {
  const value = JSON.stringify({ model: 'nai-diffusion-4-5-full', information_extracted: 0.7, encoding: 'YWJj' })
  assert.equal(parseVibe(value, 'nai-diffusion-4-5-full').information_extracted, 0.7)
  assert.throws(() => parseVibe(value, 'nai-diffusion-4-full'), /模型不匹配/)
  assert.throws(() => parseVibe(value, 'nai-diffusion-4-5-full', 1), /需要重新编码/)
})
