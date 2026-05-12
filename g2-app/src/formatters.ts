import type { Tweet } from './types'
import { state, tweetKey } from './state'
import { PROGRESS_CELLS, PROGRESS_FILL_MS } from './layout'

export function fmtDate(iso: string): string {
  const d = new Date(iso)
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dy = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${mo}/${dy} ${hh}:${mm}`
}

export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export function fmtClock(): string {
  const d = new Date()
  const mo = d.getMonth() + 1
  const dy = d.getDate()
  const dow = DOW[d.getDay()]
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${mo}/${dy}(${dow}) ${hh}:${mm}`
}

export function headerContent(t: Tweet, i: number, total: number): string {
  const w = Math.max(3, String(total).length)
  const idx = `${String(i + 1).padStart(w, '0')}/${String(total).padStart(w, '0')}`
  const pageInfo = `[${state.currentPage + 1}/${state.pages.length}]`
  const newMark = state.newTweetKeys.has(tweetKey(t)) ? '  NEW!' : ''
  return `${idx}  ${pageInfo}    @${t.user_id}    ${fmtDate(t.posted_at)}${newMark}`
}

export function pageCounterContent(): string {
  if (state.pages.length <= 1) return ''
  return `${state.currentPage + 1}/${state.pages.length}`
}

export function progressContent(): string {
  if (state.mode !== 'auto' || state.tweets.length === 0) return ''
  const elapsed = Date.now() - state.progressStart
  const ratio = Math.min(1, Math.max(0, elapsed / PROGRESS_FILL_MS))
  const filled = Math.min(PROGRESS_CELLS, Math.round(ratio * PROGRESS_CELLS))
  return '[' + '='.repeat(filled) + '-'.repeat(PROGRESS_CELLS - filled) + ']'
}

export function footerContent(t: Tweet): string {
  // Counts are always present (worker sends "0" or higher), so the previous
  // truthy guards were dead code. Showing zeros is intentional — it keeps the
  // footer layout stable and tells the user the tweet really has zero engagement
  // rather than missing data.
  return [
    t.user_name,
    `♡ ${t.like_count}`,
    `RT ${t.retweet_count}`,
    `Rp ${t.reply_count}`,
  ].join('  ')
}
