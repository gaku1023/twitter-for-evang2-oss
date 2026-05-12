import {
  CreateStartUpPageContainer,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { fetchTweets, requestRefresh } from './api'
import { state } from './state'
import { paginateText } from './pagination'
import { buildContainerSpec, showModeSelect } from './render'
import {
  startClock,
  stopAutoTimer,
  stopClock,
  stopRefreshStatusClearTimer,
} from './timers'
import { subscribeEvents } from './events'

// ---- SDK bridge ----
state.bridge = await waitForEvenAppBridge()

state.tweets = await fetchTweets().catch(() => [])
if (state.tweets.length > 0) {
  state.pages = paginateText(state.tweets[0].text)
  // We have data already — the empty-state placeholder won't render. Clear
  // the flag for symmetry, so later code paths can't mistakenly fall back
  // to "Loading...".
  state.initialFetchPending = false
}

// Use the proven tweet-view spec for the initial container creation, then
// overlay the mode-select content via textContainerUpgrade. Creating the
// startup page with a "different" spec (e.g. mode-select-only) caused the
// screen to go black on transition; reusing the same spec keeps the active
// event container intact.
await state.bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 6,
    textObject: buildContainerSpec(),
  }),
)

await showModeSelect()

// Kick off a scrape now so it can run in the background while the user picks
// a mode. confirmModeAndStart() will poll on this request_id when it runs.
requestRefresh()
  .then(r => {
    if (!state.pendingRefreshIdLocked) {
      state.pendingRefreshId = r.request_id
    }
  })
  .catch(() => {
    // Worker unreachable — confirmModeAndStart() will fall back to issuing a
    // fresh request when it runs.
  })

startClock()

function cleanup() {
  if (state.cleanedUp) return
  state.cleanedUp = true
  stopClock()
  stopRefreshStatusClearTimer()
  stopAutoTimer()
  unsubscribe()
}

const unsubscribe = subscribeEvents(cleanup)

window.addEventListener('beforeunload', cleanup)
