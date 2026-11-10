import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { zipSync } from 'fflate'
import { toolRig } from '../scripts/dsh-runtime.mjs'
import { NovelAIClient } from '../src/node/api.ts'

test('真实工具 schema、HTTP 请求、凭据、图片保存和 Vibe 缓存协同工作', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-novelai-tools-'))
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer()
  const token = 'pst-test-only-do-not-use'
  const calls = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf8')
    const body = text ? JSON.parse(text) : undefined
    calls.push({ url: request.url, auth: request.headers.authorization, body })
    if (request.url === '/ai/encode-vibe') { response.end(Buffer.from([1, 2, 3, 4])); return }
    if (request.url === '/ai/augment-image') {
      response.writeHead(201, { 'content-type': 'application/zip' })
      response.end(zipSync({ 'masked.png': png, 'generated.png': png, 'blend.png': png })); return
    }
    if (request.url === '/error') { response.writeHead(429); response.end(`Error ${token}`); return }
    if (request.url === '/wait') return
    response.writeHead(201, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ images: [{ image: png.toString('base64'), seed: 15 }, { image: png.toString('base64'), seed: 16 }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const client = new NovelAIClient(async () => token, () => 10, `http://127.0.0.1:${server.address().port}`)
  const rig = await toolRig(client, directory)
  try {
    await writeFile(join(directory, 'input.png'), png)
    const generated = await rig.call('novelai_generate', { prompt: 'landscape', parameters: { width: 64, height: 64, n_samples: 2, seed: 15, tag_hint_transparent_background: true } })
    assert.equal(generated.images.length, 2)
    assert.equal(calls[0].auth, `Bearer ${token}`)
    assert.equal(calls[0].body.parameters.n_samples, 2)
    assert.equal(calls[0].body.parameters.tag_hint_transparent_background, true)
    assert.deepEqual(await readFile(generated.images[0].path), png)
    assert.equal(generated.images[1].seed, 16)
    const metadata = await readFile(generated.metadata_path, 'utf8')
    assert.ok(!metadata.includes(token))
    const count = calls.length
    await assert.rejects(rig.call('novelai_generate', { prompt: 'test', parameters: { n_samples: '2' } }))
    assert.equal(calls.length, count)
    const augmented = await rig.call('novelai_augment', { image_path: 'input.png', operation: 'bg-removal' })
    assert.equal(augmented.images.length, 3)
    assert.equal(calls.at(-1).body.width, 64)
    assert.equal(calls.at(-1).body.height, 64)
    const first = await rig.call('novelai_encode_vibe', { image_path: 'input.png', information_extracted: 0.7 })
    const second = await rig.call('novelai_encode_vibe', { image_path: 'input.png', information_extracted: 0.7 })
    assert.equal(first.cached, false)
    assert.equal(second.cached, true)
    assert.equal(calls.filter(call => call.url === '/ai/encode-vibe').length, 1)
    await rig.call('novelai_generate', { prompt: 'landscape', model: 'nai-diffusion-4-5-full', vibes: [{ encoding_path: first.encoding_path }] })
    assert.equal(calls.at(-1).body.parameters.reference_information_extracted_multiple[0], 0.7)
    const beforeError = calls.length
    await assert.rejects(client.json('/error', {}, new AbortController().signal), error => error.message.includes('[redacted]') && !error.message.includes(token))
    assert.equal(calls.length, beforeError + 1)
    await assert.rejects(client.json('/wait', {}, AbortSignal.timeout(30)))
    const capabilities = await rig.call('novelai_capabilities', { include_parameters: true })
    assert.ok(capabilities.parameters['image.RequestParameters'].properties.director_reference_images)
    assert.equal(rig.definitions.size, 7)
  } finally {
    await rig.dispose()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})
