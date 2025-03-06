// 统一效果触发阶段

export const enum EffectTrigger {
  OnBattleStart = 'OnBattleStart',

  //以下EffectTrigger下的，context的parent一定是UseSkillContext
  BeforeSort = 'BeforeSort',
  BeforeUseSkillCheck = 'BeforeUseSkillCheck',
  AfterUseSkillCheck = 'AfterUseSkillCheck',
  BeforeHit = 'BeforeHit',
  OnCritPreDamage = 'OnCritPreDamage',
  PreDamage = 'PreDamage',
  OnHit = 'OnHit',
  OnMiss = 'OnMiss',
  AfterAttacked = 'AfterAttacked',
  OnDefeat = 'OnDefeat',

  //以下context的parent一定是DamageContext
  OnDamage = 'OnDamage',
  Shield = 'Shield', //专门用于处理护盾效果的Trigger,可以被“无视护盾类效果”给无视
  PostDamage = 'PostDamage',
  OnCritPostDamage = 'OnCritPostDamage',

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
