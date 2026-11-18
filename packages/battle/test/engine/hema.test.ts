import { afterEach, expect, it, vi } from 'vitest'
import {
  AddMarkContext,
  AttackTargetOpinion,
  BattleMessageType,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  type Battle,
  type Pet,
  type Player,
} from '@arcadia-eternity/battle/engine'
import { createOfficialContent } from '@arcadia-eternity/data-pack-base/effects'
import { loadBasePrototypeData } from './base-metadata'

const catalog = createOfficialContent(loadBasePrototypeData(), 'hema/test')
const stats = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }
const hearing = 'mark_shiqutingjue'
const smell = 'mark_shiquxiujue'
const taste = 'mark_shiquweijue'
const senseMarks = [hearing, smell, taste]
const battles: Battle[] = []

afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
  vi.restoreAllMocks()
})

function member(species: string, skills: string[], emblem?: string) {
  return { name: species, species, skills, emblem, level: 100, nature: 'Hardy', evs: stats, ivs }
}

function createBattle(teamA: ReturnType<typeof member>[], teamB: ReturnType<typeof member>[]) {
  const [a, b] = catalog.parsePlayers([
    { name: 'A', team: teamA },
    { name: 'B', team: teamB },
  ])
  const battle = catalog.createBattle(a, b, { rngSeed: 'hema', timerConfig: { enabled: false } })
  battles.push(battle)
  return battle
}

async function start(battle: Battle) {
  const running = battle.startBattle().catch((cause: unknown) => {
    if (!(cause instanceof Error) || cause.message !== 'Battle cancelled') throw cause
  })
  await battle.waitForInputReady()
  return async () => {
    await battle.cleanup()
    await running
  }
}

async function turn(battle: Battle, choose: () => void) {
  const ended = new Promise<void>(resolve => {
    battle.registerListener(function listener(message) {
      if (message.type !== BattleMessageType.TurnEnd) return
      battle.unregisterListener(listener)
      resolve()
    })
  })
  choose()
  await ended
  await battle.waitForInputReady()
}

function useSkill(battle: Battle, player: Player, baseId: string) {
  const skill = player.activePet.skills.find(entry => entry.baseId === baseId)
  const selection = battle
    .getAvailableSelection(player.id)
    .find(entry => entry.type === 'use-skill' && entry.skill === skill?.id)
  if (!selection) throw new Error(`Cannot select ${baseId} for ${player.activePet.name}`)
  expect(battle.setSelection(selection)).toBe(true)
}

function switchOut(battle: Battle, player: Player) {
  const selection = battle.getAvailableSelection(player.id).find(entry => entry.type === 'switch-pet')
  if (!selection) throw new Error(`Cannot switch ${player.activePet.name}`)
  expect(battle.setSelection(selection)).toBe(true)
}

function senseLoss(pet: Pet) {
  return pet.marks.filter(mark => senseMarks.includes(mark.baseId))
}

it('applies one random loss on a hit, rewards a later hit and clears the status when the target switches', async () => {
  const battle = createBattle(
    [member('pet_heyimi', ['skill_ganjuebaoli', 'skill_chaoheyimi', 'skill_jianying'])],
    [member('pet_hema', ['skill_jianying']), member('pet_hema', ['skill_jianying'])],
  )
  const finish = await start(battle)
  try {
    const { playerA: a, playerB: b } = battle
    const initialTarget = b.activePet
    a.currentRage = 50
    const gained: number[] = []
    battle.registerListener(message => {
      if (
        message.type === BattleMessageType.RageChange &&
        message.data.player === a.id &&
        message.data.reason === 'effect'
      ) {
        gained.push(message.data.after - message.data.before)
      }
    })
    vi.spyOn(battle, 'random').mockReturnValue(0.5)
    await turn(battle, () => {
      useSkill(battle, a, 'skill_ganjuebaoli')
      useSkill(battle, b, 'skill_jianying')
    })
    expect(senseLoss(initialTarget).map(mark => mark.duration)).toEqual([4])
    expect(gained).toEqual([])

    await turn(battle, () => {
      useSkill(battle, a, 'skill_chaoheyimi')
      useSkill(battle, b, 'skill_jianying')
    })
    expect(gained).toEqual([5])
    expect(senseLoss(initialTarget).map(mark => mark.duration)).toEqual([3])

    await turn(battle, () => {
      useSkill(battle, a, 'skill_chaoheyimi')
      switchOut(battle, b)
    })
    expect(gained).toEqual([5])
    expect(senseLoss(initialTarget)).toEqual([])
    expect(senseLoss(b.activePet)).toEqual([])
  } finally {
    await finish()
  }
})

it.each([false, true])(
  'applies the climax impairments and corresponding stat boosts (hearing emblem: %s)',
  async equipped => {
    const emblem = equipped ? 'mark_emblem_tingjue' : undefined
    const battle = createBattle(
      [member('pet_heyimi', ['skill_chaogansangshibo', 'skill_beiheyimi'])],
      [member('pet_heyimi', ['skill_jianying'], emblem), member('pet_hema', ['skill_jianying'], emblem)],
    )
    const finish = await start(battle)
    try {
      const { playerA: a, playerB: b } = battle
      for (const pet of b.team) {
        expect(pet.marks.filter(mark => mark.baseId === 'mark_ability_ganjue')).toHaveLength(1)
        expect(pet.marks.filter(mark => mark.baseId === 'mark_emblem_tingjue')).toHaveLength(equipped ? 1 : 0)
      }
      a.currentRage = 100
      vi.spyOn(battle, 'random').mockReturnValue(0.5)
      await turn(battle, () => {
        useSkill(battle, a, 'skill_chaogansangshibo')
        useSkill(battle, b, 'skill_jianying')
      })
      expect(
        senseLoss(b.activePet)
          .map(mark => mark.baseId)
          .sort(),
      ).toEqual((equipped ? [smell, taste] : [...senseMarks]).sort())

      await turn(battle, () => {
        useSkill(battle, a, 'skill_beiheyimi')
        useSkill(battle, b, 'skill_jianying')
      })
      const raisedStats = a.activePet.marks
        .map(mark => mark.baseId)
        .filter(id => id.startsWith('stat_stage_'))
        .sort()
      expect(raisedStats).toEqual(
        equipped
          ? ['stat_stage_def_up', 'stat_stage_spd_up']
          : ['stat_stage_def_up', 'stat_stage_spd_up', 'stat_stage_spe_up'],
      )
    } finally {
      await finish()
    }
  },
)

it.each([
  [hearing, 'skill_ganjuebaoli', true],
  [hearing, 'skill_jingsheganrao', false],
  [taste, 'skill_ganjuebaoli', false],
  [taste, 'skill_jingsheganrao', true],
] as const)('%s affects the accuracy of the appropriate skill category (%s)', (markId, skillId, willHit) => {
  const battle = createBattle([member('pet_heyimi', [skillId])], [member('pet_hema', ['skill_jianying'])])
  const { playerA: a, playerB: b } = battle
  const turnContext = new TurnContext(battle)
  const attack = a.activePet.skills[0]
  const markSource = new EffectContext(turnContext, EffectTrigger.TurnStart, attack)
  battle.addMark(
    new AddMarkContext(markSource, b.activePet, catalog.getMark(markId as Parameters<typeof catalog.getMark>[0]), 1),
  )
  const skillUse = new UseSkillContext(turnContext, a, a.activePet, AttackTargetOpinion.opponent, attack)
  vi.spyOn(battle, 'random').mockReturnValue(0.99)
  skillUse.updateActualTarget()
  battle.applyEffects(skillUse, EffectTrigger.AfterUseSkillCheck)
  skillUse.updateHitResult()
  expect(skillUse.hitResult).toBe(willHit)
})
