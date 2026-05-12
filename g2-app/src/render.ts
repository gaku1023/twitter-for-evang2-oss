import {
  TextContainerProperty,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'
import { state, type AppMode, type RefreshState } from './state'
import {
  BODY_H,
  BODY_Y,
  CLOCK_ROW_H,
  CLOCK_ROW_Y,
  CLOCK_W,
  CLOCK_X,
  DISPLAY_W,
  FOOTER_H,
  FOOTER_LEFT_W,
  FOOTER_Y,
  HEADER_ROW_H,
  HEADER_ROW_Y,
  PAD,
  PROGRESS_H,
  PROGRESS_W,
  PROGRESS_X,
  PROGRESS_Y,
  REFRESH_DONE_DISPLAY_MS,
} from './layout'
import {
  fmtClock,
  footerContent,
  headerContent,
  progressContent,
} from './formatters'
import { paginateText } from './pagination'
import { maybePrechargeRefresh } from './precharge'
import {
  enqueueClockTick,
  enqueueHeaderFooter,
  enqueueProgressTick,
  enqueueRefreshStatus,
  enqueueTask,
  requestRender,
} from './queue'

// ---- Container factory ----
// G2 firmware default border_color is 0 (invisible) — keep borders off to
// match firmware defaults and avoid the extra glow from visible separators.
export function mkContainer(
  id: number,
  name: string,
  y: number,
  h: number,
  content: string,
  capture: 0 | 1,
  x = 0,
  w = DISPLAY_W,
  padding = PAD,
): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: x,
    yPosition: y,
    width: w,
    height: h,
    borderWidth: 0,
    borderColor: 0,
    borderRadius: 0,
    paddingLength: padding,
    containerID: id,
    containerName: name,
    content,
    isEventCapture: capture,
  })
}

// ---- Mode select screen ----
export const MODE_OPTIONS: { value: AppMode; label: string }[] = [
  { value: 'auto', label: '自動 (10秒ごとに次のページ)' },
  { value: 'manual', label: '手動 (リングで操作)' },
]

export function modeSelectBodyContent(): string {
  return MODE_OPTIONS
    .map(o => `${o.value === state.modeCursor ? '> ' : '  '}${o.label}`)
    .join('\n')
}

export function buildContainerSpec(): TextContainerProperty[] {
  if (state.tweets.length === 0) {
    return [
      mkContainer(1, 'header', HEADER_ROW_Y, HEADER_ROW_H, 'Twitter for G2', 0),
      mkContainer(2, 'body', BODY_Y, BODY_H,
        'ツイートを読み込めませんでした。\nWorkerのURLを確認してください。', 1),
      mkContainer(3, 'footer', FOOTER_Y, FOOTER_H, '', 0, 0, FOOTER_LEFT_W),
      mkContainer(4, 'refresh', CLOCK_ROW_Y, CLOCK_ROW_H, '', 0, 0, CLOCK_X),
      mkContainer(5, 'clock', CLOCK_ROW_Y, CLOCK_ROW_H, fmtClock(), 0, CLOCK_X, CLOCK_W),
      mkContainer(6, 'progress', PROGRESS_Y, PROGRESS_H, '', 0, PROGRESS_X, PROGRESS_W),
    ]
  }
  const t = state.tweets[state.currentIndex]
  return [
    mkContainer(1, 'header', HEADER_ROW_Y, HEADER_ROW_H, headerContent(t, state.currentIndex, state.tweets.length), 0),
    mkContainer(2, 'body', BODY_Y, BODY_H, state.pages[state.currentPage], 1),
    mkContainer(3, 'footer', FOOTER_Y, FOOTER_H, footerContent(t), 0, 0, FOOTER_LEFT_W),
    mkContainer(4, 'refresh', CLOCK_ROW_Y, CLOCK_ROW_H, '', 0, 0, CLOCK_X),
    mkContainer(5, 'clock', CLOCK_ROW_Y, CLOCK_ROW_H, fmtClock(), 0, CLOCK_X, CLOCK_W),
    mkContainer(6, 'progress', PROGRESS_Y, PROGRESS_H, progressContent(), 0, PROGRESS_X, PROGRESS_W),
  ]
}

// Overlay the mode-select content on top of the freshly-created tweet view.
export function showModeSelect(): Promise<void> {
  return enqueueTask(async () => {
    await state.bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: 1, containerName: 'header', content: 'Twitter for G2 - モード選択' }),
    )
    await state.bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: 2, containerName: 'body', content: modeSelectBodyContent() }),
    )
    await state.bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: 3, containerName: 'footer', content: 'リングで選択 / クリックで決定' }),
    )
  })
}

// Coalesced full-tweet render. Multiple rapid calls collapse to one bridge
// cycle against the latest state — see queue.ts for the rationale.
export function renderCurrent(): Promise<void> {
  if (state.tweets.length === 0) return Promise.resolve()
  // Page-transition bookkeeping fires once per logical call, even when the
  // bridge render is coalesced away. Precharge gates are idempotent.
  state.pagesSinceLastRefresh++
  maybePrechargeRefresh()
  return requestRender()
}

export function goToTweet(index: number, page = 0): void {
  state.currentIndex = index
  state.pages = paginateText(state.tweets[index].text)
  state.currentPage = page
  renderCurrent().catch(console.error)
}

// Refresh the header/footer in place, leaving body/clock/progress untouched
// so the user's current page is preserved across a refresh.
export function rerenderHeaderAndFooter(): Promise<void> {
  return enqueueHeaderFooter()
}

// Mode-select body redraw (cursor moved between options).
export function rerenderModeSelectBody(): Promise<void> {
  return enqueueTask(async () => {
    await state.bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: 2, containerName: 'body', content: modeSelectBodyContent() }),
    )
  })
}

// Switch from the mode-select screen to the tweet view by upgrading each
// container's content. The mode-select layout uses the same container IDs
// and dimensions as the tweet view, so a per-container content swap is enough
// — and avoids the black-screen issue seen when rebuildPageContainer is
// called immediately after createStartUpPageContainer.
export function confirmModeRender(): Promise<void> {
  return enqueueTask(async () => {
    if (state.tweets.length === 0) {
      await state.bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: 1, containerName: 'header', content: 'Twitter for G2' }),
      )
      await state.bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: 2,
          containerName: 'body',
          content: 'ツイートを読み込めませんでした。\nWorkerのURLを確認してください。',
        }),
      )
      await state.bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: 3, containerName: 'footer', content: '' }),
      )
      return
    }
    const t = state.tweets[state.currentIndex]
    await state.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 1,
        containerName: 'header',
        content: headerContent(t, state.currentIndex, state.tweets.length),
      }),
    )
    await state.bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: 2, containerName: 'body', content: state.pages[state.currentPage] }),
    )
    await state.bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: 3, containerName: 'footer', content: footerContent(t) }),
    )
  })
}

export function tickProgress(): void {
  enqueueProgressTick().catch(err => console.error('[render] tickProgress', err))
}

export function tickClock(): void {
  enqueueClockTick().catch(err => console.error('[render] tickClock', err))
}

// ---- Refresh status indicator (top-left, mirror of the clock at top-right) ----
function refreshStatusContent(): string {
  return state.refreshState === 'running' ? '更新中...' :
         state.refreshState === 'done'    ? '更新完了' :
         state.refreshState === 'timeout' ? 'タイムアウト' :
         state.refreshState === 'error'   ? '更新失敗' : ''
}

function renderRefreshStatus(): void {
  enqueueRefreshStatus(refreshStatusContent())
    .catch(err => console.error('[render] refresh status', err))
}

export function setRefreshStatus(s: RefreshState): void {
  if (state.refreshStatusClearTimer) {
    clearTimeout(state.refreshStatusClearTimer)
    state.refreshStatusClearTimer = null
  }
  state.refreshState = s
  renderRefreshStatus()
  if (s === 'done' || s === 'timeout' || s === 'error') {
    state.refreshStatusClearTimer = setTimeout(() => {
      setRefreshStatus('idle')
    }, REFRESH_DONE_DISPLAY_MS)
  }
}
