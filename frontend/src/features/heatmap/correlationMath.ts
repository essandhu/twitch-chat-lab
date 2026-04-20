const mean = (xs: number[]): number => {
  let sum = 0
  for (let i = 0; i < xs.length; i++) sum += xs[i]
  return sum / xs.length
}

const variance = (xs: number[], mu: number): number => {
  let s = 0
  for (let i = 0; i < xs.length; i++) {
    const d = xs[i] - mu
    s += d * d
  }
  return s
}

export const pearson = (a: number[], b: number[]): number => {
  if (a.length !== b.length) return Number.NaN
  if (a.length < 2) return Number.NaN
  const ma = mean(a)
  const mb = mean(b)
  const va = variance(a, ma)
  const vb = variance(b, mb)
  if (va === 0 || vb === 0) return Number.NaN
  let cov = 0
  for (let i = 0; i < a.length; i++) cov += (a[i] - ma) * (b[i] - mb)
  return cov / Math.sqrt(va * vb)
}

export interface LaggedPearsonResult {
  bestLagSeconds: number
  coefficient: number
  perLag: { lag: number; coefficient: number }[]
}

export const laggedPearson = (
  a: number[],
  b: number[],
  maxLagSeconds: number,
): LaggedPearsonResult => {
  const perLag: { lag: number; coefficient: number }[] = []
  for (let lag = -maxLagSeconds; lag <= maxLagSeconds; lag++) {
    let slicedA: number[]
    let slicedB: number[]
    if (lag >= 0) {
      // B trails A by `lag`: pair a[0..n-lag] with b[lag..n]
      slicedA = a.slice(0, a.length - lag)
      slicedB = b.slice(lag)
    } else {
      const k = -lag
      slicedA = a.slice(k)
      slicedB = b.slice(0, b.length - k)
    }
    perLag.push({ lag, coefficient: pearson(slicedA, slicedB) })
  }
  let bestLagSeconds = 0
  let best = Number.NEGATIVE_INFINITY
  for (const { lag, coefficient } of perLag) {
    if (Number.isNaN(coefficient)) continue
    const abs = Math.abs(coefficient)
    if (abs > best || (abs === best && Math.abs(lag) < Math.abs(bestLagSeconds))) {
      best = abs
      bestLagSeconds = lag
    }
  }
  const bestEntry = perLag.find((e) => e.lag === bestLagSeconds)
  return {
    bestLagSeconds,
    coefficient: bestEntry ? bestEntry.coefficient : Number.NaN,
    perLag,
  }
}
