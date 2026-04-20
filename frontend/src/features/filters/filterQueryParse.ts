import type { PresetName, RiskBand, Role, Token } from './filterQueryTokens'
import { TokenizeError, tokenize } from './filterQueryTokens'

export type FilterQuery =
  | { kind: 'and'; children: FilterQuery[] }
  | { kind: 'or'; children: FilterQuery[] }
  | { kind: 'not'; child: FilterQuery }
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

export class ParseError extends Error {}

type Cursor = { i: number }

const peek = (tokens: Token[], c: Cursor): Token | undefined => tokens[c.i]
const consume = (tokens: Token[], c: Cursor): Token => {
  const t = tokens[c.i]
  if (!t) throw new ParseError('unexpected end of input')
  c.i++
  return t
}

const isAtomStart = (t: Token | undefined): boolean => {
  if (!t) return false
  switch (t.kind) {
    case 'and':
    case 'or':
    case 'rparen':
      return false
    default:
      return true
  }
}

const parseAtom = (tokens: Token[], c: Cursor): FilterQuery => {
  const t = consume(tokens, c)
  if (t.kind === 'lparen') {
    const inner = parseOr(tokens, c)
    const close = peek(tokens, c)
    if (!close || close.kind !== 'rparen') throw new ParseError('unbalanced parenthesis')
    c.i++
    return inner
  }
  switch (t.kind) {
    case 'keyword':
      return { kind: 'keyword', value: t.value }
    case 'phrase':
      return { kind: 'phrase', value: t.value }
    case 'regex':
      return { kind: 'regex', pattern: t.pattern }
    case 'role':
      return { kind: 'role', role: t.role }
    case 'len':
      return { kind: 'len', op: t.op, n: t.n }
    case 'emotes':
      return { kind: 'emotes', n: t.n }
    case 'bits':
      return { kind: 'bits', n: t.n }
    case 'user':
      return { kind: 'user', login: t.login }
    case 'preset':
      return { kind: 'preset', name: t.name }
    case 'risk':
      return { kind: 'risk', band: t.band }
    case 'rparen':
      throw new ParseError('unbalanced parenthesis')
    default:
      throw new ParseError(`unexpected token: ${t.kind}`)
  }
}

const parseNot = (tokens: Token[], c: Cursor): FilterQuery => {
  if (peek(tokens, c)?.kind === 'not') {
    c.i++
    return { kind: 'not', child: parseNot(tokens, c) }
  }
  return parseAtom(tokens, c)
}

const parseAnd = (tokens: Token[], c: Cursor): FilterQuery => {
  const first = parseNot(tokens, c)
  const children: FilterQuery[] = [first]
  while (true) {
    const t = peek(tokens, c)
    if (!t) break
    if (t.kind === 'and') {
      c.i++
      children.push(parseNot(tokens, c))
      continue
    }
    if (isAtomStart(t) || t.kind === 'not' || t.kind === 'lparen') {
      // Implicit AND between adjacent atoms / `!` / `(`
      children.push(parseNot(tokens, c))
      continue
    }
    break
  }
  if (children.length === 1) return children[0]
  return { kind: 'and', children }
}

const parseOr = (tokens: Token[], c: Cursor): FilterQuery => {
  const first = parseAnd(tokens, c)
  const children: FilterQuery[] = [first]
  while (peek(tokens, c)?.kind === 'or') {
    c.i++
    children.push(parseAnd(tokens, c))
  }
  if (children.length === 1) return children[0]
  return { kind: 'or', children }
}

export const parse = (src: string): { query: FilterQuery | null; error: string | null } => {
  const trimmed = src.trim()
  if (!trimmed) return { query: null, error: null }
  let tokens: Token[]
  try {
    tokens = tokenize(src)
  } catch (e) {
    if (e instanceof TokenizeError) return { query: null, error: e.message }
    return { query: null, error: (e as Error).message }
  }
  try {
    const c: Cursor = { i: 0 }
    const q = parseOr(tokens, c)
    if (c.i !== tokens.length) {
      const rest = tokens[c.i]
      if (rest.kind === 'rparen') return { query: null, error: 'unbalanced parenthesis' }
      throw new ParseError(`unexpected token: ${rest.kind}`)
    }
    return { query: q, error: null }
  } catch (e) {
    return { query: null, error: (e as Error).message }
  }
}
