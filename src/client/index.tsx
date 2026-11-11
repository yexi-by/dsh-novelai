import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { CREDENTIAL_REF, DEFAULT_SETTINGS, MODELS, RPC_CHANNEL } from '../shared.ts'
import type { Settings } from '../shared.ts'

const zh = {
  title: 'NovelAI 生图', token: 'Persistent API Token', configured: '已配置', configuredEnv: '已配置（环境变量）', missing: '未配置',
  saveToken: '保存密钥', removeToken: '移除密钥', removedKeepEnv: '已移除凭据库中的密钥；当前仍由环境变量提供', check: '验证连接并查询额度',
  model: '默认模型', directory: '图片输出目录', timeout: '请求超时（秒）', save: '保存设置', saved: '已保存',
  intro: 'Agent 可调用生成、编辑、参考图、Director Tools、2 倍放大和标签工具。随附 novelai-v5-prompt Skill，生成图片可直接显示在回复正文。',
  tokenHint: '从 NovelAI 账户设置获取 Persistent API Token。密钥保存到 DSH 凭据服务，不进入对话历史。',
  connected: '连接正常', balance: '可用 Anlas', subscription: '订阅', active: '生效中', inactive: '未生效', paid: '购买额度', monthly: '订阅额度',
}
const en: Record<keyof typeof zh, string> = {
  title: 'NovelAI Images', token: 'Persistent API Token', configured: 'Configured', configuredEnv: 'Configured (environment)', missing: 'Not configured',
  saveToken: 'Save token', removeToken: 'Remove token', removedKeepEnv: 'Removed stored token; environment variable is still active', check: 'Verify connection and balance',
  model: 'Default model', directory: 'Image output directory', timeout: 'Request timeout (seconds)', save: 'Save settings', saved: 'Saved',
  intro: 'Agent tools cover generation, editing, references, Director Tools, 2x upscaling and tags. The bundled novelai-v5-prompt skill guides prompts and inline images.',
  tokenHint: 'Get a Persistent API Token from NovelAI account settings. It is saved through DSH credentials and is not included in conversation history.',
  connected: 'Connected', balance: 'Available Anlas', subscription: 'Subscription', active: 'Active', inactive: 'Inactive', paid: 'Purchased', monthly: 'Subscription credits',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.novelai': keyof typeof zh }
}

interface CredentialStatus {
  configured: boolean
  source?: string
  writable: boolean
}

function createFace(ctx: Context) {
  const form = ctx.configForms.get<Settings>('novelai')
  const connection = ctx.connection as unknown as ConnectionHandle
  return {
    getSnapshot: () => form.getSnapshot(),
    subscribe: (listener: () => void) => form.subscribe(listener),
    async save(settings: Settings): Promise<Settings> {
      const outputDirectory = settings.outputDirectory.trim()
      if (!outputDirectory) throw new Error('图片输出目录不能为空')
      if (!MODELS.some(model => model.id === settings.model)) throw new Error(`不支持的默认模型：${settings.model}`)
      if (!Number.isFinite(settings.timeoutSeconds) || settings.timeoutSeconds < 1) throw new Error('请求超时必须为不小于 1 的数字')
      const normalized: Settings = {
        model: settings.model,
        outputDirectory,
        timeoutSeconds: Math.round(settings.timeoutSeconds),
      }
      for (const key of ['model', 'outputDirectory', 'timeoutSeconds'] as const) {
        if (!await form.set(key, normalized[key])) throw new Error('设置未保存，请刷新后重试')
      }
      return normalized
    },
    async status(): Promise<CredentialStatus> {
      const result = await ctx.remote.credentials.describe([CREDENTIAL_REF])
      if (!result.ok) throw new Error(result.error.message)
      return result.value[CREDENTIAL_REF]
    },
    async token(value: string | undefined) {
      if (value !== undefined && !/^pst-\S+$/u.test(value.trim())) throw new Error('请输入有效的 NovelAI Persistent API Token（pst-…）')
      const result = value === undefined ? await ctx.remote.credentials.unset(CREDENTIAL_REF) : await ctx.remote.credentials.set(CREDENTIAL_REF, value.trim())
      if (!result.ok) throw new Error(result.error.message)
    },
    async account() {
      const result = await connection.rpc.call(RPC_CHANNEL, 'account', {}, AbortSignal.timeout(15_000))
      if (!result.ok) throw new Error(result.error.message)
      const value = result.value
      if (!value || typeof value !== 'object' || !('active' in value) || typeof value.active !== 'boolean' || !('trainingStepsLeft' in value)
        || !value.trainingStepsLeft || typeof value.trainingStepsLeft !== 'object'
        || !('fixedTrainingStepsLeft' in value.trainingStepsLeft) || typeof value.trainingStepsLeft.fixedTrainingStepsLeft !== 'number'
        || !('purchasedTrainingSteps' in value.trainingStepsLeft) || typeof value.trainingStepsLeft.purchasedTrainingSteps !== 'number') throw new Error('NovelAI 账户响应格式不正确')
      return { active: value.active, monthly: value.trainingStepsLeft.fixedTrainingStepsLeft, paid: value.trainingStepsLeft.purchasedTrainingSteps }
    },
  }
}
type Face = ReturnType<typeof createFace>
type Props = PropsRuntime<'plugins.bundle.config'> & PropsLocale<'settings.novelai'> & InjectFace<Face>

function NovelAICard({ t, getSnapshot, subscribe, status, token, account, save }: Props) {
  const config = useSyncExternalStore(subscribe, getSnapshot)
  const [draft, setDraft] = useState<Settings>(DEFAULT_SETTINGS)
  const [secret, setSecret] = useState('')
  const [credential, setCredential] = useState<CredentialStatus>({ configured: false, writable: true })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [balance, setBalance] = useState<Awaited<ReturnType<Face['account']>>>()
  useEffect(() => { if (config.value) setDraft(config.value) }, [config.value])
  useEffect(() => { void status().then(setCredential, error => setMessage(String(error))) }, [status])
  async function run(action: () => Promise<string | void>, fallback = t('saved')) {
    setBusy(true); setMessage('')
    try {
      const custom = await action()
      setMessage(custom ?? fallback)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const statusKey = !credential.configured ? 'missing' : (credential.source && credential.source !== 'file' ? 'configuredEnv' : 'configured')
  const inputStyle = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)', width: '100%', boxSizing: 'border-box' as const }
  return <section style={{ display: 'grid', gap: 16, maxWidth: 720, color: 'var(--dsw-alias-label-primary)' }}>
    <h3 style={{ margin: 0 }}>{t('title')}</h3>
    <p style={{ margin: 0, lineHeight: 1.6 }}>{t('intro')}</p>
    <label style={{ display: 'grid', gap: 8 }}>{t('token')} · {t(statusKey)}
      <input type="password" autoComplete="off" value={secret} placeholder="pst-…" style={inputStyle} onChange={event => setSecret(event.target.value)} />
    </label>
    <p style={{ margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 13 }}>{t('tokenHint')}</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Button disabled={busy || !credential.writable || !secret.trim()} onClick={() => { void run(async () => { await token(secret); setSecret(''); setCredential(await status()) }) }}>{t('saveToken')}</Button>
      <Button disabled={busy || !credential.writable || !credential.configured} onClick={() => { void run(async () => {
        await token(undefined)
        const next = await status()
        setCredential(next)
        if (!next.configured) setBalance(undefined)
        if (next.configured && next.source && next.source !== 'file') return t('removedKeepEnv')
      }) }}>{t('removeToken')}</Button>
      <Button disabled={busy || !credential.configured} onClick={() => { void run(async () => { setBalance(await account()) }, t('connected')) }}>{t('check')}</Button>
    </div>
    <label style={{ display: 'grid', gap: 8 }}>{t('model')}<select style={inputStyle} value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })}>
      {MODELS.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
    </select></label>
    <label style={{ display: 'grid', gap: 8 }}>{t('directory')}<input style={inputStyle} value={draft.outputDirectory} onChange={event => setDraft({ ...draft, outputDirectory: event.target.value })} /></label>
    <label style={{ display: 'grid', gap: 8 }}>{t('timeout')}<input style={inputStyle} type="number" min={1} value={draft.timeoutSeconds} onChange={event => setDraft({ ...draft, timeoutSeconds: Number(event.target.value) })} /></label>
    <div><Button disabled={busy || config.status !== 'ready'} onClick={() => { void run(async () => { setDraft(await save(draft)) }) }}>{t('save')}</Button></div>
    {message && <p role="status" style={{ margin: 0, overflowWrap: 'anywhere' }}>{message}</p>}
    {balance !== undefined && <div style={{ padding: 16, borderRadius: 12, background: 'var(--dsw-alias-bg-layer-3)', display: 'grid', gap: 8 }}>
      <strong>{t('balance')}：{balance.monthly + balance.paid}</strong>
      <span>{t('monthly')}：{balance.monthly} · {t('paid')}：{balance.paid}</span>
      <span>{t('subscription')}：{t(balance.active ? 'active' : 'inactive')}</span>
    </div>}
  </section>
}

export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.credentials', 'configForms']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('settings.novelai', { zh, en }))
  const face = createFace(ctx)
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: 'dsh-novelai', locale: 'settings.novelai', inject: () => face }, NovelAICard))
}
