import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import {
  hasOpusUsageBar,
  parseAccountSubscription,
  remainingRegenSeconds,
  subscriptionTierKind,
  usageTone,
} from '../src/shared.ts'
import { createAccountTracker } from '../src/node/account.ts'
import { NovelAIClient } from '../src/node/api.ts'
import { deriveAccountStatus } from '../src/client/controller.ts'
import { isHeroConversationPhase, selectNovelAISessionSignal } from '../src/client/helpers.ts'
import { toolRig } from '../scripts/dsh-runtime.mjs'

test('parseAccountSubscription 准确解析 Opus V5 血条、Boost 容量、满血倒计时抑制与非 Opus 档位', () => {
  const fullOpus = parseAccountSubscription({
    tier: 3,
    active: true,
    expiresAt: 1796945874,
    trainingStepsLeft: {
      fixedTrainingStepsLeft: 9687,
      purchasedTrainingSteps: 173,
    },
    usage: {
      percent: 100,
      purchasedPercent: 0,
      isNegative: false,
      timeUntilNextPercent: 7888,
    },
  })
  assert.equal(fullOpus.anlas.total, 9860)
  assert.equal(fullOpus.anlas.monthly, 9687)
  assert.equal(fullOpus.anlas.paid, 173)
  assert.equal(hasOpusUsageBar(fullOpus), true)
  assert.equal(subscriptionTierKind(fullOpus), 'opus')
  assert.equal(usageTone(fullOpus.usage), 'healthy')
  // 满血 100% 时即使服务端返回滚动周期秒数，也不应展示恢复倒计时
  assert.equal(remainingRegenSeconds(fullOpus.usage, 1_000_000, 1_060_000), null)

  const partialOpus = parseAccountSubscription({
    tier: 3,
    active: true,
    expiresAt: 1796945874,
    trainingStepsLeft: {
      fixedTrainingStepsLeft: 8000,
      purchasedTrainingSteps: 200,
    },
    usage: {
      percent: 48,
      purchasedPercent: 100,
      isNegative: false,
      timeUntilNextPercent: 7888,
    },
  })
  assert.equal(usageTone(partialOpus.usage), 'warn')
  assert.equal(partialOpus.usage.purchasedPercent, 100)
  assert.equal(remainingRegenSeconds(partialOpus.usage, 1_000_000, 1_088_000), 7800)

  const depletedOpus = parseAccountSubscription({
    tier: 3,
    active: true,
    trainingStepsLeft: { fixedTrainingStepsLeft: 500, purchasedTrainingSteps: 0 },
    usage: { percent: -3, purchasedPercent: 0, isNegative: true, timeUntilNextPercent: 3600 },
  })
  assert.equal(depletedOpus.usage.percent, 0)
  assert.equal(depletedOpus.usage.isNegative, true)
  assert.equal(usageTone(depletedOpus.usage), 'low')
  assert.equal(remainingRegenSeconds(depletedOpus.usage, 0, 600_000), 3000)

  const scrollTier = parseAccountSubscription({
    tier: 2,
    active: true,
    trainingStepsLeft: { fixedTrainingStepsLeft: 3000, purchasedTrainingSteps: 50 },
    usage: { percent: 100, purchasedPercent: 0, isNegative: false, timeUntilNextPercent: 0 },
  })
  assert.equal(hasOpusUsageBar(scrollTier), false)
  assert.equal(subscriptionTierKind(scrollTier), 'scroll')

  const expiredOpus = parseAccountSubscription({
    tier: 3,
    active: false,
    expiresAt: 0,
    trainingStepsLeft: { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 173 },
  })
  assert.equal(hasOpusUsageBar(expiredOpus), false)
  assert.equal(subscriptionTierKind(expiredOpus), 'inactive')
  assert.equal(expiredOpus.expiresAt, null)

  assert.throws(() => parseAccountSubscription({ active: true }), /格式不正确/)
  assert.throws(
    () => parseAccountSubscription({ active: true, trainingStepsLeft: { fixedTrainingStepsLeft: 'bad', purchasedTrainingSteps: 0 } }),
    /点数字段/,
  )
})

test('createAccountTracker 支持未配置免请求、并发去重、过期刷新、扣费防抖与凭据变更中止自愈', async () => {
  let configured = false
  let clock = 10_000
  let fetchCalls = 0
  let percent = 100

  const tracker = createAccountTracker({
    isConfigured: async () => configured,
    fetchSubscription: async () => {
      fetchCalls += 1
      await new Promise(resolve => setTimeout(resolve, 15))
      return {
        tier: 3,
        active: true,
        expiresAt: 1796945874,
        trainingStepsLeft: { fixedTrainingStepsLeft: 9687, purchasedTrainingSteps: 173 },
        usage: { percent, purchasedPercent: 0, isNegative: false, timeUntilNextPercent: 7888 },
      }
    },
    debounceMs: 25,
    staleMs: 60_000,
    now: () => clock,
  })

  try {
    // 1. 未配置密钥时不向 NovelAI 发起任何请求
    const initial = await tracker.getOrRefresh()
    assert.equal(initial.configured, false)
    assert.equal(deriveAccountStatus(initial), 'unconfigured')
    assert.equal(fetchCalls, 0)

    // 2. 保存密钥后触发凭据变更并并发拉取，验证单飞去重
    configured = true
    const [first, second] = await Promise.all([
      tracker.handleCredentialChange(),
      tracker.refresh(),
    ])
    assert.equal(fetchCalls, 1)
    assert.equal(first.configured, true)
    assert.equal(first.data?.usage?.percent, 100)
    assert.equal(second.data?.anlas.total, 9860)
    assert.equal(deriveAccountStatus(first), 'ready')

    // 3. 缓存有效期内 getOrRefresh 直接命中内存状态
    clock += 10_000
    const cached = await tracker.getOrRefresh()
    assert.equal(fetchCalls, 1)
    assert.equal(cached.fetchedAt, 10_000)

    // 4. 超出 staleMs 后 getOrRefresh 自动刷新
    clock += 60_000
    percent = 99
    const refreshed = await tracker.getOrRefresh()
    assert.equal(fetchCalls, 2)
    assert.equal(refreshed.data?.usage?.percent, 99)

    // 5. 连续多次扣费通知合并为一次后台防抖刷新
    percent = 97
    tracker.notifyQuotaUsed()
    tracker.notifyQuotaUsed()
    tracker.notifyQuotaUsed()
    assert.equal(tracker.get().activitySeq >= 4, true)
    await new Promise(resolve => setTimeout(resolve, 65))
    assert.equal(fetchCalls, 3)
    assert.equal(tracker.get().data?.usage?.percent, 97)

    // 6. 移除密钥后立即清空缓存且不再发起网络请求
    configured = false
    const cleared = await tracker.handleCredentialChange()
    assert.equal(cleared.configured, false)
    assert.equal(cleared.data, null)
    assert.equal(fetchCalls, 3)
  } finally {
    tracker.dispose()
  }
})

test('付费工具仅在实际调用上游计费接口时触发额度刷新，缓存命中 Vibe 不误触发', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-novelai-quota-hooks-'))
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer()
  let quotaSignals = 0
  let syncedAccount = null

  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    if (req.url === '/user/subscription') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        tier: 3,
        active: true,
        trainingStepsLeft: { fixedTrainingStepsLeft: 9000, purchasedTrainingSteps: 100 },
        usage: { percent: 95, purchasedPercent: 0, isNegative: false, timeUntilNextPercent: 5000 },
      }))
      return
    }
    if (req.url === '/ai/encode-vibe') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end(Buffer.from([9, 8, 7, 6]))
      return
    }
    res.writeHead(201, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ images: [{ image: png.toString('base64'), seed: 42 }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const client = new NovelAIClient(async () => 'pst-hook-test', () => 10, `http://127.0.0.1:${server.address().port}`)
  const rig = await toolRig(client, directory, 'novelai-output', {
    hooks: {
      onQuotaUsed: () => { quotaSignals += 1 },
      onAccountData: raw => { syncedAccount = parseAccountSubscription(raw) },
    },
  })

  try {
    await writeFile(join(directory, 'src.png'), png)
    await rig.call('novelai_generate', { prompt: 'starlight', parameters: { width: 64, height: 64 } })
    assert.equal(quotaSignals, 1)

    // 首次 Vibe 编码扣费，二次复用本地缓存不触发扣费信号
    const firstVibe = await rig.call('novelai_encode_vibe', { image_path: 'src.png', information_extracted: 0.8 })
    assert.equal(firstVibe.cached, false)
    assert.equal(quotaSignals, 2)

    const cachedVibe = await rig.call('novelai_encode_vibe', { image_path: 'src.png', information_extracted: 0.8 })
    assert.equal(cachedVibe.cached, true)
    assert.equal(quotaSignals, 2)

    await rig.call('novelai_account', {})
    assert.equal(syncedAccount?.anlas.total, 9100)
    assert.equal(syncedAccount?.usage?.percent, 95)
  } finally {
    await rig.dispose()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})

test('前端首页 Hero 阶段判定与会话 NovelAI 工具活动信号精确区分各状态', () => {
  const emptyTargets = { activeTargets: new Set() }
  assert.equal(
    isHeroConversationPhase(
      { blank: true, awaitingFirstTurn: false, running: false, promptAttempted: false, openState: 'open' },
      emptyTargets,
      true,
    ),
    true,
  )
  assert.equal(
    isHeroConversationPhase(
      { blank: false, awaitingFirstTurn: false, running: false, promptAttempted: true, openState: 'open' },
      emptyTargets,
      false,
    ),
    false,
  )
  assert.equal(
    isHeroConversationPhase(
      { blank: true, awaitingFirstTurn: true, running: true, promptAttempted: true, openState: 'open' },
      emptyTargets,
      false,
    ),
    false,
  )

  assert.equal(selectNovelAISessionSignal({
    legacy: {
      nodes: [{ kind: 'tool-result', seq: 3, name: 'bash' }],
      runningCalls: [],
    },
  }), 0)

  assert.equal(selectNovelAISessionSignal({
    legacy: {
      nodes: [{ kind: 'tool-result', seq: 3, name: 'bash' }],
      runningCalls: [{ name: 'novelai_generate' }],
    },
  }), -1)

  assert.equal(selectNovelAISessionSignal({
    legacy: {
      nodes: [
        { kind: 'tool-result', seq: 4, name: 'novelai_generate' },
        { kind: 'tool-result', seq: 9, name: 'novelai_upscale' },
      ],
      runningCalls: [],
    },
  }), 9)
})
