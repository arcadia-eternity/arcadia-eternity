// 统一效果触发阶段

export enum EffectTrigger {
  OnBattleStart = 'OnBattleStart',

  //以下EffectTrigger下的，context的parent一定是UseSkillContext
  BeforeSort = 'BeforeSort',
  BeforeAttack = 'BeforeAttack',
  PreDamage = 'PreDamage',
  OnCritPreDamage = 'OnCritPreDamage',
  OnDamage = 'OnDamage',
  Shield = 'Shield', //专门用于处理护盾效果的Trigger,可以被“无视护盾类效果”给无视
  PostDamage = 'PostDamage',
  OnCritPostDamage = 'OnCritPostDamage',
  OnBeforeHit = 'OnBeforeHit',
  OnHit = 'OnHit',
  OnMiss = 'OnMiss',
  AfterAttacked = 'AfterAttacked',
  OnDefeat = 'OnDefeat',

  // 印记相关
  TurnStart = 'TurnStart',
  TurnEnd = 'TurnEnd',

  //仅作用于自身触发
  OnAddMark = 'OnAddMark',
  OnRemoveMark = 'OnRemoveMark',

  OnMarkCreate = 'OnMarkCreate',
  OnMarkDestroy = 'OnMarkDestroy',

  OnMarkDurationEnd = 'OnMarkDurationEnd',

  //以下一定是EffectContext
  OnStack = 'OnStack',
  OnHeal = 'OnHeal',
  OnRageGain = 'OnRageGain',
  OnRageLoss = 'OnRageLoss',

  OnSwitchIn = 'OnSwitchIn',
  OnSwitchOut = 'OnSwitchOut',
  OnOwnerSwitchIn = 'OnOwnerSwitchIn',
  OnOwnerSwitchOut = 'OnOwnerSwitchOut',

  BeforeEffect = 'BeforeEffect',
  AfterEffect = 'AfterEffect',
}

export enum EffectScope {
  global = 'global',
  self = 'self',
  source = 'source',
  target = 'target',
}
