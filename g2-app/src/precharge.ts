import { state, tweetKey } from './state'
import { paginateText } from './pagination'
import {
  AUTO_PRECHARGE_THRESHOLD,
  MAX_PAGES_BETWEEN_REFRESH,
  MIN_PAGES_BEFORE_PRECHARGE,
} from './layout'
import { refreshAndRebuild } from './refresh'

// ---- NEW! precharge ----
// Kick a scrape so it finishes around the time the user reaches the end of
// the NEW batch in AUTO mode. Position-based trigger handles both auto-advance
// and manual scrolling inside AUTO uniformly.
export function rebuildNewPageCounts(): void {
  state.newPageCounts.clear()
  let total = 0
  for (const t of state.tweets) {
    if (state.newTweetKeys.has(tweetKey(t))) {
      const n = paginateText(t.text).length
      state.newPageCounts.set(tweetKey(t), n)
      total += n
    }
  }
  state.totalNewPages = total
  state.pagesSinceLastRefresh = 0
  state.autoPrechargeFired = false
}

export function countRemainingNewPages(): number {
  if (state.tweets.length === 0) return 0
  if (!state.newTweetKeys.has(tweetKey(state.tweets[state.currentIndex]))) return 0
  let remaining = state.pages.length - state.currentPage
  for (let i = state.currentIndex + 1; i < state.tweets.length; i++) {
    const k = tweetKey(state.tweets[i])
    if (!state.newTweetKeys.has(k)) break
    remaining += state.newPageCounts.get(k) ?? 0
  }
  return remaining
}

export function maybePrechargeRefresh(): void {
  if (state.mode !== 'auto') return
  if (state.autoPrechargeFired) return
  if (state.refreshing) return
  // Floor on fire-rate: never precharge within ~3 min of the last refresh
  // start, even if NEW is just-above-threshold (avoids chain scrapes).
  if (state.pagesSinceLastRefresh < MIN_PAGES_BEFORE_PRECHARGE) return
  // Required: at or past "9 pages before end of unread NEW" position.
  if (countRemainingNewPages() > AUTO_PRECHARGE_THRESHOLD) return
  // Either substantive NEW exists (position-tier) OR enough activity has
  // accumulated since the last refresh (time-tier fallback).
  const positionTrigger = state.totalNewPages > AUTO_PRECHARGE_THRESHOLD
  const timeTrigger = state.pagesSinceLastRefresh >= MAX_PAGES_BETWEEN_REFRESH
  if (!positionTrigger && !timeTrigger) return
  state.autoPrechargeFired = true
  refreshAndRebuild().catch(console.error)
}
