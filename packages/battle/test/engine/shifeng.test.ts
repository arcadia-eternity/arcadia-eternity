import {
  AddMarkContext,
  AttackTargetOpinion,
  BattleStartPhase,
  DamageContext,
  DamageType,
  EffectContext,
  EffectTrigger,
  SkillPhase,
  SwitchPetPhase,
  TurnContext,
  UseSkillContext,
  defineNativeEffect,
  type effectId,
  type Battle,
  type Player,
} from '@arcadia-eternity/battle/engine'
import { createOfficialContent } from '@arcadia-eternity/data-pack-base/effects'
import { afterEach, expect, it, vi } from 'vitest'
import { loadBasePrototypeData } from './base-metadata'

const catalog = createOfficialContent(loadBasePrototypeData(), 'shifeng/test')
const battles: Battle[] = []
const stats = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
const poison = 'mark_zhongdu'
const paralysis = 'mark_mabi'
const needles = 'mark_fenghuangzhen'
const poisonSkill = 'skill_fenghuangduzhen'
const paralysisSkill = 'skill_fenghuangjinzhen'
const slowSkill = 'skill_fenghuangmizhen'

afterEach(async () => {
  vi.restoreAllMocks()
  for (const battle of battles.splice(0)) await battle.cleanup()
})

function setup(skills: string[], gender: 'Male' | 'Female' = 'Male', emblem?: string, maluiEmblem = false) {
  const defaults = { level: 100, nature: 'Hardy', ivs: stats, evs: stats }
  const opponent = maluiEmblem
    ? { species: 'pet_batu', skills: ['skill_kuaigong'], emblem: 'mark_emblem_malui' }
    : { species: 'pet_dilan', skills: ['skill_zhuangji'] }
  const [a, b] = catalog.parsePlayers([
    {
      name: 'A',
      team: [
        { ...defaults, name: 'A1', species: 'pet_suijingfeng', gender, emblem, skills },
        { ...defaults, name: 'A2', species: 'pet_shifeng', gender, skills: [poisonSkill] },
      ],
    },
    { name: 'B', team: [{ ...defaults, name: 'B1', ...opponent }] },
  ])
  const battle = catalog.createBattle(a, b, { rngSeed: 'shifeng', timerConfig: { enabled: false } })
  battles.push(battle)
  const start = new BattleStartPhase(battle)
  battle.phaseManager.registerPhase(start)
  expect(battle.phaseManager.executePhase(start.id).success).toBe(true)
  return { battle, a, b }
}

function mark(pet: Player['activePet'], id: string) {
  return pet.marks.find(entry => entry.baseId === id)
}

function addMark(battle: Battle, source: Player, target: Player, id: string, stacks = 1) {
  const effect = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, source.activePet.skills[0])
  const base = catalog.getMark(id as Parameters<typeof catalog.getMark>[0])
  const add = new AddMarkContext(effect, target.activePet, base, stacks)
  battle.addMark(add)
  return add
}

function skillUse(battle: Battle, player: Player, id: string) {
  const skill = player.activePet.skills.find(entry => entry.baseId === id)
  if (!skill) throw new Error(`Missing skill ${id}`)
  const turn = new TurnContext(battle)
  const use = new UseSkillContext(turn, player, player.activePet, AttackTargetOpinion.opponent, skill)
  use.updateActualTarget()
  return use
}

function attack(battle: Battle, player: Player, id: string, willHit: boolean) {
  player.currentRage = player.maxRage
  const use = skillUse(battle, player, id)
  use.hitOverrides.push({ willHit, priority: 1000 })
  const phase = new SkillPhase(
    battle,
    player,
    player.activePet,
    AttackTargetOpinion.opponent,
    use.skill,
    use.parent,
    use,
  )
  battle.phaseManager.registerPhase(phase)
  expect(battle.phaseManager.executePhase(phase.id).success).toBe(true)
}

it('spends three independent charges on hits, then blocks both classes of abnormal status through switching', () => {
  const { battle, a, b } = setup([poisonSkill, paralysisSkill, slowSkill])
  vi.spyOn(battle, 'random').mockReturnValue(0.99)
  expect(a.team.map(pet => mark(pet, needles)?.stack)).toEqual([3, 3])
  expect(addMark(battle, b, a, poison).available).toBe(true)

  attack(battle, a, poisonSkill, false)
  expect(mark(a.activePet, needles)?.stack).toBe(3)
  expect(mark(b.activePet, poison)).toBeUndefined()

  attack(battle, a, poisonSkill, true)
  expect(mark(a.activePet, needles)?.stack).toBe(2)
  expect(mark(b.activePet, poison)).toBeDefined()
  attack(battle, a, paralysisSkill, true)
  expect(mark(a.activePet, needles)?.stack).toBe(1)
  expect(mark(b.activePet, paralysis)).toBeDefined()
  const observeDamage = vi.fn(() => mark(b.activePet, 'stat_stage_spe_down')?.stack)
  skillUse(battle, a, slowSkill).skill.effects.push(
    defineNativeEffect({
      id: 'fixture/observe-speed-stage' as effectId,
      triggers: [EffectTrigger.OnBeforeCalculateDamage],
      priority: 0,
      apply: () => {
        observeDamage()
      },
    }),
  )
  attack(battle, a, slowSkill, true)
  expect(mark(a.activePet, needles)?.stack).toBe(0)
  expect(observeDamage).toHaveReturnedWith(1)

  for (const pet of [a.team[1], a.team[0]]) {
    const phase = new SwitchPetPhase(battle, a, pet, new TurnContext(battle))
    battle.phaseManager.registerPhase(phase)
    expect(battle.phaseManager.executePhase(phase.id).success).toBe(true)
    expect(a.activePet).toBe(pet)
  }
  expect(a.team.map(pet => mark(pet, needles)?.stack)).toEqual([0, 3])
  expect(addMark(battle, b, a, poison).available).toBe(false)
  expect(addMark(battle, b, a, paralysis).available).toBe(false)
})

it.each([
  [0.39, true],
  [0.4, false],
])('uses the 40%% secondary chance after its third charge, with random draw %s', (random, expected) => {
  const { battle, a, b } = setup([slowSkill, poisonSkill])
  // Keep the target alive through the three setup hits and the fourth chance check.
  addMark(battle, b, b, 'mark_hanbinghujia', 1000)
  const rng = vi.spyOn(battle, 'random').mockReturnValue(0.99)
  for (let i = 0; i < 3; i++) attack(battle, a, slowSkill, true)
  expect(b.activePet.isAlive).toBe(true)
  rng.mockReturnValue(random)
  attack(battle, a, poisonSkill, true)
  expect(mark(a.activePet, needles)?.stack).toBe(0)
  expect(Boolean(mark(b.activePet, poison))).toBe(expected)
})

it.each([
  ['neither pet', false, false],
  ['the defender', false, true],
  ['the attacker', true, false],
] as const)('resolves a 42%% draw with the paralysis emblem on %s', (_, attackerEmblem, defenderEmblem) => {
  const { battle, a, b } = setup(
    [slowSkill, paralysisSkill],
    'Male',
    attackerEmblem ? 'mark_emblem_malui' : undefined,
    defenderEmblem,
  )
  addMark(battle, b, b, 'mark_hanbinghujia', 1000)
  const rng = vi.spyOn(battle, 'random').mockReturnValue(0.99)
  for (let i = 0; i < 3; i++) attack(battle, a, slowSkill, true)
  expect(mark(a.activePet, needles)?.stack).toBe(0)
  rng.mockReturnValue(0.42)
  attack(battle, a, paralysisSkill, true)
  expect(Boolean(mark(b.activePet, paralysis))).toBe(attackerEmblem)
})

it.each([
  ['Male', 5, 0],
  ['Female', 0, -5],
] as const)(
  'changes ordinary outgoing and incoming damage according to the emblem and %s gender',
  (gender, out, incoming) => {
    const id = 'skill_zhenchituji'
    const { battle, a, b } = setup([id], gender, 'mark_emblem_zhenci')
    const outgoingUse = skillUse(battle, a, id)
    const incomingUse = skillUse(battle, b, 'skill_zhuangji')
    const outgoingDamage = new DamageContext(outgoingUse, outgoingUse.skill, b.activePet, 100, DamageType.Physical)
    const incomingDamage = new DamageContext(incomingUse, incomingUse.skill, a.activePet, 100, DamageType.Special)
    const effectDamage = new DamageContext(incomingUse, incomingUse.skill, a.activePet, 100, DamageType.Effect)
    for (const event of [outgoingDamage, incomingDamage, effectDamage]) {
      battle.applyEffects(event, EffectTrigger.OnBeforeCalculateDamage)
    }
    expect([outgoingDamage.modified[0], incomingDamage.modified[0], effectDamage.modified[0]]).toEqual([
      out,
      incoming,
      0,
    ])
  },
)

it.each([
  ['Female', [170, 75, 120]],
  ['Male', [160, 125, 70]],
] as const)('uses the original power conditions for %s', (gender, expected) => {
  const skills = ['skill_fenghuangzhenwu', 'skill_xiongfengtuxi', 'skill_fenghuangchuji']
  const { battle, a } = setup(skills, gender)
  const power = skills.map(id => {
    const use = skillUse(battle, a, id)
    battle.applyEffects(use, EffectTrigger.AfterUseSkillCheck)
    return use.power
  })
  expect(power).toEqual(expected)
})

it.each([
  ['Male', 'skill_xiongfengzhici', 'skill_fenghuangjuezhen', 50],
  ['Female', 'skill_fenghuangjuezhen', 'skill_xiongfengzhici', 65],
] as const)(
  'applies only the matching %s drain while ordinary attack damage consumes the shield',
  (gender, matching, other, amount) => {
    const { battle, a, b } = setup([matching, other], gender)
    vi.spyOn(battle, 'random').mockReturnValue(0.99)
    const shield = 'mark_hanbinghujia'
    addMark(battle, b, b, shield, 1000)
    a.activePet.currentHp -= 100
    const ownHp = a.activePet.currentHp
    const targetHp = b.activePet.currentHp

    attack(battle, a, other, true)
    expect(mark(b.activePet, shield)?.stack).toBeLessThan(1000)
    expect(b.activePet.currentHp).toBe(targetHp)
    expect(a.activePet.currentHp).toBe(ownHp)

    attack(battle, a, matching, true)
    expect(b.activePet.currentHp).toBe(targetHp - amount)
    expect(a.activePet.currentHp).toBe(ownHp + amount)

    a.activePet.currentHp = ownHp
    b.activePet.currentHp = 12
    attack(battle, a, matching, true)
    expect(b.activePet.currentHp).toBe(0)
    expect(a.activePet.currentHp).toBe(ownHp + 12)
  },
)

it('drains the committed HP loss even if the victim heals in its own damage reaction', () => {
  const { battle, a, b } = setup(['skill_xiongfengzhici'])
  vi.spyOn(battle, 'random').mockReturnValue(0.99)
  const target = b.activePet
  addMark(battle, b, b, 'mark_hanbinghujia', 1000)
  target.currentHp -= 20
  a.activePet.currentHp -= 100
  const attackerHp = a.activePet.currentHp
  const targetHp = target.currentHp
  target.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/later-heal' as effectId,
      triggers: [EffectTrigger.OnDamage],
      priority: 10,
      apply: ({ parent }) => {
        parent.target.currentHp += 10
      },
    }),
  )
  attack(battle, a, 'skill_xiongfengzhici', true)
  expect(target.currentHp).toBe(targetHp - 50 + 10)
  expect(a.activePet.currentHp).toBe(attackerHp + 50)
})
