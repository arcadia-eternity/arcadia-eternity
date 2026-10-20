import type { EffectTrigger } from '@arcadia-eternity/const'
import { Effect } from '../effect'
import { BaseMark } from '../mark'
import type { ParameterCatalog } from '../content/parameters'
import { effectParameters, hasAuthoredParameters } from '../content/authoring/runtime'
import { createOfficialAuthoredEffects } from './authored'
import { generatedStatStageCandidates } from './stat-stages.generated'
import { officialRageCandidate } from './rage'
import { createOfficialWaterShieldCandidate } from './shield'
import { createWaterShieldDestruction } from './water-shield-content'
import { createNamedParameterModifiers } from './named-parameters'
import { createRainWaterShield } from './rain-water-shield'
import { createRandomTemporaryEffect } from './random-temporary-effect'
import { createGeneratedAttributeContributions } from './attribute-contributions.generated'
import { createAutomaticStackConsumption } from './automatic-stack-consumption'
import { createGeneratedContextControls } from './context-controls.generated'
import { createGeneratedDamageModifierEffects } from './damage-modifiers.generated'
import { createGeneratedDamageSequences } from './damage-sequences.generated'
import { createGeneratedDamageThresholds } from './damage-thresholds.generated'
import { createDoubleStageDebuff } from './double-stage-debuff'
import { createGeneratedDynamicContributions } from './dynamic-contributions.generated'
import { createEmblemSkillCost } from './emblem-skill-cost'
import { createGeneratedEventCancellation } from './event-cancellation.generated'
import { createLowHealthExecution } from './execute-low-health'
import { createExperiencePlaceholder } from './experience-placeholder'
import { createFractionalHealing } from './fractional-healing'
import { createOfficialHealModifierEffects } from './heal-modifiers'
import { createGeneratedIgnoreShield } from './ignore-shield.generated'
import { createLastStand } from './last-stand'
import { createGeneratedMarkApplicationSettings } from './mark-application-settings.generated'
import { createGeneratedMarkConsumption } from './mark-consumption.generated'
import { createGeneratedMarkRemovals } from './mark-removals.generated'
import { createGeneratedMarkStackGains } from './mark-stack-gains.generated'
import { createMarkTransfers } from './mark-transfers'
import { createGeneratedMultihit } from './multihit.generated'
import { createGeneratedRageAssignment } from './rage-assignment.generated'
import { createGeneratedRageModifiers } from './rage-modifiers.generated'
import { createRandomSkillSelection } from './random-skill'
import { createRandomStatActions } from './random-stat-actions'
import { createResourcePrevention } from './resource-prevention'
import { createGeneratedSkillContributions } from './skill-contributions.generated'
import { createGeneratedSkillDisabling } from './skill-disabling.generated'
import { createGeneratedSkillFlags } from './skill-flags.generated'
import { createGeneratedSkillNumericReferences } from './skill-numeric-references.generated'
import { createGeneratedSkillOutcomeSequences } from './skill-outcome-sequences.generated'
import { createGeneratedSkillOutcomeEffects } from './skill-outcomes.generated'
import { createGeneratedSkillPowerEffects } from './skill-power.generated'
import { createSkillTransformationRemoval } from './skill-transformation'
import { createSkillTransformationCopy } from './skill-transformation'
import { createStackTriggerProbability } from './stack-trigger-probability'
import { createGeneratedStatStageClears } from './stat-stage-clears.generated'
import { createGeneratedStatStageSequences } from './stat-stage-sequences.generated'
import { createTaggedParameterModifiers } from './tagged-parameters'
import { createGeneratedVitalActions } from './vital-actions.generated'
import { createGeneratedVitalSequences } from './vital-sequences.generated'
import { createWeightDamageEffects } from './weight-damage'
import { createWeaknessTransfer } from './weakness-transfer'
import { officialHealingEffects } from './healing'
import { officialDamageBenefitEffects } from './damage-benefits'
import { officialConsecutiveHealingEffects } from './consecutive-healing'
import { generatedInstantLiteralEffects } from './instant-literals.generated'
import { createGeneratedMarkApplications } from './mark-applications.generated'
import { createGeneratedCompoundActions } from './compound-actions.generated'
import { createGeneratedConditionalActions } from './conditional-actions.generated'
import { createRandomMarkApplications } from './random-mark-applications'
import { createRandomWeatherApplication } from './random-weather-application'
import { createCurseMarkApplication } from './curse-mark-application'

/** Compose existing candidates only. This is not production admission or a legacy fallback. */
export function createOfficialEffectCandidates(marks: ReadonlyMap<string, BaseMark>) {
  const effects = new Map<string, Effect<EffectTrigger>>()
  const families = new Map<string, string>()
  const parameters = new Map<string, ParameterCatalog>()
  const add = (family: string, group: Effect<EffectTrigger> | Readonly<Record<string, Effect<EffectTrigger>>>) => {
    const entries = group instanceof Effect ? [group] : Object.values(group)
    for (const effect of entries) {
      if (!(effect instanceof Effect)) throw new Error(`Invalid candidate in ${family}`)
      // The authored example is the declared owner of this duplicate implementation.
      if (
        effect.id === 'effect_skill_consume_huanxiang_raise_def_1_stage' &&
        family === 'stat-stage-sequences.generated'
      )
        continue
      if (effects.has(effect.id))
        throw new Error(`Duplicate candidate: ${effect.id} (${families.get(effect.id)}, ${family})`)
      effects.set(effect.id, effect)
      families.set(effect.id, family)
      if (hasAuthoredParameters(effect)) parameters.set(effect.id, effectParameters(effect))
    }
  }
  const requireMark = (id: string) => {
    const mark = marks.get(id)
    if (!(mark instanceof BaseMark) || mark.id !== id) throw new Error(`Missing or mismatched official mark: ${id}`)
    return mark
  }
  add('authored', createOfficialAuthoredEffects())
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
  for (const effect of Object.values(generatedStatStageCandidates.effects)) {
    if (!hasAuthoredParameters(effect)) parameters.set(effect.id, generatedStatStageCandidates.parameters)
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
