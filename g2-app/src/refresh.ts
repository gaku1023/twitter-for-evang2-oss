import { state, tweetKey } from './state'
import { REFRESH_POLL_INTERVAL_MS, REFRESH_TIMEOUT_MS } from './layout'
import { fetchStatus, fetchTweets, requestRefresh } from './api'
import { paginateText } from './pagination'
import {
  renderCurrent,
  rerenderHeaderAndFooter,
  setRefreshStatus,
} from './render'
import { rebuildNewPageCounts } from './precharge'
import { startAutoTimer } from './timers'

// Trigger a scrape on the home PC and merge any new tweets into the head of
// the in-memory list, keeping the user's current page intact.
export async function refreshAndRebuild(): Promise<void> {
  if (state.refreshing) return
  state.refreshing = true
  state.pendingRefreshIdLocked = true
  // Restart the time-tier countdown on every attempt — without this, a
  // failure leaves the counter at whatever value it grew to during the
  // 60–90s polling window, which would let the next page transition fire a
  // precharge ~10s after a failed pull/precharge.
  state.pagesSinceLastRefresh = 0
  try {
    setRefreshStatus('running')

    let requestId: string
    if (state.pendingRefreshId) {
      requestId = state.pendingRefreshId
      state.pendingRefreshId = null
    } else {
      try {
        const r = await requestRefresh()
        requestId = r.request_id
      } catch {
        setRefreshStatus('error')
        return
      }
    }

    const start = Date.now()
    let done = false
    let errored = false
    while (Date.now() - start < REFRESH_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, REFRESH_POLL_INTERVAL_MS))
      try {
        const meta = await fetchStatus()
        // Wait for the scraper to finish — `last_handled_request_id` matches
        // as soon as the scraper *starts*, so we must also require state !==
        // "running" to confirm completion.
        if (meta.last_handled_request_id === requestId && meta.state !== 'running') {
          done = meta.state !== 'error'
          errored = meta.state === 'error'
          break
        }
      } catch {
        // transient — keep polling
      }
    }

    if (!done) {
      setRefreshStatus(errored ? 'error' : 'timeout')
      return
    }

    // Bypass KV edge cache here — the scraper's write to `tweets` may not yet
    // be visible through the cached path even though `tweets_meta` is fresh.
    const fresh = await fetchTweets({ fresh: true }).catch(() => null)
    if (!fresh) {
      setRefreshStatus('error')
      return
    }

    // Diff against in-memory: anything in `fresh` not yet seen is new.
    const existing = new Set(state.tweets.map(tweetKey))
    const newOnes = fresh.filter(t => !existing.has(tweetKey(t)))
    console.log(
      `[refresh] in-memory=${state.tweets.length} fresh=${fresh.length} new=${newOnes.length}` +
      (fresh.length > 0 ? ` fresh[0]=${tweetKey(fresh[0])}` : '') +
      (state.tweets.length > 0 ? ` mem[0]=${tweetKey(state.tweets[0])}` : ''),
    )

    // NEW! marker only covers the most recent batch — clear and repopulate.
    state.newTweetKeys = new Set(newOnes.map(tweetKey))

    if (newOnes.length > 0) {
      // Prepend newcomers and jump to the top so the user lands on the
      // freshly scraped tweets.
      state.tweets = [...newOnes, ...state.tweets]
      state.currentIndex = 0
      state.currentPage = 0
      state.pages = paginateText(state.tweets[0].text)
      await renderCurrent()
      // Resync the auto-advance timer + progress bar to the new tweet 0 page 0,
      // otherwise the user lands on the new top with a half-filled progress
      // bar from the previous tweet's cycle.
      if (state.mode === 'auto') startAutoTimer()
    } else if (state.tweets.length === 0 && fresh.length > 0) {
      // First-time load with empty in-memory state.
      state.tweets = fresh
      state.currentIndex = 0
      state.currentPage = 0
      state.pages = paginateText(state.tweets[0].text)
      await renderCurrent()
      if (state.mode === 'auto') startAutoTimer()
    } else {
      // Nothing new — keep position, just refresh the header so any old
      // NEW! markers (now cleared) disappear.
      await rerenderHeaderAndFooter()
    }

    // Recompute NEW page-count cache and arm the next AUTO precharge cycle.
    rebuildNewPageCounts()

    setRefreshStatus('done')
  } finally {
    state.refreshing = false
    // Safety net for the FOREGROUND_ENTER path: if AUTO mode is active and
    // the timer was stopped (by FOREGROUND_EXIT) and no `startAutoTimer`
    // call landed inside the try block (e.g., refresh timed out or yielded
    // no new tweets), make sure the timer is restarted so the user doesn't
    // come back from background to a frozen page.
    if (state.mode === 'auto' && !state.autoTimer) startAutoTimer()
  }
}
