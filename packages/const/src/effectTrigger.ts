// 统一效果触发阶段

export enum EffectTrigger {
  OnBattleStart = 'OnBattleStart',

  //以下EffectTrigger下的，context的parent一定是UseSkillContext
  BeforeSort = 'BeforeSort',
  BeforeUseSkillCheck = 'BeforeUseSkillCheck',
  AfterUseSkillCheck = 'AfterUseSkillCheck',
  BeforeMultiHit = 'BeforeMultiHit',
  BeforeHit = 'BeforeHit',
  OnCritPreDamage = 'OnCritPreDamage',
  PreDamage = 'PreDamage',
  OnHit = 'OnHit',
  OnMiss = 'OnMiss',
  AfterAttacked = 'AfterAttacked',
  OnDefeat = 'OnDefeat',

  //以下context的parent一定是DamageContext
  OnBeforeCalculateDamage = 'OnBeforeCalculateDamage',
  OnDamage = 'OnDamage',
  Shield = 'Shield', //专门用于处理护盾效果的Trigger,可以被“无视护盾类效果”给无视
  PostDamage = 'PostDamage',
  OnCritPostDamage = 'OnCritPostDamage',

  // 印记相关
  TurnStart = 'TurnStart',
  TurnEnd = 'TurnEnd',

  //仅作用于自身触发
  OnBeforeAddMark = 'OnBeforeAddMark',
  OnAnyMarkAdded = 'OnAnyMarkAdded', // 所有实体都会响应印记添加事件
  OnRemoveMark = 'OnRemoveMark',

  OnMarkCreated = 'OnMarkCreated', // 只有被创建的印记才会响应
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

  OnUpdateStat = 'OnUpdateStat',
}
