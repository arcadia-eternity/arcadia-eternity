import {
  AddMarkContext,
  AttackTargetOpinion,
  Category,
  EffectContext,
  EffectTrigger,
  Element,
  Nature,
  StackStrategy,
  TurnContext,
  UseSkillContext,
  createContentCatalog,
  type BehaviorUse,
  type ContentPrototypeData,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { createOfficialTemplateRegistrations, withOfficialTemplates } from '@arcadia-eternity/data-pack-base/native'

export const useTemplate = (
  id: string,
  params: Record<string, string | number | boolean> = {},
  useId = 'use',
): BehaviorUse => ({ useId, definitionId: `base/template/${id}`, params })
export const templateMark = (id = 'ugc/state', behaviors: BehaviorUse[] = []) => ({
  id,
  tags: ['status'],
  behaviors,
  config: {
    duration: 2,
    persistent: false,
    maxStacks: 10,
    stackable: true,
    stackStrategy: StackStrategy.stack,
    keepOnSwitchOut: true,
  },
})
export const templateSkill = (id = 'ugc/skill', behaviors: BehaviorUse[] = []) => ({
  id,
  element: Element.Normal,
  category: Category.Physical,
  power: 30,
  rage: 0,
  accuracy: 100,
  tags: ['test'],
  behaviors,
})
export function templateData(skillUses: BehaviorUse[] = [], markUses: BehaviorUse[] = []) {
  return {
    marks: [templateMark(), templateMark('ugc/source', markUses)],
    skills: [templateSkill('ugc/skill', skillUses), templateSkill('ugc/other')],
    species: [
      {
        id: 'ugc/species',
        num: 1,
        element: Element.Normal,
        baseStats: { hp: 200, atk: 100, spa: 100, def: 100, spd: 100, spe: 100 },
        genderRatio: null,
        heightRange: [1, 2],
        weightRange: [1, 2],
        ability: [],
        emblem: [],
        learnable_skills: [
          { skill_id: 'ugc/skill', level: 1, hidden: false },
          { skill_id: 'ugc/other', level: 1, hidden: false },
        ],
      },
    ],
  }
}
export function templateCatalog(data: ContentPrototypeData = templateData(), revision = 'ugc-templates/v1') {
  return createContentCatalog(
    withOfficialTemplates(JSON.parse(JSON.stringify(data))),
    revision,
    undefined,
    [],
    createOfficialTemplateRegistrations,
  )
}
export function templateFixture(data: ContentPrototypeData = templateData(), seed = 'official-templates') {
  const catalog = templateCatalog(data)
  const [a, b] = catalog.parsePlayers(
    [0, 1].map(side => ({
      id: String(side).repeat(21),
      name: `Player ${side}`,
      team: [0, 1].map(index => ({
        name: `Pet ${side}/${index}`,
        id: String(2 + side * 2 + index).repeat(21),
        species: 'ugc/species',
        level: 100,
        nature: Nature.Hardy,
        skills: ['ugc/skill', 'ugc/other'],
        evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      })),
    })),
  )
  const battle = catalog.createBattle(a, b, { rngSeed: seed, timerConfig: { enabled: false } })
  const turn = () => new TurnContext(battle)
  const skillUse = (side = 0, skillIndex = 0) => {
    const player = side === 0 ? a : b
    const event = new UseSkillContext(
      turn(),
      player,
      player.activePet,
      AttackTargetOpinion.opponent,
      player.activePet.skills[skillIndex],
    )
    event.updateActualTarget()
    return event
  }
  const addMark = (id = 'ugc/source', side = 0, stack = 1) => {
    const pet = (side === 0 ? a : b).activePet
    battle.addMark(
      new AddMarkContext(
        new EffectContext(turn(), EffectTrigger.TurnStart, pet.skills[0]),
        pet,
        catalog.getMark(id as baseMarkId),
        stack,
      ),
    )
    return pet.marks.find(mark => mark.baseId === id)!
  }
  return { catalog, battle, a, b, turn, skillUse, addMark }
}
