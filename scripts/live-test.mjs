import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { credentialToken, toolRig } from './dsh-runtime.mjs'
import { NovelAIClient } from '../src/node/api.ts'

const token = await credentialToken()
const client = new NovelAIClient(async () => token, () => 300)
const cwd = resolve('output/live')
await mkdir(cwd, { recursive: true })
const rig = await toolRig(client, cwd)
const results = []

async function pixelRegionDelta(pathA, pathB, box) {
  const [rawA, rawB] = await Promise.all([
    sharp(pathA).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(pathB).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ])
  assert.equal(rawA.info.width, rawB.info.width)
  assert.equal(rawA.info.height, rawB.info.height)
  const width = rawA.info.width
  let sum = 0
  let count = 0
  for (let y = box.top; y < box.top + box.height; y++) {
    for (let x = box.left; x < box.left + box.width; x++) {
      const idx = (y * width + x) * 4
      sum += (Math.abs(rawA.data[idx] - rawB.data[idx])
        + Math.abs(rawA.data[idx + 1] - rawB.data[idx + 1])
        + Math.abs(rawA.data[idx + 2] - rawB.data[idx + 2])) / 3
      count += 1
    }
  }
  return sum / count
}

async function run(label, name, args, verify) {
  const start = Date.now()
  try {
    const value = await rig.call(name, args, AbortSignal.timeout(300_000))
    const metrics = verify ? await verify(value) : undefined
    const row = { label, ok: true, seconds: Number(((Date.now() - start) / 1000).toFixed(3)), value, ...(metrics ? { metrics } : {}) }
    results.push(row)
    console.log(`${label}: OK (${row.seconds}s)${value?.images ? ` ${value.images.map(image => image.path).join(', ')}` : ''}${metrics ? ` ${JSON.stringify(metrics)}` : ''}`)
    return value
  } catch (error) {
    const message = String(error).replaceAll(token, '[redacted]')
    results.push({ label, ok: false, seconds: Number(((Date.now() - start) / 1000).toFixed(3)), error: message })
    console.log(`${label}: FAILED ${message}`)
    return undefined
  }
}

try {
  await run('account-before', 'novelai_account', {})
  await run('capabilities', 'novelai_capabilities', { include_parameters: false }, cap => {
    assert.equal(cap.models.length, 8)
    return { models: cap.models.length }
  })
  await run('tags', 'novelai_suggest_tags', { prompt: 'watercolor' }, res => {
    assert.ok(Array.isArray(res.tags) && res.tags.length > 0)
    return { tagCount: res.tags.length }
  })

  if (!process.argv.includes('--account-only')) {
    const base = await run('v5-generate', 'novelai_generate', {
      prompt: '1girl, solo, adult woman, blue eyes, short silver hair, plain white sweater, winter park, snowing, soft morning light, upper body, anime illustration, high complexity, very aesthetic, best quality',
      negative_prompt: 'lowres, artistic error, scan artifacts, worst quality, jpeg artifacts, very displeasing, scarf, red',
      parameters: { width: 832, height: 1216, seed: 3981726, steps: 24 },
    }, res => {
      assert.equal(res.images[0].width, 832)
      assert.equal(res.images[0].height, 1216)
      assert.equal(res.images[0].seed, 3981726)
      return { width: res.images[0].width, height: res.images[0].height }
    })

    if (base) {
      const source = base.images[0].path

      await run('img2img', 'novelai_generate', {
        action: 'img2img', image_path: source,
        prompt: '1girl, solo, adult woman, short silver hair, navy blue coat, winter park, night, glowing streetlights, anime illustration, high complexity, very aesthetic',
        parameters: { width: 832, height: 1216, steps: 20, strength: 0.55, noise: 0.1, seed: 3981726 },
      })

      await run('enhance', 'novelai_generate', {
        action: 'enhance', image_path: source,
        prompt: '1girl, solo, adult woman, short silver hair, plain white sweater, winter park, intricate eyelashes, crisp lighting, anime illustration, high complexity, very aesthetic, best quality',
        parameters: { width: 832, height: 1216, steps: 20, seed: 3981726 },
      })

      // 构造带透明通道的 RGBA 蒙版：透明区域 (255,255,255,0) 应保留，胸口白色方块 (256×256) 重绘红围巾/大红蝴蝶结
      const maskBox = { left: 288, top: 640, width: 256, height: 256 }
      const rgbaMaskBuf = Buffer.alloc(832 * 1216 * 4)
      for (let y = 0; y < 1216; y++) {
        for (let x = 0; x < 832; x++) {
          const idx = (y * 832 + x) * 4
          const inside = x >= maskBox.left && x < maskBox.left + maskBox.width && y >= maskBox.top && y < maskBox.top + maskBox.height
          rgbaMaskBuf[idx] = 255
          rgbaMaskBuf[idx + 1] = 255
          rgbaMaskBuf[idx + 2] = 255
          rgbaMaskBuf[idx + 3] = inside ? 255 : 0
        }
      }
      const mask = resolve(cwd, 'rgba-mask.png')
      await sharp(rgbaMaskBuf, { raw: { width: 832, height: 1216, channels: 4 } }).png().toFile(mask)

      await run('infill-v5-full', 'novelai_generate', {
        action: 'infill', image_path: source, mask_path: mask,
        prompt: '1girl, bright crimson red knitted scarf, big red ribbon bow on chest, vivid red fabric, winter park, anime illustration, high complexity, very aesthetic',
        parameters: { width: 832, height: 1216, steps: 24, seed: 3981727 },
      }, async res => {
        assert.equal(res.model, 'nai-diffusion-5-full-inpainting')
        const insideDelta = await pixelRegionDelta(source, res.images[0].path, maskBox)
        const outsideDelta = await pixelRegionDelta(source, res.images[0].path, { left: 0, top: 0, width: 832, height: 220 })
        assert.ok(insideDelta > 15, `infill 遮罩内平均像素变化过低 (${insideDelta.toFixed(2)})，局部重绘未生效`)
        assert.ok(outsideDelta < 2, `infill 遮罩外平均像素变化过高 (${outsideDelta.toFixed(2)})，原图叠加未生效`)
        return { insideDelta: Number(insideDelta.toFixed(2)), outsideDelta: Number(outsideDelta.toFixed(2)) }
      })

      await run('infill-v5-curated-fallback', 'novelai_generate', {
        model: 'nai-diffusion-5-curated',
        action: 'infill', image_path: source, mask_path: mask,
        prompt: '1girl, bright emerald green ribbon bow on chest, winter park, anime illustration, very aesthetic',
        parameters: { width: 832, height: 1216, steps: 20, seed: 3981728 },
      }, async res => {
        assert.equal(res.model, 'nai-diffusion-4-5-curated-inpainting')
        const insideDelta = await pixelRegionDelta(source, res.images[0].path, maskBox)
        assert.ok(insideDelta > 15, `V5 Curated->V4.5 inpainting 遮罩内平均像素变化过低 (${insideDelta.toFixed(2)})`)
        return { effectiveModel: res.model, insideDelta: Number(insideDelta.toFixed(2)) }
      })

      // 用 512×512 测试 2x 放大，既快又精确验证 512×512 -> 1024×1024 及无虚假 seed: 0
      const smallPath = resolve(cwd, 'upscale-source-512.png')
      await sharp(source).resize(512, 512, { fit: 'cover' }).png().toFile(smallPath)
      await run('upscale-2x', 'novelai_upscale', { image_path: smallPath, declared_blur_sigma: 0.35 }, res => {
        assert.equal(res.images[0].width, 1024)
        assert.equal(res.images[0].height, 1024)
        assert.equal(res.images[0].seed, undefined)
        return { from: '512x512', to: `${res.images[0].width}x${res.images[0].height}` }
      })

      await run('v5-text-comic', 'novelai_generate', {
        prompt: '1girl, solo, adult woman, barista apron, smiling, holding coffee mug, speech bubble, text, english text, cozy cafe, high complexity, very aesthetic, best quality\nThe barista holds a warm mug and greets the viewer with a speech bubble.\nText: Good morning!',
        negative_prompt: 'lowres, artistic error, scan artifacts, worst quality, jpeg artifacts',
        parameters: { width: 832, height: 1216, steps: 24, seed: 20261111, tag_hint_qt: 0 },
      })

      for (const operation of ['lineart', 'sketch', 'colorize', 'emotion', 'declutter', 'bg-removal']) {
        await run(`director-${operation}`, 'novelai_augment', {
          image_path: smallPath,
          operation,
          ...(operation === 'emotion' ? { prompt: 'happy;; smiling', defry: 2 } : operation === 'colorize' ? { prompt: 'silver hair, blue sweater', defry: 1 } : {}),
        }, res => ({ variants: res.images.length }))
      }

      await run('v4.5-multi-character', 'novelai_generate', {
        model: 'nai-diffusion-4-5-full',
        prompt: '2girls, adult women, winter park, sitting on wooden bench, warm light, anime illustration, very aesthetic, best quality',
        characters: [
          { prompt: 'girl, silver hair, red scarf, smiling, source#holding hands', positions: [{ x: 0.3, y: 0.55 }] },
          { prompt: 'girl, brown hair, blue coat, blushing, target#holding hands', positions: [{ x: 0.7, y: 0.55 }] },
        ],
        use_coords: true,
        parameters: { width: 1216, height: 832, steps: 20, seed: 1024 },
      })

      const vibe = await run('encode-vibe', 'novelai_encode_vibe', { image_path: source, model: 'nai-diffusion-4-5-full', information_extracted: 0.7 })
      if (vibe) {
        const cached = await run('encode-vibe-cached', 'novelai_encode_vibe', { image_path: source, model: 'nai-diffusion-4-5-full', information_extracted: 0.7 }, res => {
          assert.equal(res.cached, true)
          return { cached: res.cached }
        })
        if (cached) {
          await run('vibe-transfer', 'novelai_generate', {
            model: 'nai-diffusion-4-5-full',
            prompt: '1girl, adult woman, silver hair, snowy town street, lantern light, anime illustration, very aesthetic',
            vibes: [{ encoding_path: vibe.encoding_path, information_extracted: 0.7, strength: 0.6 }],
            parameters: { width: 832, height: 1216, steps: 20, seed: 1024 },
          })
        }
      }

      await run('precise-reference', 'novelai_generate', {
        model: 'nai-diffusion-4-5-full',
        prompt: '1girl, adult woman, standing in sunny autumn park, anime illustration, very aesthetic, best quality',
        references: [{ image_path: source, type: 'character', fidelity: 0.8 }],
        parameters: { width: 832, height: 1216, steps: 20, seed: 1024 },
      })
    }

    await run('account-after', 'novelai_account', {})
  }
} finally {
  await rig.dispose()
  await writeFile(resolve(cwd, 'report.json'), JSON.stringify(results, null, 2) + '\n')
}
if (results.some(result => !result.ok)) process.exitCode = 1
