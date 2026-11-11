import { memo, useEffect, useReducer, useRef } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { hasOpusUsageBar, remainingRegenSeconds, subscriptionTierKind, usageTone } from '../shared.ts'
import type { AccountView, QuotaInjectedFace } from './controller.ts'
import {
  formatNumber,
  formatPercent,
  formatRelativeUpdate,
  formatUsageNote,
  isHeroConversationPhase,
  selectNovelAISessionSignal,
  tierLabelOf,
} from './helpers.ts'
import type { Translate } from './helpers.ts'
import type { NS } from './locales.ts'

function SparkleGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.25L9.55 5.65L14 7.2L9.55 8.75L8 13.15L6.45 8.75L2 7.2L6.45 5.65L8 1.25Z"
        fill="currentColor"
      />
      <path
        d="M12.9 10.6L13.5 12.2L15.1 12.8L13.5 13.4L12.9 15L12.3 13.4L10.7 12.8L12.3 12.2L12.9 10.6Z"
        fill="currentColor"
        opacity="0.75"
      />
    </svg>
  )
}

function RefreshGlyph({ spinning }: { readonly spinning: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={spinning ? 'nai-spin' : undefined}
    >
      <path
        d="M13.2 8A5.2 5.2 0 1 1 11.78 4.42M13.4 2.5V5.3H10.6"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function buildTooltipSummary(view: AccountView, now: number, t: Translate): string {
  const parts: string[] = []
  if (view.data !== null) {
    parts.push(`${t('brand')} · ${tierLabelOf(view.data, t)}`)
    if (hasOpusUsageBar(view.data)) {
      const note = formatUsageNote(view.data.usage, view.fetchedAt, now, t)
      parts.push(`${t('hpLabel')} ${formatPercent(view.data.usage.percent)}${note ? ` (${note})` : ''}`)
    }
    parts.push(`${t('anlasBreakdown', {
      monthly: formatNumber(view.data.anlas.monthly),
      paid: formatNumber(view.data.anlas.paid),
    })}`)
  }
  const updated = formatRelativeUpdate(view.fetchedAt, now, t)
  if (updated) parts.push(updated)
  if (view.error) parts.push(view.error)
  return parts.join(' · ')
}

function useClockAndCountdownRefresh(view: AccountView, refresh: () => Promise<AccountView>): number {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const timer = setInterval(tick, 30_000)
    return () => clearInterval(timer)
  }, [])

  const now = Date.now()
  const refreshedForStampRef = useRef<number | null>(null)
  useEffect(() => {
    if (view.data === null || !hasOpusUsageBar(view.data) || view.fetchedAt === null || view.refreshing) return
    const remaining = remainingRegenSeconds(view.data.usage, view.fetchedAt, now)
    if (remaining === 0 && view.data.usage.timeUntilNextPercent > 0 && refreshedForStampRef.current !== view.fetchedAt) {
      refreshedForStampRef.current = view.fetchedAt
      void refresh()
    }
  }, [now, refresh, view.data, view.fetchedAt, view.refreshing])

  return now
}

export type HomeBarProps =
  PropsRuntime<'conversation.input.dock'>
  & InjectFace<QuotaInjectedFace>
  & PropsLocale<typeof NS>

/**
 * 挂载在 DSH 首页（Hero 空白会话态）输入框正下方的 NovelAI V5 血条与 Anlas 剩余点数横条。
 */
export const NovelAIHomeBar = memo(function NovelAIHomeBar({
  session,
  sessionId,
  useConversation,
  useSessions,
  useAccount,
  get,
  refresh,
  t,
}: HomeBarProps) {
  const conversation = useConversation(s => s)
  const summaryBlank = useSessions(s => s.byId[sessionId]?.blank)
  const hero = isHeroConversationPhase(session, conversation, summaryBlank)
  const view = useAccount(s => s)
  const now = useClockAndCountdownRefresh(view, refresh)

  useEffect(() => {
    if (!hero) return
    void get()
  }, [hero, get])

  if (!hero) return null
  if (view.status === 'idle' || view.status === 'unavailable') return null

  if (view.status === 'unconfigured') {
    return (
      <div className="nai-home-wrap" data-novelai-home="unconfigured">
        <div className="nai-home-bar" data-compact="true">
          <span className="nai-brand">
            <SparkleGlyph />
            <span>{t('brand')}</span>
          </span>
          <span className="nai-sep" aria-hidden="true">·</span>
          <span className="nai-label-muted">{t('unconfiguredHint')}</span>
        </div>
      </div>
    )
  }

  if (view.data === null) {
    return (
      <div className="nai-home-wrap" data-novelai-home="error">
        <div className="nai-home-bar" data-compact="true">
          <span className="nai-brand">
            <SparkleGlyph />
            <span>{t('brand')}</span>
          </span>
          <span className="nai-sep" aria-hidden="true">·</span>
          <span className="nai-label-muted" title={view.error ?? undefined}>{t('queryError')}</span>
          <button
            type="button"
            className="nai-retry-btn"
            disabled={view.refreshing}
            onClick={() => { void refresh() }}
          >
            {t(view.refreshing ? 'refreshing' : 'retry')}
          </button>
        </div>
      </div>
    )
  }

  const { data } = view
  const tierKind = subscriptionTierKind(data)
  const opus = hasOpusUsageBar(data)
  const tone = opus ? usageTone(data.usage) : 'healthy'
  const usageNote = opus ? formatUsageNote(data.usage, view.fetchedAt, now, t) : ''
  const tooltipSummary = buildTooltipSummary(view, now, t)

  return (
    <div className="nai-home-wrap" data-novelai-home="ready">
      <div className="nai-home-bar" role="region" aria-label={t('title')}>
        <div className="nai-cluster">
          <span className="nai-brand">
            <SparkleGlyph />
            <span>{t('brand')}</span>
          </span>
          <span className="nai-tier-badge" data-tier={tierKind}>
            {tierLabelOf(data, t)}
          </span>
          <span className="nai-sep" aria-hidden="true">·</span>
          {opus ? (
            <div className="nai-hp-group">
              <span className="nai-label-muted">{t('hpLabel')}</span>
              <span
                className="nai-hp-track"
                role="progressbar"
                aria-label={t('hpLabel')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(data.usage.percent)}
              >
                <span
                  className="nai-hp-fill"
                  data-tone={tone}
                  style={{ width: `${Math.max(0, Math.min(100, data.usage.percent))}%` }}
                />
              </span>
              <span className="nai-hp-value" data-tone={tone}>
                {formatPercent(data.usage.percent)}
              </span>
              {data.usage.purchasedPercent > 0 && (
                <span className="nai-boost-pill">
                  {t('hpBoost', { percent: formatNumber(data.usage.purchasedPercent) })}
                </span>
              )}
              {usageNote && <span className="nai-subnote">{usageNote}</span>}
            </div>
          ) : (
            <span className="nai-subnote">{t('hpNonOpus')}</span>
          )}
        </div>

        <div className="nai-cluster">
          <span className="nai-label-muted">{t('balance')}</span>
          <span className="nai-anlas-strong">
            {formatNumber(data.anlas.total)} {t('anlasUnit')}
          </span>
          <span className="nai-subnote nai-hide-narrow">
            ({t('anlasBreakdown', {
              monthly: formatNumber(data.anlas.monthly),
              paid: formatNumber(data.anlas.paid),
            })})
          </span>
          <Tooltip label={tooltipSummary || t('refresh')} side="top" delayMs={200} portal>
            <button
              type="button"
              className="nai-icon-btn"
              aria-label={t(view.refreshing ? 'refreshing' : 'refresh')}
              disabled={view.refreshing}
              onClick={() => { void refresh() }}
            >
              <RefreshGlyph spinning={view.refreshing} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
})

export type ComposerDockProps =
  PropsRuntime<'conversation.composer.dock'>
  & InjectFace<QuotaInjectedFace>
  & PropsLocale<typeof NS>

/**
 * 挂载在活跃会话输入框下方 `conversation.composer.dock` 的紧凑状态胶囊；
 * 仅在当前会话调用过 `novelai_*` 工具时显示，并在每次生图完成后自动刷新额度。
 */
export const NovelAIComposerDock = memo(function NovelAIComposerDock({
  useChat,
  useAccount,
  get,
  refresh,
  t,
}: ComposerDockProps) {
  const signal = useChat(selectNovelAISessionSignal)
  const view = useAccount(s => s)
  const now = useClockAndCountdownRefresh(view, refresh)

  useEffect(() => {
    if (signal === 0) return
    void get()
    if (signal > 0) {
      const followUp = setTimeout(() => { void get() }, 900)
      return () => clearTimeout(followUp)
    }
    return undefined
  }, [signal, get])

  if (signal === 0) return null
  if (view.status === 'unavailable' || view.status === 'unconfigured') return null
  if (view.data === null) {
    if (view.status !== 'error') return null
    return (
      <div className="nai-dock" data-novelai-dock="error">
        <span>{t('brand')} · {t('queryError')}</span>
        <button
          type="button"
          className="nai-retry-btn"
          disabled={view.refreshing}
          onClick={() => { void refresh() }}
        >
          {t('retry')}
        </button>
      </div>
    )
  }

  const { data } = view
  const opus = hasOpusUsageBar(data)
  const tone = opus ? usageTone(data.usage) : 'healthy'
  const toolRunning = signal < 0
  const tooltipSummary = buildTooltipSummary(view, now, t)

  return (
    <div className="nai-dock" data-novelai-dock="ready">
      <span className="nai-brand" style={{ fontWeight: 500, color: 'var(--dsw-alias-label-secondary)' }}>
        <SparkleGlyph />
        <span>{t('brand')}</span>
      </span>
      {opus && (
        <>
          <span className="nai-hp-track nai-dock-hp" aria-hidden="true">
            <span
              className="nai-hp-fill"
              data-tone={tone}
              style={{ width: `${Math.max(0, Math.min(100, data.usage.percent))}%` }}
            />
          </span>
          <span className="nai-hp-value" data-tone={tone} style={{ fontWeight: 500 }}>
            {formatPercent(data.usage.percent)}
          </span>
        </>
      )}
      <span className="nai-sep" aria-hidden="true">·</span>
      <span>{formatNumber(data.anlas.total)} {t('anlasUnit')}</span>
      <Tooltip label={tooltipSummary || t('refresh')} side="top" delayMs={200} portal>
        <button
          type="button"
          className="nai-icon-btn"
          style={{ width: 18, height: 18 }}
          aria-label={t(view.refreshing ? 'refreshing' : 'refresh')}
          disabled={view.refreshing}
          onClick={() => { void refresh() }}
        >
          <RefreshGlyph spinning={view.refreshing || toolRunning} />
        </button>
      </Tooltip>
    </div>
  )
})

/**
 * 插件配置卡片内嵌的完整 V5 血条与 Anlas 账户面板。
 */
export function AccountQuotaPanel({
  view,
  onRefresh,
  t,
}: {
  readonly view: AccountView
  readonly onRefresh: () => void
  readonly t: Translate
}) {
  const now = useClockAndCountdownRefresh(view, async () => {
    onRefresh()
    return view
  })
  if (view.data === null) return null

  const { data } = view
  const tierKind = subscriptionTierKind(data)
  const opus = hasOpusUsageBar(data)
  const tone = opus ? usageTone(data.usage) : 'healthy'
  const usageNote = opus ? formatUsageNote(data.usage, view.fetchedAt, now, t) : ''
  const updated = formatRelativeUpdate(view.fetchedAt, now, t)
  const expiresText = data.expiresAt !== null
    ? new Date(data.expiresAt * 1000).toLocaleDateString()
    : '—'

  return (
    <div className="nai-quota-panel" data-novelai-settings-quota="">
      <div className="nai-quota-header">
        <div className="nai-cluster">
          <span className="nai-brand">
            <SparkleGlyph />
            <span>{t('brand')}</span>
          </span>
          <span className="nai-tier-badge" data-tier={tierKind}>
            {tierLabelOf(data, t)}
          </span>
          {updated && <span className="nai-subnote">{updated}</span>}
        </div>
        <button
          type="button"
          className="nai-retry-btn"
          disabled={view.refreshing}
          onClick={onRefresh}
        >
          {t(view.refreshing ? 'refreshing' : 'refresh')}
        </button>
      </div>

      {opus && (
        <div className="nai-quota-hp-box">
          <div className="nai-quota-hp-top">
            <span className="nai-cluster">
              <strong>{t('hpLabel')}</strong>
              {data.usage.purchasedPercent > 0 && (
                <span className="nai-boost-pill">
                  {t('hpBoost', { percent: formatNumber(data.usage.purchasedPercent) })}
                </span>
              )}
            </span>
            <span className="nai-cluster">
              <span className="nai-hp-value" data-tone={tone}>
                {formatPercent(data.usage.percent)}
              </span>
              {usageNote && <span className="nai-subnote">({usageNote})</span>}
            </span>
          </div>
          <div
            className="nai-hp-track nai-quota-hp-bar"
            role="progressbar"
            aria-label={t('hpLabel')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(data.usage.percent)}
          >
            <div
              className="nai-hp-fill"
              data-tone={tone}
              style={{ width: `${Math.max(0, Math.min(100, data.usage.percent))}%` }}
            />
          </div>
        </div>
      )}

      <dl className="nai-quota-grid">
        <div className="nai-quota-item">
          <dt>{t('totalAnlas')}</dt>
          <dd>{formatNumber(data.anlas.total)} {t('anlasUnit')}</dd>
        </div>
        <div className="nai-quota-item">
          <dt>{t('monthly')}</dt>
          <dd>{formatNumber(data.anlas.monthly)}</dd>
        </div>
        <div className="nai-quota-item">
          <dt>{t('paid')}</dt>
          <dd>{formatNumber(data.anlas.paid)}</dd>
        </div>
        <div className="nai-quota-item">
          <dt>{t('subscription')} / {t('expiresAt')}</dt>
          <dd>{t(data.active ? 'active' : 'inactive')} · {expiresText}</dd>
        </div>
      </dl>
    </div>
  )
}
