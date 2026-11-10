import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import { CREDENTIAL_REF, DEFAULT_SETTINGS, RPC_CHANNEL } from '../shared.ts'
import type { Settings } from '../shared.ts'
import { NovelAIClient } from './api.ts'
import { registerSkill } from './skill.ts'
import { registerTools } from './tools.ts'
import { MODELS } from './models.ts'

export const name = 'novelai'
export const inject = ['tools', 'skills', 'credentials', 'fs', 'workingDirectory', 'settings']
export const Config = z.object({
  model: z.string().default(DEFAULT_SETTINGS.model),
  outputDirectory: z.string().default(DEFAULT_SETTINGS.outputDirectory),
  timeoutSeconds: z.number().min(1).default(DEFAULT_SETTINGS.timeoutSeconds),
}).volatile()

export function apply(ctx: Context, config: Volatile<Settings>): void {
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber))
  const client = new NovelAIClient(async () => {
    const credential = await ctx.credentials.resolve(credentialRef(CREDENTIAL_REF))
    if (!credential) throw new Error('尚未配置 NovelAI API Token，请在插件设置中保存')
    return credential.value
  }, () => config.get().timeoutSeconds)
  registerTools(ctx, client, () => config.get())
  registerSkill(ctx)
  ctx.inject(['connection'], child => {
    const dispose = child.connection.rpc.handle(RPC_CHANNEL, async (endpoint, _payload, signal) => {
      try {
        if (endpoint === 'status') return { ok: true, value: { credential: await ctx.credentials.describe(credentialRef(CREDENTIAL_REF)), models: MODELS } }
        if (endpoint === 'account') return { ok: true, value: await client.json('/user/subscription', undefined, signal) }
        return { ok: false, error: { code: 'invalidRequest', message: '未知 NovelAI 配置操作', details: {} } }
      } catch (error) {
        return { ok: false, error: { code: 'novelai', message: error instanceof Error ? error.message : String(error), details: {} } }
      }
    })
    return async () => { await dispose() }
  })
}
