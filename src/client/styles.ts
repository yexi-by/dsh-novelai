const STYLE_ATTR = 'dsh-novelai'

const CSS = `
@keyframes nai-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.nai-spin {
  animation: nai-spin 0.85s linear infinite;
}

/* 首页 Hero 底部状态条容器：位于 conversation.input.dock，借 order: 2 排在首页输入卡片正下方 */
.nai-home-wrap {
  order: 2;
  display: flex;
  justify-content: center;
  width: 100%;
  box-sizing: border-box;
  padding: 2px var(--dsh-composer-side-clearance, 16px) 0;
}

.nai-home-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 14px;
  width: 100%;
  max-width: var(--dsh-composer-card-max-width, 760px);
  box-sizing: border-box;
  padding: 7px 14px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 76%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}

.nai-home-bar[data-compact='true'] {
  justify-content: center;
  width: auto;
  max-width: var(--dsh-composer-card-max-width, 760px);
  padding: 5px 12px;
  border-radius: 999px;
}

.nai-cluster {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  min-width: 0;
}

.nai-brand {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
}

.nai-brand svg {
  flex: none;
  color: var(--dsw-alias-state-business-primary);
}

.nai-tier-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  white-space: nowrap;
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-secondary);
}

.nai-tier-badge[data-tier='opus'] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 42%, var(--dsw-alias-border-l2));
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);
  color: var(--dsw-alias-state-business-primary);
}

.nai-tier-badge[data-tier='inactive'] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, var(--dsw-alias-border-l2));
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent);
  color: var(--dsw-alias-state-warn-primary);
}

.nai-sep {
  color: var(--dsw-alias-separator-primary, var(--dsw-alias-border-l3));
  user-select: none;
}

.nai-hp-group {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.nai-label-muted {
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
}

.nai-hp-track {
  position: relative;
  display: block;
  width: 88px;
  height: 7px;
  border-radius: 999px;
  overflow: hidden;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 13%, transparent);
  flex: none;
}

/* 四等分刻度线，增强“血条”直观刻度感 */
.nai-hp-track::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: linear-gradient(
    to right,
    transparent calc(25% - 0.5px),
    color-mix(in srgb, var(--dsw-alias-bg-base) 52%, transparent) calc(25% - 0.5px),
    color-mix(in srgb, var(--dsw-alias-bg-base) 52%, transparent) calc(25% + 0.5px),
    transparent calc(25% + 0.5px),
    transparent calc(50% - 0.5px),
    color-mix(in srgb, var(--dsw-alias-bg-base) 52%, transparent) calc(50% - 0.5px),
    color-mix(in srgb, var(--dsw-alias-bg-base) 52%, transparent) calc(50% + 0.5px),
    transparent calc(50% + 0.5px),
    transparent calc(75% - 0.5px),
    color-mix(in srgb, var(--dsw-alias-bg-base) 52%, transparent) calc(75% - 0.5px),
    color-mix(in srgb, var(--dsw-alias-bg-base) 52%, transparent) calc(75% + 0.5px),
    transparent calc(75% + 0.5px)
  );
  pointer-events: none;
}

.nai-hp-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  transition: width 260ms ease, background 260ms ease;
  background: linear-gradient(
    90deg,
    var(--dsw-alias-state-success-primary),
    var(--dsw-alias-state-success-secondary, var(--dsw-alias-state-success-primary))
  );
}

.nai-hp-fill[data-tone='warn'] {
  background: linear-gradient(
    90deg,
    var(--dsw-alias-state-warn-primary),
    var(--dsw-alias-state-warn-secondary, var(--dsw-alias-state-warn-primary))
  );
}

.nai-hp-fill[data-tone='low'] {
  background: linear-gradient(
    90deg,
    var(--dsw-alias-state-error-primary),
    var(--dsw-alias-state-error-secondary, var(--dsw-alias-state-error-primary))
  );
}

.nai-hp-value {
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
}

.nai-hp-value[data-tone='warn'] {
  color: var(--dsw-alias-state-warn-primary);
}

.nai-hp-value[data-tone='low'] {
  color: var(--dsw-alias-state-error-primary);
}

.nai-boost-pill {
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);
  color: var(--dsw-alias-state-business-primary);
  white-space: nowrap;
}

.nai-subnote {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  white-space: nowrap;
}

.nai-anlas-strong {
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
}

.nai-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0.5px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

@media (hover: hover) {
  .nai-icon-btn:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-primary);
  }
}

.nai-icon-btn:disabled {
  cursor: default;
  opacity: 0.6;
}

.nai-retry-btn {
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  padding: 1px 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
}

@media (hover: hover) {
  .nai-retry-btn:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}

/* 对话进行中底部 composer.dock 紧凑胶囊 */
.nai-dock {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 1px 6px;
  border-radius: var(--dsw-radius-sm, 6px);
  color: var(--dsw-alias-label-tertiary);
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.nai-dock-hp {
  width: 42px;
  height: 5px;
}

.nai-dock-hp::after {
  display: none;
}

/* 插件配置页额度面板 */
.nai-quota-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-xl, 12px);
  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-3));
  font-variant-numeric: tabular-nums;
}

.nai-quota-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
}

.nai-quota-hp-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.nai-quota-hp-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 10px;
  font-size: 13px;
}

.nai-quota-hp-bar {
  width: 100%;
  height: 9px;
}

.nai-quota-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px 14px;
  margin: 0;
  padding-top: 4px;
}

.nai-quota-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.nai-quota-item dt {
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}

.nai-quota-item dd {
  margin: 0;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

@media (max-width: 640px) {
  .nai-hide-narrow {
    display: none;
  }
  .nai-home-bar {
    padding: 7px 11px;
    gap: 6px 10px;
  }
  .nai-hp-track:not(.nai-quota-hp-bar):not(.nai-dock-hp) {
    width: 68px;
  }
}
`

export function ensureStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.querySelector<HTMLStyleElement>(`style[data-plugin="${STYLE_ATTR}"]`)
  if (existing !== null) {
    existing.textContent = CSS
    return () => {}
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = STYLE_ATTR
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => {
    tag.remove()
  }
}
