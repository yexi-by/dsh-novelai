import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import { CREDENTIAL_REF, DEFAULT_SETTINGS, RPC_CHANNEL } from '../shared.ts'
import type { Settings } from '../shared.ts'
import { createAccountTracker } from './account.ts'
import { NovelAIClient } from './api.ts'
import { registerSkill } from './skill.ts'
import { registerTools } from './tools.ts'

export const name = 'novelai'
export const inject = ['tools', 'skills', 'credentials', 'fs', 'workingDirectory', 'settings']
export const Config = z.object({
  model: z.string().min(1).default(DEFAULT_SETTINGS.model),
  outputDirectory: z.string().min(1).default(DEFAULT_SETTINGS.outputDirectory),
  timeoutSeconds: z.number().min(1).default(DEFAULT_SETTINGS.timeoutSeconds),
}).volatile()

export function apply(ctx: Context, config: Volatile<Settings>): void {
  const ref = credentialRef(CREDENTIAL_REF)
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber))

  const client = new NovelAIClient(async () => {
    const credential = await ctx.credentials.resolve(ref)
    if (!credential) throw new Error('尚未配置 NovelAI API Token，请在插件设置中保存')
    return credential.value
  }, () => config.get().timeoutSeconds)

  const tracker = createAccountTracker({
    isConfigured: async () => (await ctx.credentials.describe(ref)).configured,
    fetchSubscription: signal => client.json('/user/subscription', undefined, signal),
  })

  ctx.effect(() => {
    const disposeCredentialWatch = (ctx as unknown as {
      on: (event: string, listener: (subject: unknown) => void) => () => void
    }).on('credentials/reference-updated', subject => {
      if (subject === ref) void tracker.handleCredentialChange()
    })
    void tracker.refresh()
    return () => {
      disposeCredentialWatch()
      tracker.dispose()
    }
  }, 'novelai: account tracker')

  registerTools(ctx, client, () => config.get(), {
    onQuotaUsed: () => tracker.notifyQuotaUsed(),
    onAccountData: raw => { tracker.recordSubscription(raw) },
  })
  registerSkill(ctx)

  ctx.inject(['connection'], child => {
    const dispose = child.connection.rpc.handle(RPC_CHANNEL, async (endpoint, _payload, signal) => {
      try {
        if (endpoint === 'get') {
          return { ok: true, value: await tracker.getOrRefresh() }
        }
        if (endpoint === 'refresh') {
          return { ok: true, value: await tracker.refresh() }
        }
        if (endpoint === 'account') {
          const raw = await client.json('/user/subscription', undefined, signal)
          try { tracker.recordSubscription(raw) } catch { /* 忽略非致命同步失败 */ }
          return { ok: true, value: raw }
        }
        return { ok: false, error: { code: 'invalidRequest', message: '未知 NovelAI 配置操作', details: {} } }
      } catch (error) {
        return { ok: false, error: { code: 'novelai', message: error instanceof Error ? error.message : String(error), details: {} } }
      }
    })
    return async () => { await dispose() }
  })
}
