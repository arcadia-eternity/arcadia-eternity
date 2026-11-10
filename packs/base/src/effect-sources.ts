declare module 'virtual:arcadia-effects' {
  export const effectSources: readonly import('@arcadia-eternity/battle/effect-loading').EffectSource[]
  export const createCatalog: (
    marks: ReadonlyMap<string, import('@arcadia-eternity/battle/authoring').BaseMark>,
  ) => ReturnType<typeof import('@arcadia-eternity/battle/effect-loading').loadEffectGroups>
  export const createEffects: (
    context: import('@arcadia-eternity/battle/authoring').CodeEffectModuleContext,
  ) => readonly import('@arcadia-eternity/battle/authoring').NativeBehaviorExport[]
}
