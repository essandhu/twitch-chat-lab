export type Role = 'mod' | 'vip' | 'sub' | 'broadcaster' | 'firstTimer'
export type PresetName = 'firstTimer' | 'sub' | 'hype'
export type RiskBand = 'calm' | 'elevated' | 'high' | 'critical'

export type Token =
  | { kind: 'keyword'; value: string }
  | { kind: 'phrase'; value: string }
  | { kind: 'regex'; pattern: RegExp }
  | { kind: 'role'; role: Role }
  | { kind: 'len'; op: '>' | '<'; n: number }
  | { kind: 'emotes'; n: number }
  | { kind: 'bits'; n: number }
  | { kind: 'user'; login: string }
  | { kind: 'preset'; name: PresetName }
  | { kind: 'risk'; band: RiskBand }
  | { kind: 'and' }
  | { kind: 'or' }
  | { kind: 'not' }
  | { kind: 'lparen' }
  | { kind: 'rparen' }

const ROLES: ReadonlySet<Role> = new Set(['mod', 'vip', 'sub', 'broadcaster', 'firstTimer'])
const RISK_BANDS: ReadonlySet<RiskBand> = new Set(['calm', 'elevated', 'high', 'critical'])
const PRESETS: ReadonlySet<PresetName> = new Set(['firstTimer', 'sub', 'hype'])

export class TokenizeError extends Error {}

const isBarewordChar = (c: string): boolean => /[A-Za-z0-9_]/.test(c)

const readBareword = (src: string, i: number): { value: string; next: number } => {
  let j = i
  while (j < src.length && isBarewordChar(src[j])) j++
  return { value: src.slice(i, j), next: j }
}

const readQuoted = (src: string, i: number): { value: string; next: number } => {
  let j = i + 1
  while (j < src.length && src[j] !== '"') j++
  if (j >= src.length) throw new TokenizeError('unterminated quote')
  return { value: src.slice(i + 1, j), next: j + 1 }
}

const readNumber = (src: string, i: number): { n: number; next: number } | null => {
  let j = i
  while (j < src.length && /[0-9]/.test(src[j])) j++
  if (j === i) return null
  return { n: Number.parseInt(src.slice(i, j), 10), next: j }
}

const readRegex = (src: string, i: number): { pattern: RegExp; next: number } => {
  let j = i + 1
  while (j < src.length) {
    if (src[j] === '\\' && j + 1 < src.length) {
      j += 2
      continue
    }
    if (src[j] === '/') break
    j++
  }
  if (j >= src.length) throw new TokenizeError('invalid regex: unterminated')
  const pattern = src.slice(i + 1, j)
  j++
  let k = j
  while (k < src.length && /[gimsuy]/.test(src[k])) k++
  const flags = src.slice(j, k)
  try {
    return { pattern: new RegExp(pattern, flags), next: k }
  } catch (e) {
    throw new TokenizeError(`invalid regex: ${(e as Error).message}`)
  }
}

const readTaggedToken = (src: string, tag: string, i: number): Token => {
  // i points at the start of the value (after the colon)
  switch (tag) {
    case 'kw': {
      if (src[i] !== '"') throw new TokenizeError('kw: must be followed by a quoted phrase')
      const { value, next } = readQuoted(src, i)
      return mkToken({ kind: 'phrase', value }, next)
    }
    case 'regex': {
      if (src[i] !== '/') throw new TokenizeError('regex: must be followed by /pattern/')
      const { pattern, next } = readRegex(src, i)
      return mkToken({ kind: 'regex', pattern }, next)
    }
    case 'role': {
      const { value, next } = readBareword(src, i)
      if (!ROLES.has(value as Role)) throw new TokenizeError(`invalid role: ${value}`)
      return mkToken({ kind: 'role', role: value as Role }, next)
    }
    case 'user': {
      const { value, next } = readBareword(src, i)
      if (!value) throw new TokenizeError('user: requires a login')
      return mkToken({ kind: 'user', login: value.toLowerCase() }, next)
    }
    case 'risk': {
      const { value, next } = readBareword(src, i)
      if (!RISK_BANDS.has(value as RiskBand)) throw new TokenizeError(`invalid risk band: ${value}`)
      return mkToken({ kind: 'risk', band: value as RiskBand }, next)
    }
    default:
      throw new TokenizeError(`unknown tag: ${tag}`)
  }
}

type TokenWithCursor = Token & { _next: number }

const mkToken = (t: Token, next: number): TokenWithCursor => Object.assign({ _next: next }, t)

const readComparisonToken = (src: string, tag: 'len' | 'emotes' | 'bits', i: number): Token => {
  // For `len`, require explicit op; for `emotes`/`bits`, only `>` is in grammar.
  if (tag === 'len') {
    const op = src[i]
    if (op !== '>' && op !== '<') throw new TokenizeError('len requires > or < operator')
    const num = readNumber(src, i + 1)
    if (!num) throw new TokenizeError(`len${op} requires a number`)
    return mkToken({ kind: 'len', op, n: num.n }, num.next)
  }
  if (src[i] !== '>') throw new TokenizeError(`${tag} requires > operator`)
  const num = readNumber(src, i + 1)
  if (!num) throw new TokenizeError(`${tag}> requires a number`)
  return mkToken({ kind: tag, n: num.n }, num.next)
}

const readBarewordToken = (src: string, i: number): Token => {
  const { value, next } = readBareword(src, i)
  if (value === 'AND') return mkToken({ kind: 'and' }, next)
  if (value === 'OR') return mkToken({ kind: 'or' }, next)
  if (PRESETS.has(value as PresetName)) return mkToken({ kind: 'preset', name: value as PresetName }, next)
  return mkToken({ kind: 'keyword', value }, next)
}

export const tokenize = (src: string): Token[] => {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue }
    if (c === '(') { tokens.push({ kind: 'lparen' }); i++; continue }
    if (c === ')') { tokens.push({ kind: 'rparen' }); i++; continue }
    if (c === '!') { tokens.push({ kind: 'not' }); i++; continue }
    if (c === '"') {
      const { value, next } = readQuoted(src, i)
      tokens.push({ kind: 'phrase', value })
      i = next
      continue
    }
    // Comparison tokens start with their name followed by > or <
    if (src.startsWith('len', i) && (src[i + 3] === '>' || src[i + 3] === '<')) {
      const t = readComparisonToken(src, 'len', i + 3) as TokenWithCursor
      const { _next, ...rest } = t
      tokens.push(rest as Token)
      i = _next
      continue
    }
    if (src.startsWith('emotes', i) && src[i + 6] === '>') {
      const t = readComparisonToken(src, 'emotes', i + 6) as TokenWithCursor
      const { _next, ...rest } = t
      tokens.push(rest as Token)
      i = _next
      continue
    }
    if (src.startsWith('bits', i) && src[i + 4] === '>') {
      const t = readComparisonToken(src, 'bits', i + 4) as TokenWithCursor
      const { _next, ...rest } = t
      tokens.push(rest as Token)
      i = _next
      continue
    }
    if (isBarewordChar(c)) {
      // Look ahead for `tag:`
      const { value, next } = readBareword(src, i)
      if (src[next] === ':') {
        const t = readTaggedToken(src, value, next + 1) as TokenWithCursor
        const { _next, ...rest } = t
        tokens.push(rest as Token)
        i = _next
        continue
      }
      const t = readBarewordToken(src, i) as TokenWithCursor
      const { _next, ...rest } = t
      tokens.push(rest as Token)
      i = _next
      continue
    }
    throw new TokenizeError(`unexpected character: ${c}`)
  }
  return tokens
}
