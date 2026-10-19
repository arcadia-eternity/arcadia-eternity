import { GameRng } from '@arcadia-eternity/battle/v4'

// Exercise both sides within one percentage point of the declared threshold.
export function thresholdSeeds(percent: number): number[] {
  const result: (number | undefined)[] = [undefined, undefined]
  for (let seed = 0; seed < 10000 && result.some(value => value === undefined); seed++) {
    const draw = new GameRng(seed).next() * 100
    if (Math.abs(draw - percent) < 1) result[draw < percent ? 0 : 1] ??= seed
  }
  if (result.some(value => value === undefined)) throw new Error(`Cannot bracket probability ${percent}`)
  return result as number[]
}
