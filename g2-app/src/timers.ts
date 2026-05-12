import { state } from './state'
import { AUTO_INTERVAL_MS, PROGRESS_TICK_MS } from './layout'
import { goToTweet, renderCurrent, tickClock, tickProgress } from './render'
import { isRenderBusy } from './queue'

function autoAdvance(): void {
  if (state.tweets.length === 0) return
  // Back-pressure: if the bridge hasn't finished the previous render yet,
  // skip this tick instead of advancing state. Prevents intermediate pages
  // from being coalesced away when the BLE bridge stalls.
  if (isRenderBusy()) return
  if (state.currentPage < state.pages.length - 1) {
    state.currentPage++
    renderCurrent().catch(console.error)
  } else if (state.currentIndex < state.tweets.length - 1) {
    goToTweet(state.currentIndex + 1, 0)
  } else {
    goToTweet(0, 0)
  }
  state.progressStart = Date.now()
  tickProgress()
}

export function startAutoTimer(): void {
  stopAutoTimer()
  state.autoTimer = setInterval(autoAdvance, AUTO_INTERVAL_MS)
  startProgress()
}

export function stopAutoTimer(): void {
  if (state.autoTimer) {
    clearInterval(state.autoTimer)
    state.autoTimer = null
  }
  stopProgress()
}

export function startProgress(): void {
  stopProgress()
  state.progressStart = Date.now()
  tickProgress()
  state.progressTimer = setInterval(tickProgress, PROGRESS_TICK_MS)
}

export function stopProgress(): void {
  if (state.progressTimer) {
    clearInterval(state.progressTimer)
    state.progressTimer = null
  }
}

// Reset the 10s countdown after manual nav so the user gets a full read window.
export function resetAutoTimer(): void {
  if (state.mode === 'auto') startAutoTimer()
}

// ---- Clock (top-right hh:mm, ticks on minute boundary) ----
export function startClock(): void {
  stopClock()
  const now = new Date()
  const msToNextMin = (60 - now.getSeconds()) * 1000 - now.getMilliseconds()
  state.clockTimeout = setTimeout(() => {
    tickClock()
    state.clockInterval = setInterval(tickClock, 60_000)
  }, msToNextMin)
}

export function stopClock(): void {
  if (state.clockTimeout) {
    clearTimeout(state.clockTimeout)
    state.clockTimeout = null
  }
  if (state.clockInterval) {
    clearInterval(state.clockInterval)
    state.clockInterval = null
  }
}

export function stopRefreshStatusClearTimer(): void {
  if (state.refreshStatusClearTimer) {
    clearTimeout(state.refreshStatusClearTimer)
    state.refreshStatusClearTimer = null
  }
}
