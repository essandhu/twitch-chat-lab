import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from 'obscenity'

// The word list lives inside the `obscenity` package, not in this repo.
// `englishRecommendedTransformers` handles casing, leetspeak, and diacritics.
const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
})

const censorSpan = (span: string): string => {
  if (span.length <= 1) return span
  return span[0] + '*'.repeat(span.length - 1)
}

export const censorText = (text: string, enabled: boolean): string => {
  if (!enabled || text.length === 0) return text

  const matches = matcher.getAllMatches(text, true)
  if (matches.length === 0) return text

  // Walk the string once, substituting each matched span with an asterisk run.
  let out = ''
  let cursor = 0
  for (const { startIndex, endIndex } of matches) {
    if (startIndex < cursor) continue // overlapping — skip
    out += text.slice(cursor, startIndex)
    out += censorSpan(text.slice(startIndex, endIndex + 1))
    cursor = endIndex + 1
  }
  out += text.slice(cursor)
  return out
}
