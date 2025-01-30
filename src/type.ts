// 宝可梦属性类型
export enum Type {
  Normal = 'Normal',
  Fire = 'Fire',
  Water = 'Water',
  Electric = 'Electric',
  Grass = 'Grass',
  Ice = 'Ice',
  Fighting = 'Fighting',
  Poison = 'Poison',
  Ground = 'Ground',
  Flying = 'Flying',
  Psychic = 'Psychic',
  Bug = 'Bug',
  Rock = 'Rock',
  Ghost = 'Ghost',
  Dragon = 'Dragon',
}

// 属性相克表
export const TYPE_CHART: Record<Type, Partial<Record<Type, number>>> = {
  [Type.Normal]: {},
  [Type.Fire]: { [Type.Grass]: 2, [Type.Fire]: 0.5, [Type.Water]: 0.5 },
  [Type.Water]: { [Type.Fire]: 2, [Type.Water]: 0.5, [Type.Grass]: 0.5 },
  [Type.Electric]: { [Type.Water]: 2, [Type.Electric]: 0.5, [Type.Grass]: 0.5 },
  [Type.Grass]: { [Type.Water]: 2, [Type.Fire]: 0.5, [Type.Grass]: 0.5 },
  [Type.Ice]: {},
  [Type.Fighting]: {},
  [Type.Poison]: {},
  [Type.Ground]: {},
  [Type.Flying]: {},
  [Type.Psychic]: {},
  [Type.Bug]: {},
  [Type.Rock]: {},
  [Type.Ghost]: {},
  [Type.Dragon]: {},
}
