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
    result.push(remaining.slice(0, lo))
    remaining = remaining.slice(lo).replace(/^\s+/, '')
  }

  return result.length > 0 ? result : [text]
}
