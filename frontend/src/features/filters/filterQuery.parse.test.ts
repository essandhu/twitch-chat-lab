import { describe, expect, it } from 'vitest'
import { parse, tokenize } from './filterQuery'

describe('tokenize', () => {
  it('tokenizes bare keyword', () => {
    const t = tokenize('hello')
    expect(t).toEqual([{ kind: 'keyword', value: 'hello' }])
  })

  it('tokenizes quoted phrase with kw:', () => {
    const t = tokenize('kw:"phrase with spaces"')
    expect(t).toEqual([{ kind: 'phrase', value: 'phrase with spaces' }])
  })

  it('tokenizes regex with flags', () => {
    const t = tokenize('regex:/foo\\d+/i')
    expect(t).toHaveLength(1)
    expect(t[0].kind).toBe('regex')
    if (t[0].kind === 'regex') {
      expect(t[0].pattern.source).toBe('foo\\d+')
      expect(t[0].pattern.flags).toContain('i')
    }
  })

  it('tokenizes role: variants', () => {
    for (const role of ['mod', 'vip', 'sub', 'broadcaster', 'firstTimer']) {
      const t = tokenize(`role:${role}`)
      expect(t).toEqual([{ kind: 'role', role }])
    }
  })

  it('tokenizes len>N and len<N', () => {
    expect(tokenize('len>5')).toEqual([{ kind: 'len', op: '>', n: 5 }])
    expect(tokenize('len<42')).toEqual([{ kind: 'len', op: '<', n: 42 }])
  })

  it('tokenizes emotes>N and bits>N', () => {
    expect(tokenize('emotes>2')).toEqual([{ kind: 'emotes', n: 2 }])
    expect(tokenize('bits>100')).toEqual([{ kind: 'bits', n: 100 }])
  })

  it('tokenizes user:login', () => {
    expect(tokenize('user:SomeName')).toEqual([{ kind: 'user', login: 'somename' }])
  })

  it('tokenizes preset shorthands', () => {
    expect(tokenize('firstTimer')).toEqual([{ kind: 'preset', name: 'firstTimer' }])
    expect(tokenize('sub')).toEqual([{ kind: 'preset', name: 'sub' }])
    expect(tokenize('hype')).toEqual([{ kind: 'preset', name: 'hype' }])
  })

  it('tokenizes risk:band', () => {
    for (const band of ['calm', 'elevated', 'high', 'critical']) {
      const t = tokenize(`risk:${band}`)
      expect(t).toEqual([{ kind: 'risk', band }])
    }
  })

  it('tokenizes boolean operators and parens', () => {
    const t = tokenize('a AND b OR !c (d)')
    expect(t.map((x) => x.kind)).toEqual([
      'keyword',
      'and',
      'keyword',
      'or',
      'not',
      'keyword',
      'lparen',
      'keyword',
      'rparen',
    ])
  })
})

describe('parse', () => {
  it('returns null AST for empty input', () => {
    expect(parse('')).toEqual({ query: null, error: null })
    expect(parse('   ')).toEqual({ query: null, error: null })
  })

  it('parses single keyword', () => {
    const { query, error } = parse('hello')
    expect(error).toBeNull()
    expect(query).toEqual({ kind: 'keyword', value: 'hello' })
  })

  it('parses implicit AND between adjacent atoms', () => {
    const { query, error } = parse('foo bar')
    expect(error).toBeNull()
    expect(query).toMatchObject({
      kind: 'and',
      children: [
        { kind: 'keyword', value: 'foo' },
        { kind: 'keyword', value: 'bar' },
      ],
    })
  })

  it('parses explicit AND', () => {
    const { query } = parse('foo AND bar')
    expect(query).toMatchObject({
      kind: 'and',
      children: [
        { kind: 'keyword', value: 'foo' },
        { kind: 'keyword', value: 'bar' },
      ],
    })
  })

  it('parses OR with lower precedence than AND', () => {
    const { query } = parse('a OR b AND c')
    // Expected: a OR (b AND c)
    expect(query).toMatchObject({
      kind: 'or',
      children: [
        { kind: 'keyword', value: 'a' },
        {
          kind: 'and',
          children: [
            { kind: 'keyword', value: 'b' },
            { kind: 'keyword', value: 'c' },
          ],
        },
      ],
    })
  })

  it('respects parentheses overriding precedence', () => {
    const { query } = parse('(a OR b) AND c')
    expect(query).toMatchObject({
      kind: 'and',
      children: [
        {
          kind: 'or',
          children: [
            { kind: 'keyword', value: 'a' },
            { kind: 'keyword', value: 'b' },
          ],
        },
        { kind: 'keyword', value: 'c' },
      ],
    })
  })

  it('parses NOT with highest precedence', () => {
    const { query } = parse('!a')
    expect(query).toMatchObject({ kind: 'not', child: { kind: 'keyword', value: 'a' } })
  })

  it('parses nested NOT', () => {
    const { query } = parse('!!a')
    expect(query).toMatchObject({
      kind: 'not',
      child: { kind: 'not', child: { kind: 'keyword', value: 'a' } },
    })
  })

  it('surfaces unterminated quote error', () => {
    const { query, error } = parse('kw:"never ends')
    expect(query).toBeNull()
    expect(error).toMatch(/unterminated quote/i)
  })

  it('surfaces invalid regex error', () => {
    const { query, error } = parse('regex:/[/')
    expect(query).toBeNull()
    expect(error).toMatch(/invalid regex/i)
  })

  it('surfaces unbalanced parenthesis error', () => {
    const { error } = parse('(a OR b')
    expect(error).toMatch(/unbalanced parenthesis/i)
  })

  it('surfaces stray close paren as unbalanced', () => {
    const { error } = parse('a)')
    expect(error).toMatch(/unbalanced parenthesis/i)
  })

  it('rejects unknown role values', () => {
    const { error } = parse('role:whatever')
    expect(error).not.toBeNull()
  })

  it('rejects missing number after len>', () => {
    const { error } = parse('len>')
    expect(error).not.toBeNull()
  })

  it('parses complex composition', () => {
    const { query, error } = parse('kw:"pog" AND (role:sub OR sub) AND !len<5')
    expect(error).toBeNull()
    expect(query).not.toBeNull()
  })
})
