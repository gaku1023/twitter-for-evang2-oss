import { getTextWidth } from '@evenrealities/pretext'

// Display layout constants (G2: 576×288px, line height: 27px)
export const DISPLAY_W = 576
export const LINE_H = 27
// Header is split into two rows: clock on top, tweet meta below.
export const CLOCK_ROW_Y = 0
export const CLOCK_ROW_H = LINE_H
export const HEADER_ROW_Y = LINE_H
export const HEADER_ROW_H = LINE_H
export const HEADER_H = CLOCK_ROW_H + HEADER_ROW_H          // 54px (2 rows)
// Body must fit 7 lines + paddingLength on top/bottom: 7*27 + 4*2 = 197.
// Otherwise LVGL flags the container as scrollable and draws a scrollbar.
export const FOOTER_H = 37
export const BODY_Y = HEADER_H                              // 54
export const BODY_H = 288 - HEADER_H - FOOTER_H             // 197px
export const FOOTER_Y = BODY_Y + BODY_H                     // 251
export const PAD = 4
export const LINES_PER_PAGE = Math.floor(BODY_H / LINE_H)   // 7
export const BODY_INNER_W = DISPLAY_W - PAD * 2             // 568
export const COUNTER_W = 55
export const COUNTER_X = DISPLAY_W - COUNTER_W              // 521
export const COUNTER_Y = BODY_Y + BODY_H - LINE_H
export const CLOCK_W = getTextWidth('12/31(日) 23:59') + PAD * 2
export const CLOCK_X = DISPLAY_W - CLOCK_W
// Progress bar shares the footer row, anchored to the right; footer text gets
// the remaining width on the left. 19 cells fill over 9.5 seconds (one cell
// every 500ms); the last 500ms of the 10-second page interval holds at 100%.
export const PROGRESS_CELLS = 19
export const PROGRESS_FILL_MS = 9500
export const PROGRESS_W = getTextWidth('[' + '='.repeat(PROGRESS_CELLS) + ']') + PAD * 2
export const PROGRESS_X = DISPLAY_W - PROGRESS_W
export const PROGRESS_Y = FOOTER_Y
export const PROGRESS_H = FOOTER_H
export const FOOTER_LEFT_W = PROGRESS_X

export const AUTO_INTERVAL_MS = 10 * 1000
export const PROGRESS_TICK_MS = 500
// Refresh polling: the OSS worker fetches synchronously from X API, so the
// first poll typically already sees state=idle with a matching request_id.
// We keep a poll loop (rather than relying on the POST response alone) so the
// status indicator can show "更新中..." while the request is in flight.
export const REFRESH_POLL_INTERVAL_MS = 2000
export const REFRESH_TIMEOUT_MS = 60 * 1000
// How long "更新完了" / "タイムアウト" lingers before the status clears.
export const REFRESH_DONE_DISPLAY_MS = 5_000

// Pages remaining in NEW (including the current page) at which we fire the
// precharge. 9 × 10s/page ≈ 90s buffer, aligned to typical 60–90s scrape
// duration so new tweets land roughly when NEW is finished being read.
export const AUTO_PRECHARGE_THRESHOLD = 9
// Floor on time between precharge fires. Blocks the chain-fire pattern where
// totalNewPages just above threshold (e.g., 10) would otherwise fire every
// ~85s and burn through KV write budget. ≈3 minutes at 10s/page.
export const MIN_PAGES_BEFORE_PRECHARGE = 18
// Time-tier fallback threshold: ~6 minutes of AUTO viewing at 10s/page.
// Slightly above the 5-minute mark so daily KV write rate stays under the
// 1k/day Cloudflare free-tier ceiling.
export const MAX_PAGES_BETWEEN_REFRESH = 36
