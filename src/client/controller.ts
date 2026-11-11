import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { RPC_CHANNEL } from '../shared.ts'
import type { NovelAIAccountData, NovelAIAccountSnapshot } from '../shared.ts'

export interface AccountView {
  status: 'idle' | 'ready' | 'unconfigured' | 'error' | 'unavailable'
  configured: boolean
  data: NovelAIAccountData | null
  fetchedAt: number | null
  error: string | null
  refreshing: boolean
  activitySeq: number
}

export interface AccountSource {
  getSnapshot(): AccountView
  subscribe(listener: () => void): () => void
}

export interface QuotaInjectedFace {
  hooks: {
    account: AccountSource
  }
  get: () => Promise<AccountView>
  refresh: () => Promise<AccountView>
}

type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAccountSnapshot(value: unknown): value is NovelAIAccountSnapshot {
  if (!isRecord(value)) return false
  return typeof value.configured === 'boolean'
    && (value.data === null || isRecord(value.data))
    && (value.fetchedAt === null || typeof value.fetchedAt === 'number')
    && (value.error === null || typeof value.error === 'string')
    && typeof value.refreshing === 'boolean'
    && typeof value.activitySeq === 'number'
}

export function deriveAccountStatus(snap: NovelAIAccountSnapshot): AccountView['status'] {
  if (!snap.configured) return 'unconfigured'
  if (snap.data !== null) return 'ready'
  if (snap.error !== null) return 'error'
  return 'idle'
}

export function createAccountController(ctx: Context) {
  const connection = ctx.connection as unknown as ConnectionHandle
  let view: AccountView = {
    status: 'idle',
    configured: false,
    data: null,
    fetchedAt: null,
    error: null,
    refreshing: false,
    activitySeq: 0,
  }
  const listeners = new Set<() => void>()
  let pendingGet: Promise<AccountView> | null = null
  let pendingRefresh: Promise<AccountView> | null = null

  const account: AccountSource = {
    getSnapshot: () => view,
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }

  function publish(next: AccountView): AccountView {
    view = next
    for (const listener of listeners) listener()
    return view
  }

  async function request(endpoint: 'get' | 'refresh'): Promise<AccountView> {
    if (endpoint === 'refresh') {
      publish({ ...view, refreshing: true, error: null })
    }
    let result: RpcResult<unknown>
    try {
      result = await connection.rpc.call(
        RPC_CHANNEL,
        endpoint,
        {},
        AbortSignal.timeout(15_000),
      ) as RpcResult<unknown>
    } catch {
      return publish({
        ...view,
        status: view.data !== null ? 'ready' : 'unavailable',
        refreshing: false,
      })
    }

    if (!result.ok) {
      return publish({
        ...view,
        status: view.data !== null ? 'ready' : 'error',
        error: result.error.message,
        refreshing: false,
      })
    }

    if (!isAccountSnapshot(result.value)) {
      return publish({
        ...view,
        status: view.data !== null ? 'ready' : 'error',
        error: 'NovelAI 额度状态响应格式异常',
        refreshing: false,
      })
    }

    const snap = result.value
    return publish({
      status: deriveAccountStatus(snap),
      configured: snap.configured,
      data: snap.data,
      fetchedAt: snap.fetchedAt,
      error: snap.error,
      refreshing: snap.refreshing,
      activitySeq: snap.activitySeq,
    })
  }

  function get(): Promise<AccountView> {
    if (pendingRefresh !== null) return pendingRefresh
    if (pendingGet !== null) return pendingGet
    const task = request('get').finally(() => {
      if (pendingGet === task) pendingGet = null
    })
    pendingGet = task
    return task
  }

  function refresh(): Promise<AccountView> {
    if (pendingRefresh !== null) return pendingRefresh
    const task = request('refresh').finally(() => {
      if (pendingRefresh === task) pendingRefresh = null
    })
    pendingRefresh = task
    return task
  }

  return {
    account,
    get,
    refresh,
    quotaFace: (): QuotaInjectedFace => ({
      hooks: { account },
      get,
      refresh,
    }),
  }
}

export type AccountController = ReturnType<typeof createAccountController>
