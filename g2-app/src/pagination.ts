import { measureTextWrap } from '@evenrealities/pretext'
import { BODY_INNER_W, LINES_PER_PAGE } from './layout'

export function paginateText(text: string): string[] {
  const result: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    const { lineCount } = measureTextWrap(remaining, BODY_INNER_W)
    if (lineCount <= LINES_PER_PAGE) {
      result.push(remaining)
      break
    }
    // Binary search for the last character that keeps lineCount within budget
    let lo = 1, hi = remaining.length
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      const { lineCount: lc } = measureTextWrap(remaining.slice(0, mid), BODY_INNER_W)
      if (lc <= LINES_PER_PAGE) lo = mid
      else hi = mid - 1
    }
    // Don't split a UTF-16 surrogate pair (emoji, astral plane). slice() works
    // on code units, so a cut between a high surrogate (0xD800–0xDBFF) and the
    // low surrogate that follows would emit a lone surrogate on both sides.
    // Walking lo back by one keeps the pair together; the dropped code unit
    // is replayed on the next page.
    //
    // `lo > 1` guard: if lo === 1 we can't back off without producing an
    // empty page (which would infinite-loop on `remaining.slice(0, 0)`).
    // That corner only arises when the binary search converges to 1, which
    // requires every prefix of length ≥ 2 to overflow LINES_PER_PAGE —
    // pathological input that doesn't occur with real tweets.
    if (lo > 1) {
      const cu = remaining.charCodeAt(lo - 1)
      if (cu >= 0xd800 && cu <= 0xdbff) {
        const next = remaining.charCodeAt(lo)
        if (next >= 0xdc00 && next <= 0xdfff) lo -= 1
      }
    }
    result.push(remaining.slice(0, lo))
    remaining = remaining.slice(lo).replace(/^\s+/, '')
  }

  return result.length > 0 ? result : [text]
}
