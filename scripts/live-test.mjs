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
async function run(label, name, args) {
  const start = Date.now()
  try {
    const value = await rig.call(name, args, AbortSignal.timeout(300_000))
    const row = { label, ok: true, seconds: (Date.now() - start) / 1000, value }
    results.push(row)
    console.log(`${label}: OK (${row.seconds}s)${value?.images ? ` ${value.images.map(image => image.path).join(', ')}` : ''}`)
    return value
  } catch (error) {
    const message = String(error).replaceAll(token, '[redacted]')
    results.push({ label, ok: false, seconds: (Date.now() - start) / 1000, error: message })
    console.log(`${label}: FAILED ${message}`)
    return undefined
  }
}
try {
  await run('account', 'novelai_account', {})
  await run('tags', 'novelai_suggest_tags', { prompt: 'watercolor' })
  if (!process.argv.includes('--account-only')) {
    const base = await run('v5-generate', 'novelai_generate', { prompt: '1girl, solo, adult woman, blue eyes, silver hair, red scarf, winter park, soft morning light, anime illustration, high complexity, very aesthetic', negative_prompt: 'lowres, artistic error, jpeg artifacts', parameters: { width: 832, height: 1216, seed: 3981726, steps: 28 } })
    if (base) {
      const source = base.images[0].path
      await run('img2img', 'novelai_generate', { action: 'img2img', image_path: source, prompt: '1girl, solo, adult woman, silver hair, blue scarf, winter park, anime illustration', parameters: { width: 832, height: 1216, steps: 12, strength: 0.3, noise: 0, seed: 3981726 } })
      await run('enhance', 'novelai_generate', { action: 'enhance', image_path: source, prompt: '1girl, solo, adult woman, silver hair, red scarf, winter park, detailed anime illustration', parameters: { width: 832, height: 1216, steps: 12, seed: 3981726 } })
      const mask = resolve(cwd, 'mask.png')
      await sharp({ create: { width: 832, height: 1216, channels: 3, background: '#000' } }).composite([{ input: await sharp({ create: { width: 256, height: 256, channels: 3, background: '#fff' } }).png().toBuffer(), left: 288, top: 608 }]).png().toFile(mask)
      await run('infill', 'novelai_generate', { action: 'infill', image_path: source, mask_path: mask, prompt: 'red scarf, detailed fabric, winter park, anime illustration', parameters: { width: 832, height: 1216, steps: 12, seed: 3981726 } })
      await run('upscale', 'novelai_upscale', { image_path: source })
      for (const operation of ['lineart', 'sketch', 'colorize', 'emotion', 'declutter', 'bg-removal']) await run(`director-${operation}`, 'novelai_augment', { image_path: source, operation, ...(operation === 'emotion' ? { prompt: 'happy;; smiling', defry: 2 } : operation === 'colorize' ? { prompt: 'silver hair, red scarf', defry: 1 } : {}) })
      await run('v4.5-multi-character', 'novelai_generate', { model: 'nai-diffusion-4-5-full', prompt: '2girls, adult women, park, sitting on bench, anime illustration', characters: [{ prompt: 'girl, silver hair, red scarf', positions: [{ x: 0.3, y: 0.5 }] }, { prompt: 'girl, brown hair, blue coat', positions: [{ x: 0.7, y: 0.5 }] }], use_coords: true, parameters: { width: 1216, height: 832, steps: 12, seed: 1024 } })
      const vibe = await run('encode-vibe', 'novelai_encode_vibe', { image_path: source, model: 'nai-diffusion-4-5-full', information_extracted: 0.7 })
      if (vibe) {
        const cached = await run('encode-vibe-cached', 'novelai_encode_vibe', { image_path: source, model: 'nai-diffusion-4-5-full', information_extracted: 0.7 })
        assert.equal(cached?.cached, true)
        await run('vibe-transfer', 'novelai_generate', { model: 'nai-diffusion-4-5-full', prompt: '1girl, adult woman, silver hair, winter street, anime illustration', vibes: [{ encoding_path: vibe.encoding_path, information_extracted: 0.7, strength: 0.6 }], parameters: { width: 832, height: 1216, steps: 12, seed: 1024 } })
      }
      await run('precise-reference', 'novelai_generate', { model: 'nai-diffusion-4-5-full', prompt: '1girl, adult woman, standing, sunny park, anime illustration', references: [{ image_path: source, type: 'character', fidelity: 0.8 }], parameters: { width: 832, height: 1216, steps: 12, seed: 1024 } })
    }
  }
} finally {
  await rig.dispose()
  await writeFile(resolve(cwd, 'report.json'), JSON.stringify(results, null, 2) + '\n')
}
if (results.some(result => !result.ok)) process.exitCode = 1
