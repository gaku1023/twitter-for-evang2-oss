import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import type { Tweet } from './types'

export type AppMode = 'auto' | 'manual'
// Refresh-status display state for the top-left transient indicator.
export type RefreshState = 'idle' | 'running' | 'done' | 'timeout' | 'error'

export type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>

export function tweetKey(t: Tweet): string {
  return `${t.user_id}|${t.posted_at}`
}

// Single shared mutable state object. `main.ts` assigns `bridge` immediately
// after `waitForEvenAppBridge()` resolves, before any other module runs.
export const state = {
  bridge: null as unknown as Bridge,

  // Mode-select cursor + confirmed mode.
  mode: null as AppMode | null,
  modeCursor: 'auto' as AppMode,

  // Tweet list + pagination.
  tweets: [] as Tweet[],
  currentIndex: 0,
  currentPage: 0,
  pages: [] as string[],

  // Refresh state.
  refreshing: false,
  // Set when we kick off a refresh during mode-select so the post-confirm flow
  // can attach to that in-flight request instead of issuing a new one.
  pendingRefreshId: null as string | null,
  // Once refreshAndRebuild has started for the first time, the startup
  // requestRefresh() promise must NOT overwrite pendingRefreshId — by then it
  // would carry an already-handled id, which would cause the next refresh to
  // poll a completed request and trigger a wasted fetch.
  pendingRefreshIdLocked: false,

  // Tweets added by the most recent refresh — used to render the NEW! suffix.
  // Cleared and repopulated on every refresh.
  newTweetKeys: new Set<string>(),
  // Page-count cache for tweets in the current NEW batch — keyed by tweetKey.
  // Lets countRemainingNewPages avoid re-running paginateText for every
  // subsequent NEW tweet on each page transition.
  newPageCounts: new Map<string, number>(),
  // True once we've fired the AUTO precharge refresh for the current NEW batch
  // (or the batch is too small for a precharge to be useful). Reset by
  // rebuildNewPageCounts whenever newTweetKeys is repopulated.
  autoPrechargeFired: true,
  // Total pages in the current NEW batch (sum of newPageCounts values). Gates
  // the position-trigger so small/empty batches don't fire it immediately.
  totalNewPages: 0,
  // Page transitions since the last successful refresh — drives the time-tier
  // fallback when there is no substantive NEW to anchor the position trigger.
  pagesSinceLastRefresh: 0,

  refreshState: 'idle' as RefreshState,
  // Auto-clear timer for the "Updated" indicator.
  refreshStatusClearTimer: null as ReturnType<typeof setTimeout> | null,

  // Auto-advance + progress + clock timers.
  autoTimer: null as ReturnType<typeof setInterval> | null,
  progressTimer: null as ReturnType<typeof setInterval> | null,
  progressStart: 0,
  clockTimeout: null as ReturnType<typeof setTimeout> | null,
  clockInterval: null as ReturnType<typeof setInterval> | null,

  cleanedUp: false,
}
