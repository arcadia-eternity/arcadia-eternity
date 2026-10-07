import type { OperatorDSL } from '@arcadia-eternity/schema'

/**
 * Returns a human-readable Chinese hint explaining WHY a field on an operator
 * has its typing constraint, based on the engine's runtime behavior.
 */
export function getOperatorFieldHint(
  opType: OperatorDSL['type'] | undefined,
  fieldName: string | undefined,
): string | undefined {
  if (!opType || !fieldName) return undefined

  const specific: Partial<Record<OperatorDSL['type'], Partial<Record<string, string>>>> = {
    dealDamage: {
      target: '引擎仅对宠物实体造成伤害',
      value: '期望数值类型（伤害值）',
    },
    heal: {
      target: '引擎仅对宠物实体执行治疗',
      value: '期望数值类型（治疗量）',
    },
    addRage: {
      target: '怒气属于玩家，选择宠物/技能/标记/玩家均可，引擎自动向上查找所属玩家',
      value: '期望数值类型（怒气值）',
    },
    setRage: {
      target: '怒气属于玩家，选择宠物/技能/标记/玩家均可，引擎自动向上查找所属玩家',
      value: '期望数值类型（怒气值）',
    },
    addMark: {
      target: '标记可挂在宠物或战斗实体上',
      mark: '期望标记引用或标记ID',
      duration: '期望数值类型（持续回合数）',
      stack: '期望数值类型（初始堆叠数）',
    },
    addStacks: {
      target: '引擎仅对标记实体增加堆叠',
      value: '期望数值类型（增加的堆叠数）',
    },
    consumeStacks: {
      target: '引擎仅对标记实体消耗堆叠',
      value: '期望数值类型（消耗的堆叠数）',
    },
    modifyStackResult: {
      target: '此字段需要上下文对象（如 addMarkContext），由添加标记事件自动注入',
      newStacks: '期望数值类型（修改后的堆叠数）',
      newDuration: '期望数值类型（修改后的持续回合）',
    },
    addAttributeModifier: {
      target: '属性修正器可作用于宠物/技能/标记/玩家，运行时按属性key校验合法性',
      stat: '期望属性名称字符串（如 attack、defense 等）',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      value: '期望数值类型（修正值）',
      priority: '期望数值类型（修正优先级，数值越小越先计算）',
    },
    addDynamicAttributeModifier: {
      target: '属性修正器可作用于宠物/技能/标记/玩家，运行时按属性key校验合法性',
      observableValue: '期望选择器，运行时从目标实体提取动态值',
      stat: '期望属性名称字符串',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      priority: '期望数值类型（修正优先级）',
    },
    addSkillAttributeModifier: {
      target: '引擎仅对技能实体添加属性修正',
      attribute: '期望技能属性名称字符串',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      value: '期望数值类型（修正值）',
      priority: '期望数值类型（修正优先级）',
    },
    addDynamicSkillAttributeModifier: {
      target: '引擎仅对技能实体添加动态属性修正',
      observableValue: '期望选择器，运行时从目标实体提取动态值',
      attribute: '期望技能属性名称字符串',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      priority: '期望数值类型（修正优先级）',
    },
    setSkill: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      value: '期望技能引用或技能ID',
    },
    setActualTarget: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      newTarget: '期望宠物实体选择器',
    },
    amplifyPower: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      value: '期望数值类型（威力增幅百分比）',
    },
    addPower: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      value: '期望数值类型（增加的威力值）',
    },
    addCritRate: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      value: '期望数值类型（增加的暴击率）',
    },
    addAccuracy: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      value: '期望数值类型（增加的命中率）',
    },
    setAccuracy: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      value: '期望数值类型（设置的命中率）',
    },
    addMultihitResult: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      value: '期望数值类型（多段攻击次数）',
    },
    setMultihit: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      value: '期望数值类型（多段攻击次数）',
    },
    addModified: {
      target: '此字段需要上下文对象（如 damageContext），由伤害事件自动注入',
      delta: '期望数值类型（固定伤害增量）',
      percent: '期望数值类型（伤害百分比修正）',
    },
    addThreshold: {
      target: '需要伤害上下文（damageContext），由伤害事件自动注入',
      min: '期望数值类型（最小伤害阈值）',
      max: '期望数值类型（最大伤害阈值）',
    },
    overrideMarkConfig: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      config: '期望JSON对象（标记配置覆盖）',
    },
    setIgnoreStageStrategy: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      value: '期望字符串（忽略能力等级策略名称）',
    },
    setSureHit: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      priority: '期望数值类型（优先级，数值越小越优先）',
    },
    setSureCrit: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      priority: '期望数值类型（优先级，数值越小越优先）',
    },
    setSureMiss: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      priority: '期望数值类型（优先级，数值越小越优先）',
    },
    setSureNoCrit: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
      priority: '期望数值类型（优先级，数值越小越优先）',
    },
    setIgnoreShield: {
      target: '需要技能上下文（useSkillContext），由技能触发事件自动注入',
    },
    stun: {
      target: '此字段需要上下文对象，由触发时机自动注入',
    },
    preventDamage: {
      target: '此字段需要上下文对象，由触发时机自动注入',
    },
    disableContext: {
      target: '此字段需要上下文对象，由触发时机自动注入',
    },
    setMarkDuration: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望数值类型（持续回合数）',
    },
    setMarkStack: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望数值类型（堆叠数）',
    },
    setMarkMaxStack: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望数值类型（最大堆叠数）',
    },
    setMarkPersistent: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望布尔类型（是否常驻）',
    },
    setMarkStackable: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望布尔类型（是否可堆叠）',
    },
    setMarkStackStrategy: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望字符串（堆叠策略名称）',
    },
    setMarkDestroyable: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望布尔类型（是否可销毁）',
    },
    setMarkIsShield: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望布尔类型（是否为护盾）',
    },
    setMarkKeepOnSwitchOut: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望布尔类型（下场是否保留）',
    },
    setMarkTransferOnSwitch: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望布尔类型（换宠是否转移）',
    },
    setMarkInheritOnFaint: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望布尔类型（濒死是否继承）',
    },
    setStatLevelMarkLevel: {
      target: '需要添加标记上下文（addMarkContext），由添加标记事件自动注入',
      value: '期望数值类型（能力等级标记等级）',
    },
    transform: {
      target: '变身可作用于任意实体（宠物/技能等）',
      newBase: '期望物种引用或物种ID',
      priority: '期望数值类型（变身优先级）',
    },
    transformWithPreservation: {
      target: '变身可作用于任意实体（宠物/技能等）',
      newBase: '期望物种引用或物种ID',
      priority: '期望数值类型（变身优先级）',
    },
    removeTransformation: {
      target: '变身可作用于任意实体（宠物/技能等）',
    },
    executeActions: {
      target: '期望内嵌操作符对象（DSL operator）',
    },
    addTemporaryEffect: {
      target: '临时效果可挂载到任意实体，引擎不做类型校验',
      effect: '期望效果引用或效果定义对象',
    },
    setConfig: {
      target: '配置系统为全局存储，target字段运行时被忽略',
      key: '期望字符串（配置键名）',
      value: '期望任意类型（配置值）',
    },
    registerConfig: {
      target: '配置系统为全局存储，target字段运行时被忽略',
      configKey: '期望字符串（配置键名）',
      initialValue: '期望任意类型（初始值）',
    },
    registerTaggedConfig: {
      target: '配置系统为全局存储，target字段运行时被忽略',
      configKey: '期望字符串（配置键名）',
      initialValue: '期望任意类型（初始值）',
      tags: '期望字符串或字符串数组（标签）',
    },
    addConfigModifier: {
      target: '配置系统为全局存储，target字段运行时被忽略',
      configKey: '期望字符串（配置键名）',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      value: '期望数值类型（修正值）',
      priority: '期望数值类型（修正优先级）',
    },
    addDynamicConfigModifier: {
      target: '配置系统为全局存储，target字段运行时被忽略',
      observableValue: '期望选择器，运行时从目标实体提取动态值',
      configKey: '期望字符串（配置键名）',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      priority: '期望数值类型（修正优先级）',
    },
    addTaggedConfigModifier: {
      target: '配置系统为全局存储，target字段运行时被忽略',
      tag: '期望字符串（标签名）',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      value: '期望数值类型（修正值）',
      priority: '期望数值类型（修正优先级）',
    },
    addPhaseConfigModifier: {
      target: '配置系统为全局存储，target字段运行时被忽略',
      configKey: '期望字符串（配置键名）',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      value: '期望数值类型（修正值）',
      priority: '期望数值类型（修正优先级）',
    },
    addPhaseDynamicConfigModifier: {
      target: '配置系统为全局存储，target字段运行时被忽略',
      observableValue: '期望选择器，运行时从目标实体提取动态值',
      configKey: '期望字符串（配置键名）',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      priority: '期望数值类型（修正优先级）',
    },
    addPhaseTypeConfigModifier: {
      target: '配置系统为全局存储，target字段运行时被忽略',
      configKey: '期望字符串（配置键名）',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      value: '期望数值类型（修正值）',
      priority: '期望数值类型（修正优先级）',
    },
    addDynamicPhaseTypeConfigModifier: {
      target: '配置系统为全局存储，target字段运行时被忽略',
      observableValue: '期望选择器，运行时从目标实体提取动态值',
      configKey: '期望字符串（配置键名）',
      modifierType: '期望修正类型（add/multiply/replace/set）',
      priority: '期望数值类型（修正优先级）',
    },
    statStageBuff: {
      target: '引擎仅对宠物实体执行能力升降',
      statType: '期望能力类型字符串（如 atk、def、spa 等）',
      value: '期望数值类型（升降级数）',
    },
    clearStatStage: {
      target: '引擎仅对宠物实体清除能力等级',
      statType: '期望能力类型字符串（如 atk、def、spa 等）',
    },
    reverseStatStage: {
      target: '引擎仅对宠物实体反转能力等级',
      statType: '期望能力类型字符串（如 atk、def、spa 等）',
    },
    transferStatStage: {
      source: '引擎仅对宠物实体转移能力等级',
      target: '引擎仅对宠物实体转移能力等级',
      statType: '期望能力类型字符串（如 atk、def、spa 等）',
    },
    transferMark: {
      target: '引擎仅对宠物实体转移标记',
      mark: '期望标记引用或标记ID',
    },
    destroyMark: {
      target: '引擎仅对标记实体执行销毁',
    },
    executeKill: {
      target: '引擎仅对宠物实体执行处决',
    },
    addClampMaxModifier: {
      target: '属性修正器可作用于宠物/技能/标记/玩家，运行时按属性key校验合法性',
      stat: '期望属性名称字符串',
      maxValue: '期望数值类型（上限值）',
      priority: '期望数值类型（修正优先级）',
    },
    addClampMinModifier: {
      target: '属性修正器可作用于宠物/技能/标记/玩家，运行时按属性key校验合法性',
      stat: '期望属性名称字符串',
      minValue: '期望数值类型（下限值）',
      priority: '期望数值类型（修正优先级）',
    },
    addClampModifier: {
      target: '属性修正器可作用于宠物/技能/标记/玩家，运行时按属性key校验合法性',
      stat: '期望属性名称字符串',
      minValue: '期望数值类型（下限值）',
      maxValue: '期望数值类型（上限值）',
      priority: '期望数值类型（修正优先级）',
    },
    addSkillClampMaxModifier: {
      target: '引擎仅对技能实体添加上限修正',
      attribute: '期望技能属性名称字符串',
      maxValue: '期望数值类型（上限值）',
      priority: '期望数值类型（修正优先级）',
    },
    addSkillClampMinModifier: {
      target: '引擎仅对技能实体添加下限修正',
      attribute: '期望技能属性名称字符串',
      minValue: '期望数值类型（下限值）',
      priority: '期望数值类型（修正优先级）',
    },
    addSkillClampModifier: {
      target: '引擎仅对技能实体添加区间修正',
      attribute: '期望技能属性名称字符串',
      minValue: '期望数值类型（下限值）',
      maxValue: '期望数值类型（上限值）',
      priority: '期望数值类型（修正优先级）',
    },
    setValue: {
      target: '属性引用，指向实体的可写属性路径',
    },
    addValue: {
      target: '属性引用，指向实体的可写属性路径',
      value: '期望数值类型（增加值）',
    },
    toggle: {
      target: '属性引用，指向实体的可写属性路径',
    },
  }

  const opHints = specific[opType]
  if (opHints) {
    const hint = opHints[fieldName]
    if (hint) return hint
  }

  return undefined
}
