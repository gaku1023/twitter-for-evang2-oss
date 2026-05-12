import { TextContainerUpgrade } from '@evenrealities/even_hub_sdk'
import { state } from './state'
import {
  CLOCK_ROW_H,
  CLOCK_ROW_Y,
  CLOCK_W,
  CLOCK_X,
  FOOTER_H,
  FOOTER_LEFT_W,
  FOOTER_Y,
  HEADER_ROW_H,
  HEADER_ROW_Y,
  PROGRESS_H,
  PROGRESS_W,
  PROGRESS_X,
  PROGRESS_Y,
} from './layout'
import {
  fmtClock,
  footerContent,
  headerContent,
  progressContent,
} from './formatters'

// Single-consumer task queue for SDK bridge upgrades. Replaces the previous
// `state.rendering = state.rendering.then(...)` chain, which had two problems:
//   1. Failed bridge calls reject the chain and silently kill every subsequent
//      .then — the UI freezes. (No `.catch` was attached anywhere.)
//   2. The chain accumulates closures indefinitely (one new .then per tick
//      every 500ms), causing linear memory growth on long sessions.
//
// The queue also coalesces renderCurrent: if the bridge is slow (BLE drop /
// device wake), many auto-advance callbacks pile up — instead of replaying
// every intermediate page, we drop the queue down to a single render against
// the latest `state.currentIndex / currentPage`. This kills the "blazing scroll"
// where, on bridge resume, the chain rapid-fires N queued page transitions.

let queueRunning = false
let renderPending = false
let renderResolvers: Array<() => void> = []
const taskQueue: Array<() => Promise<void>> = []

// Back-pressure signal for autoAdvance: while the bridge is mid-render or
// has work queued, the auto timer should hold off advancing state instead of
// piling more renders on top. Without this, slow-bridge windows previously
// collapsed N intermediate pages into a single coalesced render (the user
// would never see the middle pages). With back-pressure, the AUTO clock
// effectively pauses during stalls and resumes from the same page on the
// next tick, so no content is skipped.
export function isRenderBusy(): boolean {
  return queueRunning || renderPending || taskQueue.length > 0
}

async function performRender(): Promise<void> {
  if (state.tweets.length === 0) return
  const t = state.tweets[state.currentIndex]
  await state.bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: 1,
      containerName: 'header',
      content: headerContent(t, state.currentIndex, state.tweets.length),
    }),
  )
  await state.bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: 2,
      containerName: 'body',
      content: state.pages[state.currentPage],
    }),
  )
  await state.bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: 3,
      containerName: 'footer',
      content: footerContent(t),
    }),
  )
}

async function drain(): Promise<void> {
  if (queueRunning) return
  queueRunning = true
  try {
    while (renderPending || taskQueue.length > 0) {
      if (renderPending) {
        renderPending = false
        const resolvers = renderResolvers
        renderResolvers = []
        try {
          await performRender()
        } catch (err) {
          console.error('[queue] render failed', err)
        }
        for (const r of resolvers) r()
        // Loop back — another render or task may have been requested while
        // performRender was awaiting.
        continue
      }
      const task = taskQueue.shift()!
      try {
        await task()
      } catch (err) {
        console.error('[queue] task failed', err)
      }
    }
  } finally {
    queueRunning = false
  }
}

// Coalesced render request. Multiple back-to-back calls collapse into one
// bridge cycle that uses the *latest* state at the moment performRender runs.
export function requestRender(): Promise<void> {
  return new Promise<void>(resolve => {
    renderPending = true
    renderResolvers.push(resolve)
    void drain()
  })
}

// FIFO task. Use for non-coalescable bridge upgrades (clock tick, progress
// tick, refresh-status indicator, mode-select overlay swap).
export function enqueueTask(task: () => Promise<void>): Promise<void> {
  return new Promise<void>(resolve => {
    taskQueue.push(async () => {
      try {
        await task()
      } finally {
        resolve()
      }
    })
    void drain()
  })
}

// ---- Convenience wrappers for the common per-container tick upgrades ----

export function enqueueProgressTick(): Promise<void> {
  return enqueueTask(async () => {
    await state.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 6,
        containerName: 'progress',
        content: progressContent(),
      }),
    )
  })
}

export function enqueueClockTick(): Promise<void> {
  return enqueueTask(async () => {
    await state.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 5,
        containerName: 'clock',
        content: fmtClock(),
      }),
    )
  })
}

export function enqueueRefreshStatus(content: string): Promise<void> {
  return enqueueTask(async () => {
    await state.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 4,
        containerName: 'refresh',
        content,
      }),
    )
  })
}

// Header + footer only — used when we want to refresh the NEW! marker / index
// counter in place without disturbing the body container.
export function enqueueHeaderFooter(): Promise<void> {
  return enqueueTask(async () => {
    if (state.tweets.length === 0) return
    const t = state.tweets[state.currentIndex]
    await state.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 1,
        containerName: 'header',
        content: headerContent(t, state.currentIndex, state.tweets.length),
      }),
    )
    await state.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 3,
        containerName: 'footer',
        content: footerContent(t),
      }),
    )
  })
}

// Sizes of the layout fields used elsewhere — re-exported so render.ts
// doesn't need to know about the SDK module internals. (Avoids duplicating
// the layout constants in two places.)
export {
  CLOCK_ROW_H,
  CLOCK_ROW_Y,
  CLOCK_W,
  CLOCK_X,
  FOOTER_H,
  FOOTER_LEFT_W,
  FOOTER_Y,
  HEADER_ROW_H,
  HEADER_ROW_Y,
  PROGRESS_H,
  PROGRESS_W,
  PROGRESS_X,
  PROGRESS_Y,
}
