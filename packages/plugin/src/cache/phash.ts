export function computePHash(): string | null {
  return null
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity
  let dist = 0
  for (let i = 0; i < a.length; i++) {
    const xa = parseInt(a[i]!, 16)
    const xb = parseInt(b[i]!, 16)
    dist += (xa ^ xb).toString(2).replace(/0/g, "").length
  }
  return dist
}
