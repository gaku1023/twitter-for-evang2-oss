import { OsEventTypeList } from '@evenrealities/even_hub_sdk'
import { state } from './state'
import { paginateText } from './pagination'
import {
  confirmModeRender,
  goToTweet,
  renderCurrent,
  rerenderModeSelectBody,
} from './render'
import { refreshAndRebuild } from './refresh'
import {
  resetAutoTimer,
  startAutoTimer,
  stopAutoTimer,
} from './timers'

async function confirmModeAndStart(): Promise<void> {
  await confirmModeRender()
  if (state.mode === 'auto') startAutoTimer()
  // Kick a fresh scrape now that the user has confirmed they're using the app.
  refreshAndRebuild().catch(console.error)
}

// Note: CLICK_EVENT (0) arrives as `undefined` due to protobuf wire encoding —
// coalesce with `?? null` before comparing. Scroll events route through
// `textEvent`; taps/lifecycle route through `sysEvent`.
export function subscribeEvents(onSystemExit: () => void): () => void {
  return state.bridge.onEvenHubEvent(event => {
    const sysType = event.sysEvent?.eventType ?? null
    const textType = event.textEvent?.eventType ?? null

    // Mode selection screen — handled BEFORE the global double-click exit so
    // that the very first tap (which the simulator may deliver as either CLICK
    // or DOUBLE_CLICK depending on its button mapping) confirms the mode rather
    // than killing the app.
    if (state.mode === null) {
      if (
        textType === OsEventTypeList.SCROLL_TOP_EVENT ||
        textType === OsEventTypeList.SCROLL_BOTTOM_EVENT
      ) {
        state.modeCursor = state.modeCursor === 'auto' ? 'manual' : 'auto'
        rerenderModeSelectBody().catch(console.error)
        return
      }
      if (
        sysType === OsEventTypeList.CLICK_EVENT ||
        sysType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
        textType === OsEventTypeList.DOUBLE_CLICK_EVENT
      ) {
        state.mode = state.modeCursor
        confirmModeAndStart().catch(console.error)
        return
      }
      return
    }

    // Double-tap always exits regardless of which envelope (tweet view only)
    if (
      sysType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
      textType === OsEventTypeList.DOUBLE_CLICK_EVENT
    ) {
      state.bridge.shutDownPageContainer(1)
      return
    }

    if (textType === OsEventTypeList.SCROLL_TOP_EVENT) {
      if (state.currentPage > 0) {
        state.currentPage--
        renderCurrent().catch(console.error)
      } else if (state.currentIndex > 0) {
        // Go to previous tweet, land on its last page
        const prevPages = paginateText(state.tweets[state.currentIndex - 1].text)
        goToTweet(state.currentIndex - 1, prevPages.length - 1)
      } else {
        // At the very top of the feed — pull-to-refresh metaphor.
        refreshAndRebuild().catch(console.error)
      }
      resetAutoTimer()
      return
    }

    if (
      textType === OsEventTypeList.SCROLL_BOTTOM_EVENT ||
      sysType === OsEventTypeList.CLICK_EVENT
    ) {
      if (state.currentPage < state.pages.length - 1) {
        state.currentPage++
        renderCurrent().catch(console.error)
      } else if (state.currentIndex < state.tweets.length - 1) {
        goToTweet(state.currentIndex + 1, 0)
      }
      resetAutoTimer()
      return
    }

    if (sysType === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
      // Set foregrounded BEFORE kicking refreshAndRebuild so the finally
      // block's timer-restart guard sees us as visible.
      state.foregrounded = true
      // refreshAndRebuild() restarts the AUTO timer in its `finally` block,
      // so the previous explicit startAutoTimer() here is redundant — and
      // would reset progressStart twice in quick succession, which surfaced
      // as the progress bar visibly jumping/blinking when coming back from
      // background.
      refreshAndRebuild().catch(console.error)
      return
    }

    if (sysType === OsEventTypeList.FOREGROUND_EXIT_EVENT) {
      // Clear foregrounded BEFORE stopping the timer so any in-flight
      // refreshAndRebuild that's about to hit its finally block sees us as
      // background and skips the timer restart.
      state.foregrounded = false
      // Stop the AUTO ticker so we don't burn HTTP/KV (precharge fires) and
      // SDK bridge upgrades while the user isn't looking. The in-flight refresh
      // poll, if any, is left to complete on its own.
      stopAutoTimer()
      return
    }

    if (
      sysType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
      sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT
    ) {
      onSystemExit()
    }
  })
}
