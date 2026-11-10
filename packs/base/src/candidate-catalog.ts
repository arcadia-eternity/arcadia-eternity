import type { EffectTrigger } from '@arcadia-eternity/const'
import { Effect } from '@arcadia-eternity/battle/engine'
import { BaseMark } from '@arcadia-eternity/battle/engine'
import type { ParameterCatalog } from '@arcadia-eternity/battle/engine'
import { effectParameters, hasAuthoredParameters } from '@arcadia-eternity/battle/authoring'
import { createOfficialAuthoredEffects } from './effects/authored'
import { createPaladingEffects } from './effects/palading'
import { createKadunduduEffects } from './effects/kadundudu'
import { createBingchuantunEffects } from './effects/bingchuantun'
import { generatedStatStageCandidates } from './effects/stat-stages.generated'
import { officialRageCandidate } from './effects/rage'
import { createOfficialWaterShieldCandidate } from './effects/shield'
import { createWaterShieldDestruction } from './effects/water-shield-content'
import { createNamedParameterModifiers } from './effects/named-parameters'
import { createRainWaterShield } from './effects/rain-water-shield'
import { createRandomTemporaryEffect } from './effects/random-temporary-effect'
import { createGeneratedAttributeContributions } from './effects/attribute-contributions.generated'
import { createAutomaticStackConsumption } from './effects/automatic-stack-consumption'
import { createGeneratedContextControls } from './effects/context-controls.generated'
import { createGeneratedDamageModifierEffects } from './effects/damage-modifiers.generated'
import { createGeneratedDamageSequences } from './effects/damage-sequences.generated'
import { createGeneratedDamageThresholds } from './effects/damage-thresholds.generated'
import { createDoubleStageDebuff } from './effects/double-stage-debuff'
import { createGeneratedDynamicContributions } from './effects/dynamic-contributions.generated'
import { createEmblemSkillCost } from './effects/emblem-skill-cost'
import { createGeneratedEventCancellation } from './effects/event-cancellation.generated'
import { createLowHealthExecution } from './effects/execute-low-health'
import { createExperiencePlaceholder } from './effects/experience-placeholder'
import { createFractionalHealing } from './effects/fractional-healing'
import { createOfficialHealModifierEffects } from './effects/heal-modifiers'
import { createGeneratedIgnoreShield } from './effects/ignore-shield.generated'
import { createLastStand } from './effects/last-stand'
import { createGeneratedMarkApplicationSettings } from './effects/mark-application-settings.generated'
import { createGeneratedMarkConsumption } from './effects/mark-consumption.generated'
import { createGeneratedMarkRemovals } from './effects/mark-removals.generated'
import { createGeneratedMarkStackGains } from './effects/mark-stack-gains.generated'
import { createMarkTransfers } from './effects/mark-transfers'
import { createGeneratedMultihit } from './effects/multihit.generated'
import { createGeneratedRageAssignment } from './effects/rage-assignment.generated'
import { createGeneratedRageModifiers } from './effects/rage-modifiers.generated'
import { createRandomSkillSelection } from './effects/random-skill'
import { createRandomStatActions } from './effects/random-stat-actions'
import { createResourcePrevention } from './effects/resource-prevention'
import { createGeneratedSkillContributions } from './effects/skill-contributions.generated'
import { createGeneratedSkillDisabling } from './effects/skill-disabling.generated'
import { createGeneratedSkillFlags } from './effects/skill-flags.generated'
import { createGeneratedSkillNumericReferences } from './effects/skill-numeric-references.generated'
import { createGeneratedSkillOutcomeSequences } from './effects/skill-outcome-sequences.generated'
import { createGeneratedSkillOutcomeEffects } from './effects/skill-outcomes.generated'
import { createGeneratedSkillPowerEffects } from './effects/skill-power.generated'
import { createSkillTransformationRemoval } from './effects/skill-transformation'
import { createSkillTransformationCopy } from './effects/skill-transformation'
import { createStackTriggerProbability } from './effects/stack-trigger-probability'
import { createGeneratedStatStageClears } from './effects/stat-stage-clears.generated'
import { createGeneratedStatStageSequences } from './effects/stat-stage-sequences.generated'
import { createTaggedParameterModifiers } from './effects/tagged-parameters'
import { createGeneratedVitalActions } from './effects/vital-actions.generated'
import { createGeneratedVitalSequences } from './effects/vital-sequences.generated'
import { createConsecutiveFlyingRage } from './effects/consecutive-flying-rage'
import { createSwitchRageProtection } from './effects/switch-rage-protection'
import { createRageGainLimit } from './effects/rage-gain-limit'
import { createStackDamageEffects } from './effects/stack-damage'
import { createWeightDamageEffects } from './effects/weight-damage'
import { createWeaknessTransfer } from './effects/weakness-transfer'
import { officialHealingEffects } from './effects/healing'
import { officialDamageBenefitEffects } from './effects/damage-benefits'
import { officialConsecutiveHealingEffects } from './effects/consecutive-healing'
import { generatedInstantLiteralEffects } from './effects/instant-literals.generated'
import { createGeneratedMarkApplications } from './effects/mark-applications.generated'
import { createGeneratedCompoundActions } from './effects/compound-actions.generated'
import { createGeneratedConditionalActions } from './effects/conditional-actions.generated'
import { createRandomMarkApplications } from './effects/random-mark-applications'
import { createRandomWeatherApplication } from './effects/random-weather-application'
import { createCurseMarkApplication } from './effects/curse-mark-application'

/** Compose the reviewed native implementations with the host's canonical mark prototypes. */
export function createOfficialEffectCandidates(marks: ReadonlyMap<string, BaseMark>) {
  const effects = new Map<string, Effect<EffectTrigger>>()
  const families = new Map<string, string>()
  const parameters = new Map<string, ParameterCatalog>()
  const add = (family: string, group: Effect<EffectTrigger> | Readonly<Record<string, Effect<EffectTrigger>>>) => {
    const entries = group instanceof Effect ? [[group.id, group] as const] : Object.entries(group)
    for (const [id, effect] of entries) {
      if (!(effect instanceof Effect)) throw new Error(`Invalid candidate in ${family}`)
      if (effects.has(id)) throw new Error(`Duplicate candidate: ${id} (${families.get(id)}, ${family})`)
      effects.set(id, effect)
      families.set(id, family)
      if (hasAuthoredParameters(effect)) parameters.set(id, effectParameters(effect))
    }
  }
  const requireMark = (id: string) => {
    const mark = marks.get(id)
    if (!(mark instanceof BaseMark) || mark.id !== id) throw new Error(`Missing or mismatched official mark: ${id}`)
    return mark
  }
  add('authored', createOfficialAuthoredEffects())
  add('palading', createPaladingEffects(marks))
  add('kadundudu', createKadunduduEffects(marks))
  add('bingchuantun', createBingchuantunEffects(marks))
  add('attribute-contributions.generated', createGeneratedAttributeContributions())
  add('automatic-stack-consumption', createAutomaticStackConsumption())
  add('context-controls.generated', createGeneratedContextControls())
  add('damage-modifiers.generated', createGeneratedDamageModifierEffects())
  add('damage-sequences.generated', createGeneratedDamageSequences())
  add('damage-thresholds.generated', createGeneratedDamageThresholds())
  add('double-stage-debuff', createDoubleStageDebuff())
  add('dynamic-contributions.generated', createGeneratedDynamicContributions())
  add('emblem-skill-cost', createEmblemSkillCost())
  add('event-cancellation.generated', createGeneratedEventCancellation())
  add('execute-low-health', createLowHealthExecution())
  add('experience-placeholder', createExperiencePlaceholder())
  add('fractional-healing', createFractionalHealing())
  add('heal-modifiers', createOfficialHealModifierEffects())
  add('ignore-shield.generated', createGeneratedIgnoreShield())
  add('last-stand', createLastStand())
  add('mark-application-settings.generated', createGeneratedMarkApplicationSettings())
  add('mark-consumption.generated', createGeneratedMarkConsumption())
  add('mark-removals.generated', createGeneratedMarkRemovals())
  add('mark-stack-gains.generated', createGeneratedMarkStackGains())
  add('mark-transfers', createMarkTransfers())
  add('multihit.generated', createGeneratedMultihit())
  add('rage-assignment.generated', createGeneratedRageAssignment())
  add('rage-modifiers.generated', createGeneratedRageModifiers())
  add('random-skill', createRandomSkillSelection())
  add('random-stat-actions', createRandomStatActions())
  add('resource-prevention', createResourcePrevention())
  add('skill-contributions.generated', createGeneratedSkillContributions())
  add('skill-disabling.generated', createGeneratedSkillDisabling())
  add('skill-flags.generated', createGeneratedSkillFlags())
  add('skill-numeric-references.generated', createGeneratedSkillNumericReferences())
  add('skill-outcome-sequences.generated', createGeneratedSkillOutcomeSequences())
  add('skill-outcomes.generated', createGeneratedSkillOutcomeEffects())
  add('skill-power.generated', createGeneratedSkillPowerEffects())
  add('skill-transformation', createSkillTransformationRemoval())
  add('skill-transformation', createSkillTransformationCopy())
  add('stack-trigger-probability', createStackTriggerProbability())
  add('stat-stage-clears.generated', createGeneratedStatStageClears())
  add('stat-stage-sequences.generated', createGeneratedStatStageSequences())
  add('tagged-parameters', createTaggedParameterModifiers())
  add('vital-actions.generated', createGeneratedVitalActions())
  add('vital-sequences.generated', createGeneratedVitalSequences())
  add('consecutive-flying-rage', createConsecutiveFlyingRage())
  add('switch-rage-protection', createSwitchRageProtection())
  add('rage-gain-limit', createRageGainLimit())
  add('stack-damage', createStackDamageEffects())
  add('weight-damage', createWeightDamageEffects())
  add('weakness-transfer', createWeaknessTransfer())
  add('healing', officialHealingEffects)
  add('damage-benefits', officialDamageBenefitEffects)
  add('consecutive-healing', officialConsecutiveHealingEffects)
  add('instant-literals.generated', generatedInstantLiteralEffects)
  add('mark-applications.generated', createGeneratedMarkApplications(marks))
  add('compound-actions.generated', createGeneratedCompoundActions(marks))
  add('conditional-actions.generated', createGeneratedConditionalActions(marks))
  add('random-mark-applications', createRandomMarkApplications(marks))
  add('random-weather-application', createRandomWeatherApplication(marks))
  add('curse-mark-application', createCurseMarkApplication(marks))
  add('stat-stages.generated', generatedStatStageCandidates.effects)
  for (const [id, effect] of Object.entries(generatedStatStageCandidates.effects)) {
    if (!hasAuthoredParameters(effect)) parameters.set(id, generatedStatStageCandidates.parameters)
  }
  add('rage', officialRageCandidate.effect)
  parameters.set(officialRageCandidate.effect.id, officialRageCandidate.parameters)
  const shield = createOfficialWaterShieldCandidate(requireMark('mark_shuiwenpingzhang'))
  add('shield', shield.effect)
  parameters.set(shield.effect.id, shield.parameters)
  add('water-shield-destruction', createWaterShieldDestruction(requireMark('mark_shanghaizengjia')))
  add('named-parameters', createNamedParameterModifiers(parameters))
  add('rain-water-shield', createRainWaterShield(shield.parameters))
  add('random-temporary-effect', createRandomTemporaryEffect(effects))
  return {
    effects: effects as ReadonlyMap<string, Effect<EffectTrigger>>,
    families: families as ReadonlyMap<string, string>,
    parameters: parameters as ReadonlyMap<string, ParameterCatalog>,
  }
}
