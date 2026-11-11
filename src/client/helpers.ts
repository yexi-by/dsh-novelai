import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { remainingRegenSeconds, subscriptionTierKind } from '../shared.ts'
import type { NovelAIAccountData, NovelAIUsageBar } from '../shared.ts'
import type { NS } from './locales.ts'

export type Translate = PropsLocale<typeof NS>['t']

export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

export function formatPercent(value: number): string {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`
}

export function formatCompactDuration(seconds: number, t: Translate): string {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return minutes > 0
      ? t('durationHoursMinutes', { hours, minutes })
      : t('durationHours', { hours })
  }
  if (seconds >= 60) {
    return t('durationMinutes', { minutes: Math.floor(seconds / 60) })
  }
  return t('durationSeconds', { seconds: Math.max(1, Math.round(seconds)) })
}

export function formatRelativeUpdate(fetchedAt: number | null, now: number, t: Translate): string {
  if (fetchedAt === null) return ''
  const elapsedMinutes = Math.max(0, Math.floor((now - fetchedAt) / 60_000))
  if (elapsedMinutes < 1) return t('updatedJustNow')
  if (elapsedMinutes < 60) return t('updatedMinutes', { minutes: elapsedMinutes })
  return t('updatedHours', { hours: Math.floor(elapsedMinutes / 60) })
}

export function tierLabelOf(data: NovelAIAccountData, t: Translate): string {
  const kind = subscriptionTierKind(data)
  switch (kind) {
    case 'opus': return t('tierOpus')
    case 'scroll': return t('tierScroll')
    case 'tablet': return t('tierTablet')
    case 'inactive': return t('tierInactive')
    default: return t('tierFree')
  }
}

export function formatUsageNote(usage: NovelAIUsageBar, fetchedAt: number | null, now: number, t: Translate): string {
  if (usage.isNegative || (usage.percent <= 0 && usage.purchasedPercent <= 0)) {
    return t('hpDepleted')
  }
  if (usage.percent >= 100) {
    return t('hpFull')
  }
  const remaining = remainingRegenSeconds(usage, fetchedAt, now)
  if (remaining === null) return ''
  if (remaining <= 0) return t('hpRegenSoon')
  return t('hpRegenIn', { duration: formatCompactDuration(remaining, t) })
}

/** 与 DSH ConversationMainPanel 严格对齐的首页空白会话（Hero）判定。 */
export function isHeroConversationPhase(
  session: {
    readonly blank: boolean
    readonly awaitingFirstTurn: boolean
    readonly running: boolean
    readonly promptAttempted: boolean
    readonly openState: string
  } | undefined,
  conversation: { readonly activeTargets: ReadonlySet<string> } | undefined,
  summaryBlank: boolean | undefined,
): boolean {
  if (session === undefined || conversation === undefined) return true
  const active = conversation.activeTargets.size > 0
    || (!session.blank && !session.awaitingFirstTurn)
    || session.running
  const shellPhase = active ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
  return shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)
}

/**
 * 提取会话内 NovelAI 工具活动信号（纯原始数值以避免流式输出期间重渲染）：
 * - `0`：当前会话未使用过 NovelAI 工具
 * - `< 0`：当前正在执行 `novelai_*` 工具
 * - `> 0`：最近一次完成的 `novelai_*` 工具结果事件序号
 */
export function selectNovelAISessionSignal(chat: {
  readonly legacy: {
    readonly nodes: readonly { readonly kind: string; readonly seq: number; readonly name?: string | null }[]
    readonly runningCalls: readonly { readonly name: string }[]
  }
}): number {
  let latestSeq = 0
  for (const node of chat.legacy.nodes) {
    if (node.kind === 'tool-result' && typeof node.name === 'string' && node.name.startsWith('novelai_')) {
      if (node.seq > latestSeq) latestSeq = node.seq
    }
  }
  const running = chat.legacy.runningCalls.some(call => call.name.startsWith('novelai_'))
  return running ? -(latestSeq + 1) : latestSeq
}
