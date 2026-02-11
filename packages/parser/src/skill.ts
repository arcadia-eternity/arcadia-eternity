import { BaseSkill, Effect } from '@arcadia-eternity/battle'
import { EffectTrigger, type baseSkillId, type effectId } from '@arcadia-eternity/const'
import { DataRepository } from '@arcadia-eternity/data-repository'
import { SkillSchema, parseWithErrors } from '@arcadia-eternity/schema'

export class SkillParser {
  static parse(rawData: unknown): BaseSkill {
    let validated: ReturnType<typeof parseWithErrors<typeof SkillSchema>>
    try {
      validated = parseWithErrors(SkillSchema, rawData)
    } catch (error) {
      throw new Error(
        `[SkillParser] 技能数据验证失败: ${error instanceof Error ? error.message : error}`,
      )
    }

    let effects: Effect<EffectTrigger>[] = []

    if (validated.effect) {
      effects = validated.effect.map((effectId, index) => {
        try {
          return DataRepository.getInstance().getEffect(effectId as effectId)
        } catch (e) {
          throw new Error(
            `[SkillParser] 技能 '${validated.id}' 的第 ${index + 1} 个效果 '${effectId}' 加载失败: ${(e as Error).message}`,
          )
        }
      })
    }

    return new BaseSkill(
      validated.id as baseSkillId,
      validated.category,
      validated.element,
      validated.power,
      validated.accuracy,
      validated.rage,
      validated.priority ?? 0,
      validated.target,
      validated.multihit,
      validated.sureHit,
      validated.sureCrit,
      validated.ignoreShield,
      validated.ignoreOpponentStageStrategy,
      validated.tags,
      effects,
    )
  }
}
