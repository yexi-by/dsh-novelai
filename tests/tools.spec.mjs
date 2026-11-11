import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { zipSync } from 'fflate'
import { toolRig } from '../scripts/dsh-runtime.mjs'
import { NovelAIClient } from '../src/node/api.ts'

const { registerSkill } = await import('../src/node/skill.ts')

test('真实工具 schema、HTTP 请求、凭据、图片保存、放大与损坏 Vibe 缓存自愈协同工作', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-novelai-tools-'))
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer()
  const upscaledPng = await sharp({ create: { width: 128, height: 128, channels: 3, background: 'white' } }).png().toBuffer()
  const token = 'pst-test-only-do-not-use'
  const calls = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf8')
    const body = text ? JSON.parse(text) : undefined
    calls.push({ url: request.url, auth: request.headers.authorization, accept: request.headers.accept, body })
    if (request.url === '/ai/encode-vibe') { response.end(Buffer.from([1, 2, 3, 4])); return }
    if (request.url === '/ai/augment-image') {
      response.writeHead(201, { 'content-type': 'application/zip' })
      response.end(zipSync({ 'masked.png': png, 'generated.png': png, 'blend.png': png })); return
    }
    if (request.url === '/ai/upscale') {
      response.writeHead(201, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ images: [{ image: upscaledPng.toString('base64'), seed: 0 }] })); return
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
    assert.match(calls[0].accept, /application\/zip/)
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

    // 2x 放大剥离服务端固定返回的虚假 seed: 0，并拒绝非法 sigma
    const upscaled = await rig.call('novelai_upscale', { image_path: 'input.png', declared_blur_sigma: 0.35 })
    assert.equal(upscaled.images[0].width, 128)
    assert.equal(upscaled.images[0].height, 128)
    assert.equal(upscaled.images[0].seed, undefined)
    await assert.rejects(rig.call('novelai_upscale', { image_path: 'input.png', declared_blur_sigma: 0.2 }), /declared_blur_sigma/)

    // Vibe 缓存命中与损坏缓存自愈重新编码
    const first = await rig.call('novelai_encode_vibe', { image_path: 'input.png', information_extracted: 0.7 })
    const second = await rig.call('novelai_encode_vibe', { image_path: 'input.png', information_extracted: 0.7 })
    assert.equal(first.cached, false)
    assert.equal(second.cached, true)
    assert.equal(calls.filter(call => call.url === '/ai/encode-vibe').length, 1)

    await writeFile(first.encoding_path, '{corrupted-json')
    const healed = await rig.call('novelai_encode_vibe', { image_path: 'input.png', information_extracted: 0.7 })
    assert.equal(healed.cached, false)
    assert.equal(calls.filter(call => call.url === '/ai/encode-vibe').length, 2)

    // 当默认模型配置为 V4 时，novelai_encode_vibe 默认跟随该 V4 模型
    rig.state.model = 'nai-diffusion-4-full'
    const v4Vibe = await rig.call('novelai_encode_vibe', { image_path: 'input.png', information_extracted: 0.5 })
    assert.equal(v4Vibe.model, 'nai-diffusion-4-full')
    rig.state.model = 'nai-diffusion-5-full'

    await rig.call('novelai_generate', { prompt: 'landscape', model: 'nai-diffusion-4-5-full', vibes: [{ encoding_path: first.encoding_path }] })
    assert.equal(calls.at(-1).body.parameters.reference_information_extracted_multiple[0], 0.7)

    const beforeError = calls.length
    await assert.rejects(client.json('/error', {}, new AbortController().signal), error => error.message.includes('[redacted]') && !error.message.includes(token))
    assert.equal(calls.length, beforeError + 1)
    await assert.rejects(client.json('/wait', {}, AbortSignal.timeout(30)))

    const capabilities = await rig.call('novelai_capabilities', { include_parameters: true })
    assert.ok(capabilities.parameters['image.RequestParameters'].properties.director_reference_images)
    assert.equal(rig.definitions.size, 7)

    // 只读工具开启并发安全，付费写工具保持独占
    assert.equal(rig.definitions.get('novelai_account').isConcurrencySafe?.({}), true)
    assert.equal(rig.definitions.get('novelai_capabilities').isConcurrencySafe?.({}), true)
    assert.equal(rig.definitions.get('novelai_suggest_tags').isConcurrencySafe?.({ prompt: 'sky' }), true)
    assert.equal(rig.definitions.get('novelai_generate').isConcurrencySafe, undefined)
  } finally {
    await rig.dispose()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})

test('会话 sandboxPolicy 在发起付费请求前拦截 read-only、相对越界与符号链接逃逸', async () => {
  const sandboxBaseRoot = join(process.cwd(), 'output')
  await mkdir(sandboxBaseRoot, { recursive: true })
  const baseTemp = await mkdtemp(join(sandboxBaseRoot, 'sandbox-test-'))
  const workspace = join(baseTemp, 'workspace')
  const outside = join(baseTemp, 'outside')
  await mkdir(workspace, { recursive: true })
  await mkdir(outside, { recursive: true })
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer()
  await writeFile(join(workspace, 'in.png'), png)
  await symlink(outside, join(workspace, 'linked-out'), process.platform === 'win32' ? 'junction' : 'dir')

  let httpHits = 0
  const server = createServer((_req, res) => {
    httpHits += 1
    res.writeHead(201, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ images: [{ image: png.toString('base64'), seed: 1 }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const client = new NovelAIClient(async () => 'pst-sandbox', () => 5, `http://127.0.0.1:${server.address().port}`)

  const rig = await toolRig(client, workspace, 'novelai-output', {
    policy: { mode: 'read-only', workspaceRoot: workspace },
  })
  try {
    await assert.rejects(rig.call('novelai_generate', { prompt: 'sky', parameters: { width: 64, height: 64 } }), /\[sandbox: read-only\]/)
    await assert.rejects(rig.call('novelai_upscale', { image_path: 'in.png' }), /\[sandbox: read-only\]/)
    await assert.rejects(rig.call('novelai_encode_vibe', { image_path: 'in.png' }), /\[sandbox: read-only\]/)
    assert.equal(httpHits, 0)

    // workspace-write 下拦截 ../outside 相对越界，零 HTTP 请求发出
    rig.state.policy = { mode: 'workspace-write', workspaceRoot: workspace }
    rig.state.outputDirectory = '../outside'
    await assert.rejects(rig.call('novelai_generate', { prompt: 'sky', parameters: { width: 64, height: 64 } }), /\[sandbox: workspace-write\]/)
    assert.equal(httpHits, 0)

    // workspace-write 下拦截指向工作区外部的符号链接/目录联接逃逸，零 HTTP 请求发出
    rig.state.outputDirectory = 'linked-out/sub'
    await assert.rejects(rig.call('novelai_generate', { prompt: 'sky', parameters: { width: 64, height: 64 } }), /\[sandbox: workspace-write\]/)
    assert.equal(httpHits, 0)

    // 显式加入 additionalWritableRoots 后允许向 outside 写出（但拒绝直接传入符号链接作为授权根）
    rig.state.policy = { mode: 'workspace-write', workspaceRoot: workspace, additionalWritableRoots: [join(workspace, 'linked-out')] }
    await assert.rejects(rig.call('novelai_generate', { prompt: 'sky', parameters: { width: 64, height: 64 } }), /不支持符号链接目录授权/)
    assert.equal(httpHits, 0)

    rig.state.outputDirectory = 'novelai-output'
    rig.state.policy = { mode: 'workspace-write', workspaceRoot: workspace, additionalWritableRoots: [outside] }
    const ok = await rig.call('novelai_generate', { prompt: 'sky', parameters: { width: 64, height: 64 } })
    assert.equal(ok.images.length, 1)
    assert.equal(httpHits, 1)
  } finally {
    await rig.dispose()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(baseTemp, { recursive: true, force: true })
  }
})

test('内置 novelai-v5-prompt Skill 注册路径规范且与 SKILL.md frontmatter 一致', async () => {
  let providerFactory
  registerSkill({ skills: { registerProvider(factory) { providerFactory = factory } } })
  assert.ok(providerFactory)
  const provider = providerFactory()
  const list = await provider.list()
  assert.equal(list.length, 1)
  const skill = list[0]
  assert.equal(skill.name, 'novelai-v5-prompt')
  assert.ok(!skill.resourceBase.path.endsWith('/'))
  assert.ok(!skill.path.includes('//'))
  assert.match(skill.description, /2 倍放大/)
  const loaded = await provider.get(skill, { signal: new AbortController().signal })
  assert.ok(!loaded.content.startsWith('---'))
  assert.match(loaded.content, /# NovelAI 绘图与编辑/)
})
