const shieldedIds = new Set<string>()

export const deleteShield = {
  has(id: string): boolean {
    return shieldedIds.has(id)
  },
  add(id: string): void {
    shieldedIds.add(id)
  },
  delete(id: string): void {
    shieldedIds.delete(id)
  },
}
