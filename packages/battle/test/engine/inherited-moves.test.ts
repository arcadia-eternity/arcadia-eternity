import { expect, it } from 'vitest'
import {
  AddMarkContext,
  AttackTargetOpinion,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
} from '@arcadia-eternity/battle/engine'
import { createOfficialContent } from '@arcadia-eternity/data-pack-base/effects'
import { loadBasePrototypeData } from './base-metadata'

const catalog = createOfficialContent(loadBasePrototypeData(), 'inherited-skills/test')
const stats = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
const players = (skills: string[]) =>
  ['A', 'B'].map(name => ({
    name,
    team: [
      {
        name,
        species: 'pet_duomo',
        level: 100,
        nature: 'Hardy',
        evs: stats,
        ivs: stats,
        skills,
      },
    ],
  }))

it.each([
  ['skill_duzhenlianshe', EffectTrigger.BeforeMultiHit, 'mark_zhongdu', 'multihitResult', 2, 4],
  ['skill_jinzhensheji', EffectTrigger.BeforeHit, 'mark_mabi', 'power', 80, 130],
  ['skill_zhenchituji', EffectTrigger.BeforeHit, 'first', 'power', 65, 115],
  ['skill_mizhenlianshe', EffectTrigger.AfterUseSkillCheck, 'first', 'critRate', 5, 100],
  ['skill_guaiyichongji', EffectTrigger.OnHit, 'mark_shiquxiujue', 'def', 0, -1],
  ['skill_kusechouda', EffectTrigger.OnHit, 'mark_shiquweijue', 'spd', 0, -1],
] as const)(
  '%s applies its bonus only under the original skill condition',
  async (id, trigger, condition, field, before, after) => {
    const [a, b] = catalog.parsePlayers(players([id]))
    const battle = catalog.createBattle(a, b, { rngSeed: 'inherited-moves', timerConfig: { enabled: false } })
    try {
      function activate(first: boolean) {
        const turn = new TurnContext(battle)
        const skill = a.activePet.skills[0]
        const use = new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, skill)
        if (!first)
          turn.appledContexts.push(
            new UseSkillContext(turn, b, b.activePet, AttackTargetOpinion.opponent, b.activePet.skills[0]),
          )
        turn.appledContexts.push(use)
        use.critRate = 5
        use.updateActualTarget()
        use.updateMultihitResult()
        battle.applyEffects(use, trigger, skill)
        if (field === 'spd' || field === 'def') {
          const stage = b.activePet.marks.find(mark => mark.baseId === 'stat_stage_' + field + '_down') as
            { level?: number } | undefined
          return stage?.level ?? 0
        }
        return use[field]
      }
      function mark(id: string) {
        const source = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, a.activePet.skills[0])
        battle.addMark(
          new AddMarkContext(source, b.activePet, catalog.getMark(id as Parameters<typeof catalog.getMark>[0]), 1),
        )
      }
      expect(activate(false)).toBe(before)
      if (condition !== 'first') mark(condition)
      expect(activate(condition === 'first')).toBe(after)
    } finally {
      await battle.cleanup()
    }
  },
)
