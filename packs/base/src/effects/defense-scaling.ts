export function defensePowerBonus(defense: number, divisor: number) {
  return Math.min(100, Math.floor(defense / divisor))
}

export function defenseHitCount(defense: number) {
  return Math.max(1, Math.min(6, Math.floor(defense / 100)))
}
