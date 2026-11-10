import type { WorkRecord } from '@arcadia-eternity/pack-loader/native'

export function defaultRecord(kind: 'species' | 'skill' | 'mark', id: string): WorkRecord {
  if (kind === 'skill')
    return {
      id,
      name: '新技能',
      element: 'Normal',
      category: 'Physical',
      power: 40,
      rage: 0,
      accuracy: 100,
      priority: 0,
      behaviors: [],
    }
  if (kind === 'mark')
    return { id, name: '新印记', config: { duration: 3, maxStacks: 1, stackable: false }, behaviors: [] }
  return {
    id,
    name: '新精灵',
    num: 1,
    element: 'Normal',
    baseStats: { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
    genderRatio: null,
    heightRange: [1, 2],
    weightRange: [1, 2],
    ability: [],
    emblem: [],
    learnable_skills: [],
  }
}
