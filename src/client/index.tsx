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
import { CREDENTIAL_REF, DEFAULT_SETTINGS, RPC_CHANNEL } from '../shared.ts'
import type { Settings } from '../shared.ts'
import { MODELS } from '../node/models.ts'

const zh = {
  title: 'NovelAI 生图', token: 'Persistent API Token', configured: '已配置', missing: '未配置',
  saveToken: '保存密钥', removeToken: '移除密钥', check: '验证连接并查询额度',
  model: '默认模型', directory: '图片输出目录', timeout: '请求超时（秒）', save: '保存设置', saved: '已保存',
  intro: 'Agent 可调用生成、编辑、参考图、Director Tools、放大和标签工具。随附 novelai-v5-prompt Skill，生成图片可直接显示在回复正文。',
  tokenHint: '从 NovelAI 账户设置获取 Persistent API Token。密钥保存到 DSH 凭据服务，不进入对话历史。',
  connected: '连接正常', balance: '可用 Anlas', subscription: '订阅', active: '生效中', inactive: '未生效', paid: '购买额度', monthly: '订阅额度',
}
const en: Record<keyof typeof zh, string> = {
  title: 'NovelAI Images', token: 'Persistent API Token', configured: 'Configured', missing: 'Not configured',
  saveToken: 'Save token', removeToken: 'Remove token', check: 'Verify connection and balance',
  model: 'Default model', directory: 'Image output directory', timeout: 'Request timeout (seconds)', save: 'Save settings', saved: 'Saved',
  intro: 'Agent tools cover generation, editing, references, Director Tools, upscaling and tags. The bundled novelai-v5-prompt skill guides prompts and inline images.',
  tokenHint: 'Get a Persistent API Token from NovelAI account settings. It is saved through DSH credentials and is not included in conversation history.',
  connected: 'Connected', balance: 'Available Anlas', subscription: 'Subscription', active: 'Active', inactive: 'Inactive', paid: 'Purchased', monthly: 'Subscription credits',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.novelai': keyof typeof zh }
}

function createFace(ctx: Context) {
  const form = ctx.configForms.get<Settings>('novelai')
  const connection = ctx.connection as unknown as ConnectionHandle
  return {
    getSnapshot: () => form.getSnapshot(),
    subscribe: (listener: () => void) => form.subscribe(listener),
    async save(settings: Settings) {
      for (const key of ['model', 'outputDirectory', 'timeoutSeconds'] as const) {
        if (!await form.set(key, settings[key])) throw new Error('设置未保存，请刷新后重试')
      }
    },
    async status() {
      const result = await ctx.remote.credentials.describe([CREDENTIAL_REF])
      if (!result.ok) throw new Error(result.error.message)
      return result.value[CREDENTIAL_REF].configured
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
  const [configured, setConfigured] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [balance, setBalance] = useState<Awaited<ReturnType<Face['account']>>>()
  useEffect(() => { if (config.value) setDraft(config.value) }, [config.value])
  useEffect(() => { void status().then(setConfigured, error => setMessage(String(error))) }, [status])
  async function run(action: () => Promise<void>, success = t('saved')) {
    setBusy(true); setMessage('')
    try { await action(); setMessage(success) }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const inputStyle = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)', width: '100%', boxSizing: 'border-box' as const }
  return <section style={{ display: 'grid', gap: 16, maxWidth: 720, color: 'var(--dsw-alias-label-primary)' }}>
    <h3 style={{ margin: 0 }}>{t('title')}</h3>
    <p style={{ margin: 0, lineHeight: 1.6 }}>{t('intro')}</p>
    <label style={{ display: 'grid', gap: 8 }}>{t('token')} · {t(configured ? 'configured' : 'missing')}
      <input type="password" autoComplete="off" value={secret} placeholder="pst-…" style={inputStyle} onChange={event => setSecret(event.target.value)} />
    </label>
    <p style={{ margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 13 }}>{t('tokenHint')}</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Button disabled={busy || !secret.trim()} onClick={() => { void run(async () => { await token(secret); setSecret(''); setConfigured(await status()) }) }}>{t('saveToken')}</Button>
      <Button disabled={busy || !configured} onClick={() => { void run(async () => { await token(undefined); setConfigured(await status()); setBalance(undefined) }) }}>{t('removeToken')}</Button>
      <Button disabled={busy || !configured} onClick={() => { void run(async () => { setBalance(await account()) }, t('connected')) }}>{t('check')}</Button>
    </div>
    <label style={{ display: 'grid', gap: 8 }}>{t('model')}<select style={inputStyle} value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })}>
      {MODELS.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
    </select></label>
    <label style={{ display: 'grid', gap: 8 }}>{t('directory')}<input style={inputStyle} value={draft.outputDirectory} onChange={event => setDraft({ ...draft, outputDirectory: event.target.value })} /></label>
    <label style={{ display: 'grid', gap: 8 }}>{t('timeout')}<input style={inputStyle} type="number" min={1} value={draft.timeoutSeconds} onChange={event => setDraft({ ...draft, timeoutSeconds: Number(event.target.value) })} /></label>
    <div><Button disabled={busy || config.status !== 'ready'} onClick={() => { void run(async () => { await save(draft) }) }}>{t('save')}</Button></div>
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
