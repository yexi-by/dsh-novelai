import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { CREDENTIAL_REF, DEFAULT_SETTINGS, MODELS } from '../shared.ts'
import type { Settings } from '../shared.ts'
import { createAccountController } from './controller.ts'
import type { AccountController, AccountSource, AccountView } from './controller.ts'
import { en, NS, zh } from './locales.ts'
import type { NovelAILocaleKey } from './locales.ts'
import { AccountQuotaPanel, NovelAIComposerDock, NovelAIHomeBar } from './QuotaBar.tsx'
import { ensureStyles } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.novelai': NovelAILocaleKey
  }
}

interface CredentialStatus {
  configured: boolean
  source?: string
  writable: boolean
}

function createSettingsFace(ctx: Context, controller: AccountController) {
  const form = ctx.configForms.get<Settings>('novelai')
  return {
    hooks: {
      account: controller.account as AccountSource,
    },
    getSnapshot: () => form.getSnapshot(),
    subscribe: (listener: () => void) => form.subscribe(listener),
    getAccount: () => controller.get(),
    refreshAccount: async (): Promise<AccountView> => {
      const next = await controller.refresh()
      if (next.status === 'error' && next.error) throw new Error(next.error)
      if (next.status === 'unavailable') throw new Error('无法连接本机 NovelAI 插件服务')
      return next
    },
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
      if (value !== undefined && !/^pst-\S+$/u.test(value.trim())) {
        throw new Error('请输入有效的 NovelAI Persistent API Token（pst-…）')
      }
      const result = value === undefined
        ? await ctx.remote.credentials.unset(CREDENTIAL_REF)
        : await ctx.remote.credentials.set(CREDENTIAL_REF, value.trim())
      if (!result.ok) throw new Error(result.error.message)
      await controller.refresh()
    },
  }
}

type SettingsFace = ReturnType<typeof createSettingsFace>
type Props = PropsRuntime<'plugins.bundle.config'> & PropsLocale<typeof NS> & InjectFace<SettingsFace>

function NovelAICard({
  t,
  useAccount,
  getSnapshot,
  subscribe,
  status,
  token,
  getAccount,
  refreshAccount,
  save,
}: Props) {
  const config = useSyncExternalStore(subscribe, getSnapshot)
  const accountView = useAccount(s => s)
  const [draft, setDraft] = useState<Settings>(DEFAULT_SETTINGS)
  const [secret, setSecret] = useState('')
  const [credential, setCredential] = useState<CredentialStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => { if (config.value) setDraft(config.value) }, [config.value])
  useEffect(() => {
    let active = true
    void status().then(next => {
      if (!active) return
      setCredential(next)
      if (next.configured) void getAccount()
    }, error => {
      if (active) setMessage(String(error))
    })
    return () => { active = false }
  }, [status, getAccount])

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

  const configured = credential !== null ? credential.configured : accountView.status === 'ready'
  const writable = credential?.writable ?? true
  const statusKey = !configured ? 'missing' : (credential?.source && credential.source !== 'file' ? 'configuredEnv' : 'configured')
  const inputStyle = {
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-3)',
    color: 'var(--dsw-alias-label-primary)',
    width: '100%',
    boxSizing: 'border-box' as const,
  }

  return (
    <section style={{ display: 'grid', gap: 16, maxWidth: 720, color: 'var(--dsw-alias-label-primary)' }}>
      <h3 style={{ margin: 0 }}>{t('title')}</h3>
      <p style={{ margin: 0, lineHeight: 1.6 }}>{t('intro')}</p>

      <AccountQuotaPanel
        view={accountView}
        onRefresh={() => { void run(async () => { await refreshAccount() }, t('connected')) }}
        t={t}
      />

      <label style={{ display: 'grid', gap: 8 }}>{t('token')} · {t(statusKey)}
        <input
          type="password"
          autoComplete="off"
          value={secret}
          placeholder="pst-…"
          style={inputStyle}
          onChange={event => setSecret(event.target.value)}
        />
      </label>
      <p style={{ margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 13 }}>{t('tokenHint')}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          disabled={busy || !writable || !secret.trim()}
          onClick={() => {
            void run(async () => {
              await token(secret)
              setSecret('')
              setCredential(await status())
            })
          }}
        >
          {t('saveToken')}
        </Button>
        <Button
          disabled={busy || !writable || !configured}
          onClick={() => {
            void run(async () => {
              await token(undefined)
              const next = await status()
              setCredential(next)
              if (next.configured && next.source && next.source !== 'file') return t('removedKeepEnv')
            })
          }}
        >
          {t('removeToken')}
        </Button>
        <Button
          disabled={busy || !configured}
          onClick={() => { void run(async () => { await refreshAccount() }, t('connected')) }}
        >
          {t('check')}
        </Button>
      </div>
      <label style={{ display: 'grid', gap: 8 }}>{t('model')}
        <select style={inputStyle} value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })}>
          {MODELS.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
        </select>
      </label>
      <label style={{ display: 'grid', gap: 8 }}>{t('directory')}
        <input style={inputStyle} value={draft.outputDirectory} onChange={event => setDraft({ ...draft, outputDirectory: event.target.value })} />
      </label>
      <label style={{ display: 'grid', gap: 8 }}>{t('timeout')}
        <input style={inputStyle} type="number" min={1} value={draft.timeoutSeconds} onChange={event => setDraft({ ...draft, timeoutSeconds: Number(event.target.value) })} />
      </label>
      <div>
        <Button disabled={busy || config.status !== 'ready'} onClick={() => { void run(async () => { setDraft(await save(draft)) }) }}>
          {t('save')}
        </Button>
      </div>
      {message && <p role="status" style={{ margin: 0, overflowWrap: 'anywhere' }}>{message}</p>}
    </section>
  )
}

export const inject = ['slots', 'locale', 'connection']

export function apply(ctx: Context): void {
  ctx.effect(() => ensureStyles(), 'novelai: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'novelai: locale')

  const controller = createAccountController(ctx)
  const quotaFace = controller.quotaFace()

  ctx.effect(() => {
    const disposeReset = (ctx as unknown as {
      on: (event: string, listener: () => void) => () => void
    }).on('connection/reset', () => {
      void controller.get()
    })
    return () => { disposeReset() }
  }, 'novelai: connection reset')

  // DSH 首页（Hero 空白会话态）输入框下方的血条与剩余点数状态栏
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'novelai-home-quota',
    order: 90,
    locale: NS,
    inject: () => quotaFace,
  }, NovelAIHomeBar))

  // 活跃会话生图期间的底部紧凑血条与点数胶囊
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'novelai-quota',
    order: 20,
    locale: NS,
    inject: () => quotaFace,
  }, NovelAIComposerDock))

  // 插件详情页配置面板（仅在设置相关服务挂载时激活，不影响纯首页运行）
  ctx.inject(['remote', 'remote.credentials', 'configForms'], settingsCtx => {
    const settingsFace = createSettingsFace(settingsCtx, controller)
    settingsCtx.slots.inject('plugins.bundle.config', () => settingsCtx.slots.register({
      name: 'plugins.bundle.config',
      key: 'dsh-novelai',
      locale: NS,
      inject: () => settingsFace,
    }, NovelAICard))
  })
}
