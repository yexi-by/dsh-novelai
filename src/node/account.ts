import { parseAccountSubscription } from '../shared.ts'
import type { NovelAIAccountSnapshot } from '../shared.ts'

export interface AccountTrackerOptions {
  /** 检查当前凭据是否已配置，未配置时不发起上游请求。 */
  isConfigured: () => Promise<boolean>
  /** 请求 NovelAI `/user/subscription` 原始 JSON。 */
  fetchSubscription: (signal: AbortSignal) => Promise<unknown>
  /** 扣费工具完成后的后台刷新防抖毫秒数。 */
  debounceMs?: number
  /** 缓存过期毫秒数；超出后前端拉取会自动触发一次刷新。 */
  staleMs?: number
  /** 可选时钟注入（便于单测控制时间推进）。 */
  now?: () => number
}

export interface AccountTracker {
  get: () => NovelAIAccountSnapshot
  getOrRefresh: () => Promise<NovelAIAccountSnapshot>
  refresh: () => Promise<NovelAIAccountSnapshot>
  recordSubscription: (raw: unknown) => NovelAIAccountSnapshot
  notifyQuotaUsed: () => void
  handleCredentialChange: () => Promise<NovelAIAccountSnapshot>
  dispose: () => void
}

const DEFAULT_DEBOUNCE_MS = 450
const DEFAULT_STALE_MS = 5 * 60_000

export function createAccountTracker(options: AccountTrackerOptions): AccountTracker {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS
  const now = options.now ?? Date.now

  let disposed = false
  let initialized = false
  let epoch = 0
  let activeController: AbortController | null = null
  let inFlight: Promise<NovelAIAccountSnapshot> | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  let snapshot: NovelAIAccountSnapshot = {
    configured: false,
    data: null,
    fetchedAt: null,
    error: null,
    refreshing: false,
    activitySeq: 0,
  }

  function clearDebounce(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  function abortActive(): void {
    if (activeController !== null) {
      activeController.abort()
      activeController = null
    }
    inFlight = null
  }

  async function runRefresh(): Promise<NovelAIAccountSnapshot> {
    if (disposed) return snapshot
    const currentEpoch = epoch
    let configured = false
    try {
      configured = await options.isConfigured()
    } catch (error) {
      if (disposed || currentEpoch !== epoch) return snapshot
      initialized = true
      snapshot = {
        ...snapshot,
        configured: false,
        data: null,
        fetchedAt: null,
        error: error instanceof Error ? error.message : String(error),
        refreshing: false,
      }
      return snapshot
    }

    if (disposed || currentEpoch !== epoch) return snapshot
    if (!configured) {
      initialized = true
      snapshot = {
        configured: false,
        data: null,
        fetchedAt: null,
        error: null,
        refreshing: false,
        activitySeq: snapshot.activitySeq,
      }
      return snapshot
    }

    const controller = new AbortController()
    activeController = controller
    snapshot = {
      ...snapshot,
      configured: true,
      refreshing: true,
    }

    try {
      const raw = await options.fetchSubscription(controller.signal)
      if (disposed || currentEpoch !== epoch) return snapshot
      const parsed = parseAccountSubscription(raw)
      initialized = true
      snapshot = {
        configured: true,
        data: parsed,
        fetchedAt: now(),
        error: null,
        refreshing: false,
        activitySeq: snapshot.activitySeq,
      }
      return snapshot
    } catch (error) {
      if (disposed || currentEpoch !== epoch) return snapshot
      initialized = true
      snapshot = {
        ...snapshot,
        configured: true,
        error: error instanceof Error ? error.message : String(error),
        refreshing: false,
      }
      return snapshot
    } finally {
      if (activeController === controller) {
        activeController = null
      }
    }
  }

  function refresh(): Promise<NovelAIAccountSnapshot> {
    if (disposed) return Promise.resolve(snapshot)
    clearDebounce()
    if (inFlight !== null) return inFlight
    const task = runRefresh().finally(() => {
      if (inFlight === task) inFlight = null
    })
    inFlight = task
    return task
  }

  async function getOrRefresh(): Promise<NovelAIAccountSnapshot> {
    if (disposed) return snapshot
    if (inFlight !== null) return inFlight
    if (!initialized) return refresh()
    if (snapshot.configured && snapshot.data === null && !snapshot.refreshing) {
      return refresh()
    }
    if (snapshot.configured && snapshot.fetchedAt !== null && now() - snapshot.fetchedAt >= staleMs) {
      return refresh()
    }
    return snapshot
  }

  function recordSubscription(raw: unknown): NovelAIAccountSnapshot {
    const parsed = parseAccountSubscription(raw)
    initialized = true
    snapshot = {
      configured: true,
      data: parsed,
      fetchedAt: now(),
      error: null,
      refreshing: inFlight !== null,
      activitySeq: snapshot.activitySeq,
    }
    return snapshot
  }

  function notifyQuotaUsed(): void {
    if (disposed) return
    snapshot = {
      ...snapshot,
      activitySeq: snapshot.activitySeq + 1,
    }
    clearDebounce()
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void refresh()
    }, debounceMs)
    if (typeof debounceTimer.unref === 'function') debounceTimer.unref()
  }

  async function handleCredentialChange(): Promise<NovelAIAccountSnapshot> {
    if (disposed) return snapshot
    epoch += 1
    clearDebounce()
    abortActive()
    snapshot = {
      configured: false,
      data: null,
      fetchedAt: null,
      error: null,
      refreshing: false,
      activitySeq: snapshot.activitySeq + 1,
    }
    return refresh()
  }

  function dispose(): void {
    disposed = true
    epoch += 1
    clearDebounce()
    abortActive()
  }

  return {
    get: () => snapshot,
    getOrRefresh,
    refresh,
    recordSubscription,
    notifyQuotaUsed,
    handleCredentialChange,
    dispose,
  }
}
