import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { createOfficialContent } from '@arcadia-eternity/data-pack-base/effects'
import { loadBasePrototypeData } from './base-metadata'
import {
  type Battle,
  type Player,
  type Pet,
  type BattleMessage,
  AddMarkContext,
  AttackTargetOpinion,
  BattleMessageType,
  DamageContext,
  DamageType,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  setGlobalLogger,
} from '@arcadia-eternity/battle/v4'

setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
const directory = createOfficialContent(loadBasePrototypeData(), 'bingchuantun/test')
const battles: Battle[] = []
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function cancelled(error: unknown) {
  if (!(error instanceof Error) || error.message !== 'Battle cancelled') throw error
}
function nextTurn(battle: Battle) {
  return new Promise<void>(resolve => {
    const listener = (message: BattleMessage) => {
      if (message.type === BattleMessageType.TurnAction) {
        battle.unregisterListener(listener)
        resolve()
      }
    }
    battle.registerListener(listener)
  })
}
function createBattle(seed: string, { players = defaultPlayers() }: { players?: ReturnType<typeof player>[] } = {}) {
  const [a, b] = directory.parsePlayers(players)
  const battle = directory.createBattle(a, b, { rngSeed: seed, timerConfig: { enabled: false } })
  battles.push(battle)
  return battle
}
function defaultPlayers() {
  return ['A', 'B'].map(name =>
    player(
      name,
      ['pet_tuntun', 'pet_binghutun', 'pet_bingchuantun'].map(species => ({
        ...pet(species, species, ['skill_hanbingjianren', 'skill_zhuangji']),
        emblem: 'mark_emblem_jianren',
      })),
    ),
  )
}
const id = (value: string) => value
const STATS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
const IVS = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }

function pet(name: string, species: string, skills: string[], overrides: { nature?: string } = {}) {
  return {
    name,
    species,
    level: 100,
    evs: { ...STATS },
    ivs: { ...IVS },
    nature: 'Hardy',
    gender: 'Male',
    maxHp: 99999,
    skills,
    ...overrides,
  }
}

function player(name: string, team: ReturnType<typeof pet>[]) {
  return { name, team }
}

function hasMark(pet: Pet, baseId: string) {
  return pet.marks.some(mark => mark.baseId === baseId)
}

function stripMark(pet: Pet, baseId: string) {
  pet.marks = pet.marks.filter(mark => mark.baseId !== baseId)
}

function collectDamage(battle: Battle) {
  const rows: { target: string; damage: number }[] = []
  battle.registerListener(message => {
    if (message.type === BattleMessageType.Damage) rows.push(message.data)
  })
  return rows
}

/** Start a battle and wait for the first selection boundary. */
async function startBattle(seed: string, players?: ReturnType<typeof player>[]) {
  const battle = await createBattle(seed, { players })
  const running = battle.startBattle().catch(cancelled)
  await battle.waitForInputReady()
  battle.playerA.currentRage = 100
  battle.playerB.currentRage = 100
  return { battle, running }
}

async function stopBattle(battle: Battle, running: Promise<unknown>) {
  await battle.cleanup()
  await running
}

function useSkill(battle: Battle, player: Player, skillBaseId: string) {
  const skill = player.activePet.skills.find(entry => entry.baseId === skillBaseId)
  assert.ok(skill, `${player.activePet.name} does not have ${skillBaseId}`)
  const selection = battle
    .getAvailableSelection(player.id)
    .find(entry => entry.type === 'use-skill' && entry.skill === skill.id)
  assert.ok(selection, `${skillBaseId} is not selectable for ${player.activePet.name}`)
  assert.equal(battle.setSelection(selection), true)
}

function switchTo(battle: Battle, player: Player, petId: string) {
  const selection = battle
    .getAvailableSelection(player.id)
    .find(entry => entry.type === 'switch-pet' && entry.pet === petId)
  assert.ok(selection, `cannot switch to ${petId}`)
  assert.equal(battle.setSelection(selection), true)
}

async function runTurn(battle: Battle, play: () => void) {
  const next = nextTurn(battle)
  play()
  await next
}

/** Add an owned mark through the same public API authored effects use. */
function addMark(battle: Battle, target: Pet, baseId: string) {
  const context = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, target.skills[0])
  battle.addMark(
    new AddMarkContext(context, target, directory.getMark(baseId as Parameters<typeof directory.getMark>[0]), 1),
  )
}

test('every team member enters battle with the ability and the equipped emblem mark', async () => {
  const { battle, running } = await startBattle('battle-start-marks', undefined)
  try {
    for (const actor of [battle.playerA, battle.playerB])
      for (const member of actor.team) {
        assert.equal(member.marks.filter(mark => mark.baseId === id('mark_ability_houjin')).length, 1)
        assert.equal(member.marks.filter(mark => mark.baseId === id('mark_emblem_jianren')).length, 1)
      }
  } finally {
    await stopBattle(battle, running)
  }
})

async function damageTaken(seed: string, attackerSkill: string, marks: string[]) {
  const { battle, running } = await startBattle(seed, [
    player('A', [pet('冰川豚', id('pet_bingchuantun'), [id('skill_hanbingjianren'), 'skill_jianying'])]),
    player('B', [pet('迪兰特', 'pet_dilan', [attackerSkill, 'skill_jianying'])]),
  ])
  try {
    stripMark(battle.playerA.activePet, id('mark_ability_houjin'))
    stripMark(battle.playerA.activePet, id('mark_emblem_jianren'))
    stripMark(battle.playerB.activePet, 'mark_ability_zhongjie')
    for (const mark of marks) addMark(battle, battle.playerA.activePet, mark)
    const rows = collectDamage(battle)
    await runTurn(battle, () => {
      useSkill(battle, battle.playerA, 'skill_jianying')
      useSkill(battle, battle.playerB, attackerSkill)
    })
    const hit = rows.filter(row => row.target === battle.playerA.activePet.id).at(-1)
    assert.ok(hit, 'the opponent attack did not deal damage')
    return { damage: hit.damage, marks: battle.playerA.activePet.marks.map(mark => mark.baseId) }
  } finally {
    await stopBattle(battle, running)
  }
}

test('寒冰坚韧 reduces physical damage by 25% and special damage by 15%; 坚韧 adds a flat 20 while it is present', async () => {
  const physicalControl = await damageTaken('damage-taken', 'skill_zhuangji', [])
  const physicalMarked = await damageTaken('damage-taken', 'skill_zhuangji', [id('mark_hanbingjianren')])
  const physicalEmblem = await damageTaken('damage-taken', 'skill_zhuangji', [
    id('mark_hanbingjianren'),
    id('mark_emblem_jianren'),
  ])
  assert.ok(physicalControl.damage > 0)
  assert.ok(Math.abs(physicalMarked.damage - physicalControl.damage * 0.75) <= 1)
  assert.ok(physicalEmblem.damage <= Math.max(1, physicalMarked.damage - 19))
  assert.ok(physicalMarked.marks.some(mark => mark === 'mark_hanbingjianren'))

  const specialControl = await damageTaken('damage-taken', 'skill_baihuaguangxian', [])
  const specialMarked = await damageTaken('damage-taken', 'skill_baihuaguangxian', [id('mark_hanbingjianren')])
  const specialEmblem = await damageTaken('damage-taken', 'skill_baihuaguangxian', [
    id('mark_hanbingjianren'),
    id('mark_emblem_jianren'),
  ])
  assert.ok(specialControl.damage > 0)
  assert.ok(Math.abs(specialMarked.damage - specialControl.damage * 0.85) <= 1)
  assert.ok(Math.abs(specialEmblem.damage - Math.max(0, specialMarked.damage - 20)) <= 1)
})

async function dealtDamage(seed: string, nature: string, keepAbility: boolean) {
  const { battle, running } = await startBattle(seed, [
    player('A', [pet('冰川豚', id('pet_bingchuantun'), ['skill_zhuangji', 'skill_jianying'], { nature })]),
    player('B', [pet('目标', id('pet_bingchuantun'), ['skill_jianying'])]),
  ])
  try {
    stripMark(battle.playerB.activePet, id('mark_ability_houjin'))
    stripMark(battle.playerB.activePet, id('mark_emblem_jianren'))
    if (!keepAbility) stripMark(battle.playerA.activePet, id('mark_ability_houjin'))
    const rows = collectDamage(battle)
    await runTurn(battle, () => {
      useSkill(battle, battle.playerA, 'skill_zhuangji')
      useSkill(battle, battle.playerB, 'skill_jianying')
    })
    const hit = rows.filter(row => row.target === battle.playerB.activePet.id).at(-1)
    assert.ok(hit, 'the player attack did not deal damage')
    return { damage: hit.damage, speed: [battle.playerA.activePet.stat.spe, battle.playerB.activePet.stat.spe] }
  } finally {
    await stopBattle(battle, running)
  }
}

test('后劲 adds 10% damage only when the owner moves last in the turn', async () => {
  const slow = await dealtDamage('ability-order', 'Brave', true)
  const slowControl = await dealtDamage('ability-order', 'Brave', false)
  assert.ok(slow.speed[0] < slow.speed[1])
  assert.ok(Math.abs(slow.damage - slowControl.damage * 1.1) <= 1)

  const fast = await dealtDamage('ability-order', 'Jolly', true)
  const fastControl = await dealtDamage('ability-order', 'Jolly', false)
  assert.ok(fast.speed[0] > fast.speed[1])
  assert.equal(fast.damage, fastControl.damage)
})

test('寒冰坚韧 grants the mark and 冻气冲撞 spends it to frostbite non-Ice targets; Ice targets and missing marks are boundaries', async () => {
  const nonIce = await startBattle('dongqi-non-ice', [
    player('A', [pet('冰川豚', id('pet_bingchuantun'), [id('skill_hanbingjianren'), id('skill_dongqichongzhuang')])]),
    player('B', [pet('迪兰特', 'pet_dilan', ['skill_jianying'])]),
  ])
  try {
    const a = nonIce.battle.playerA
    const b = nonIce.battle.playerB
    stripMark(a.activePet, id('mark_ability_houjin'))
    stripMark(b.activePet, 'mark_ability_zhongjie')
    await runTurn(nonIce.battle, () => {
      useSkill(nonIce.battle, a, id('skill_hanbingjianren'))
      useSkill(nonIce.battle, b, 'skill_jianying')
    })
    assert.equal(hasMark(a.activePet, id('mark_hanbingjianren')), true)
    await runTurn(nonIce.battle, () => {
      useSkill(nonIce.battle, a, id('skill_dongqichongzhuang'))
      useSkill(nonIce.battle, b, 'skill_jianying')
    })
    assert.equal(hasMark(a.activePet, id('mark_hanbingjianren')), false)
    assert.equal(hasMark(b.activePet, 'mark_dongshang'), true)
  } finally {
    await stopBattle(nonIce.battle, nonIce.running)
  }

  const withoutMark = await startBattle('dongqi-without-mark', [
    player('A', [pet('冰川豚', id('pet_bingchuantun'), [id('skill_dongqichongzhuang'), 'skill_jianying'])]),
    player('B', [pet('迪兰特', 'pet_dilan', ['skill_jianying'])]),
  ])
  try {
    const a = withoutMark.battle.playerA
    const b = withoutMark.battle.playerB
    stripMark(b.activePet, 'mark_ability_zhongjie')
    await runTurn(withoutMark.battle, () => {
      useSkill(withoutMark.battle, a, id('skill_dongqichongzhuang'))
      useSkill(withoutMark.battle, b, 'skill_jianying')
    })
    assert.equal(hasMark(b.activePet, 'mark_dongshang'), false)
    assert.equal(hasMark(a.activePet, id('mark_hanbingjianren')), false)
  } finally {
    await stopBattle(withoutMark.battle, withoutMark.running)
  }

  const iceTarget = await startBattle('dongqi-ice-target', [
    player('A', [pet('冰川豚', id('pet_bingchuantun'), [id('skill_hanbingjianren'), id('skill_dongqichongzhuang')])]),
    player('B', [pet('冰湖豚', id('pet_binghutun'), ['skill_jianying'])]),
  ])
  try {
    const a = iceTarget.battle.playerA
    const b = iceTarget.battle.playerB
    stripMark(a.activePet, id('mark_ability_houjin'))
    stripMark(b.activePet, id('mark_ability_houjin'))
    stripMark(b.activePet, id('mark_emblem_jianren'))
    await runTurn(iceTarget.battle, () => {
      useSkill(iceTarget.battle, a, id('skill_hanbingjianren'))
      useSkill(iceTarget.battle, b, 'skill_jianying')
    })
    await runTurn(iceTarget.battle, () => {
      useSkill(iceTarget.battle, a, id('skill_dongqichongzhuang'))
      useSkill(iceTarget.battle, b, 'skill_jianying')
    })
    assert.equal(hasMark(b.activePet, 'mark_dongshang'), false)
    assert.equal(hasMark(a.activePet, id('mark_hanbingjianren')), true)
  } finally {
    await stopBattle(iceTarget.battle, iceTarget.running)
  }
})

async function attackDamage(seed: string, skill: string) {
  const { battle, running } = await startBattle(seed, [
    player('A', [pet('冰川豚', id('pet_bingchuantun'), [skill, 'skill_jianying'])]),
    player('B', [pet('目标', id('pet_bingchuantun'), ['skill_jianying'], { nature: 'Brave' })]),
  ])
  try {
    stripMark(battle.playerB.activePet, id('mark_ability_houjin'))
    stripMark(battle.playerB.activePet, id('mark_emblem_jianren'))
    stripMark(battle.playerA.activePet, id('mark_ability_houjin'))
    stripMark(battle.playerA.activePet, id('mark_emblem_jianren'))
    return { battle, running, b: battle.playerB }
  } catch (error) {
    await stopBattle(battle, running)
    throw error
  }
}

test('急速冰锥 spends 寒冰坚韧 for +1 priority; 冰雹 spends it for +60 power; 冰冷一击 spends it for +60 fixed damage', async () => {
  const priorityBattle = await startBattle('priority', [
    player('A', [pet('冰川豚', id('pet_bingchuantun'), [id('skill_jisubingzhui')])]),
    player('B', [pet('迪兰特', 'pet_dilan', ['skill_zhuangji'])]),
  ])
  try {
    const a = priorityBattle.battle.playerA.activePet
    stripMark(a, id('mark_ability_houjin'))
    stripMark(a, id('mark_emblem_jianren'))
    addMark(priorityBattle.battle, a, id('mark_hanbingjianren'))
    const skill = a.skills.find(entry => entry.baseId === id('skill_jisubingzhui'))
    const context = new UseSkillContext(
      new TurnContext(priorityBattle.battle),
      priorityBattle.battle.playerA,
      a,
      AttackTargetOpinion.opponent,
      skill!,
    )
    context.updateActualTarget()
    assert.equal(context.priority, 0)
    priorityBattle.battle.applyEffects(context, EffectTrigger.BeforeSort)
    assert.equal(context.priority, 1)
    assert.equal(hasMark(a, id('mark_hanbingjianren')), false)

    const noMark = await startBattle('priority-no-mark', [
      player('A', [pet('冰川豚', id('pet_bingchuantun'), [id('skill_jisubingzhui')])]),
      player('B', [pet('迪兰特', 'pet_dilan', ['skill_zhuangji'])]),
    ])
    try {
      const petA = noMark.battle.playerA.activePet
      const skillA = petA.skills.find(entry => entry.baseId === id('skill_jisubingzhui'))
      const contextA = new UseSkillContext(
        new TurnContext(noMark.battle),
        noMark.battle.playerA,
        petA,
        AttackTargetOpinion.opponent,
        skillA!,
      )
      contextA.updateActualTarget()
      noMark.battle.applyEffects(contextA, EffectTrigger.BeforeSort)
      assert.equal(contextA.priority, 0)
    } finally {
      await stopBattle(noMark.battle, noMark.running)
    }
  } finally {
    await stopBattle(priorityBattle.battle, priorityBattle.running)
  }

  async function hail(withMark: boolean) {
    const run = await attackDamage('hail', id('skill_bingbao'))
    if (withMark) addMark(run.battle, run.battle.playerA.activePet, id('mark_hanbingjianren'))
    const rows = collectDamage(run.battle)
    await runTurn(run.battle, () => {
      useSkill(run.battle, run.battle.playerA, id('skill_bingbao'))
      useSkill(run.battle, run.b, 'skill_jianying')
    })
    const hit = rows.filter(row => row.target === run.b.activePet.id).at(-1)
    assert.ok(hit)
    const result = { damage: hit.damage, hasMark: hasMark(run.battle.playerA.activePet, id('mark_hanbingjianren')) }
    await stopBattle(run.battle, run.running)
    return result
  }
  const hailNormal = await hail(false)
  const hailMarked = await hail(true)
  assert.ok(Math.abs(hailMarked.damage - hailNormal.damage * 1.6) <= 2)
  assert.equal(hailMarked.hasMark, false)

  async function fixed(withMark: boolean) {
    const run = await attackDamage('fixed', id('skill_binglengyiji'))
    if (withMark) addMark(run.battle, run.battle.playerA.activePet, id('mark_hanbingjianren'))
    const rows = collectDamage(run.battle)
    await runTurn(run.battle, () => {
      useSkill(run.battle, run.battle.playerA, id('skill_binglengyiji'))
      useSkill(run.battle, run.b, 'skill_jianying')
    })
    const hit = rows.filter(row => row.target === run.b.activePet.id).at(-1)
    assert.ok(hit)
    const result = { damage: hit.damage, hasMark: hasMark(run.battle.playerA.activePet, id('mark_hanbingjianren')) }
    await stopBattle(run.battle, run.running)
    return result
  }
  const fixedNormal = await fixed(false)
  const fixedMarked = await fixed(true)
  assert.ok(Math.abs(fixedMarked.damage - fixedNormal.damage - 60) <= 1)
  assert.equal(fixedMarked.hasMark, false)
})

test('冰河时代 is a sure hit and grants 寒冰坚韧; 寒冷之气 doubles power against 冻伤; 冰冷皮肤 grants 不良免疫', async () => {
  const climax = await startBattle('climax', [
    player('A', [pet('冰川豚', id('pet_bingchuantun'), [id('skill_bingheshidai'), 'skill_jianying'])]),
    player('B', [pet('迪兰特', 'pet_dilan', ['skill_jianying'])]),
  ])
  try {
    stripMark(climax.battle.playerA.activePet, id('mark_ability_houjin'))
    stripMark(climax.battle.playerB.activePet, 'mark_ability_zhongjie')
    const rows = collectDamage(climax.battle)
    await runTurn(climax.battle, () => {
      useSkill(climax.battle, climax.battle.playerA, id('skill_bingheshidai'))
      useSkill(climax.battle, climax.battle.playerB, 'skill_jianying')
    })
    assert.equal(hasMark(climax.battle.playerA.activePet, id('mark_hanbingjianren')), true)
    assert.ok(rows.some(row => row.target === climax.battle.playerB.activePet.id && row.damage > 0))
  } finally {
    await stopBattle(climax.battle, climax.running)
  }

  async function chill(withFrostbite: boolean) {
    const { battle, running } = await startBattle('chill', [
      player('A', [pet('冰川豚', id('pet_bingchuantun'), [id('skill_hanlengzhiqi'), 'skill_jianying'])]),
      player('B', [pet('迪兰特', 'pet_dilan', ['skill_jianying'], { nature: 'Brave' })]),
    ])
    try {
      stripMark(battle.playerA.activePet, id('mark_ability_houjin'))
      stripMark(battle.playerB.activePet, 'mark_ability_zhongjie')
      if (withFrostbite) addMark(battle, battle.playerB.activePet, 'mark_dongshang')
      const rows = collectDamage(battle)
      await runTurn(battle, () => {
        useSkill(battle, battle.playerA, id('skill_hanlengzhiqi'))
        useSkill(battle, battle.playerB, 'skill_jianying')
      })
      return rows.filter(row => row.target === battle.playerB.activePet.id)[0]?.damage ?? -1
    } finally {
      await stopBattle(battle, running)
    }
  }
  const chillNormal = await chill(false)
  const chillFrozen = await chill(true)
  assert.ok(chillNormal > 0)
  assert.ok(Math.abs(chillFrozen - chillNormal * 2) <= 2)

  const skin = await startBattle('frigid-skin', [
    player('A', [pet('冰川豚', id('pet_bingchuantun'), [id('skill_binglengpifu'), 'skill_jianying'])]),
    player('B', [pet('迪兰特', 'pet_dilan', ['skill_jianying'])]),
  ])
  try {
    stripMark(skin.battle.playerA.activePet, id('mark_ability_houjin'))
    stripMark(skin.battle.playerB.activePet, 'mark_ability_zhongjie')
    await runTurn(skin.battle, () => {
      useSkill(skin.battle, skin.battle.playerA, id('skill_binglengpifu'))
      useSkill(skin.battle, skin.battle.playerB, 'skill_jianying')
    })
    assert.equal(hasMark(skin.battle.playerA.activePet, 'mark_mianyibuliang'), true)
  } finally {
    await stopBattle(skin.battle, skin.running)
  }
})

async function switchScenario(seed: string, stripAfterReturn: boolean) {
  const { battle, running } = await startBattle(seed, [
    player('A', [
      pet('冰川豚', id('pet_bingchuantun'), [id('skill_hanbingjianren'), 'skill_jianying']),
      pet('豚豚', id('pet_tuntun'), ['skill_zhuangji']),
    ]),
    player('B', [pet('迪兰特', 'pet_dilan', ['skill_zhuangji', 'skill_jianying'])]),
  ])
  try {
    const a = battle.playerA
    const b = battle.playerB
    stripMark(a.activePet, id('mark_ability_houjin'))
    stripMark(b.activePet, 'mark_ability_zhongjie')
    await runTurn(battle, () => {
      useSkill(battle, a, id('skill_hanbingjianren'))
      useSkill(battle, b, 'skill_jianying')
    })
    assert.equal(hasMark(a.activePet, id('mark_hanbingjianren')), true)

    await runTurn(battle, () => {
      switchTo(battle, a, a.team[1].id)
      useSkill(battle, b, 'skill_jianying')
    })
    assert.equal(a.activePet.name, '豚豚')
    assert.equal(hasMark(a.team[0], id('mark_hanbingjianren')), true)

    await runTurn(battle, () => {
      switchTo(battle, a, a.team[0].id)
      useSkill(battle, b, 'skill_jianying')
    })
    assert.equal(a.activePet.name, '冰川豚')
    assert.equal(hasMark(a.activePet, id('mark_hanbingjianren')), true)
    if (stripAfterReturn) stripMark(a.activePet, id('mark_hanbingjianren'))

    const rows = collectDamage(battle)
    await runTurn(battle, () => {
      useSkill(battle, a, 'skill_jianying')
      useSkill(battle, b, 'skill_zhuangji')
    })
    const hit = rows.filter(row => row.target === a.activePet.id).at(-1)
    assert.ok(hit)
    return hit.damage
  } finally {
    await stopBattle(battle, running)
  }
}

test('寒冰坚韧 stays on the pet across switching out and back and keeps reducing damage after re-entry', async () => {
  const kept = await switchScenario('switch', false)
  const stripped = await switchScenario('switch', true)
  assert.ok(stripped > 0)
  assert.ok(Math.abs(kept - stripped * 0.75) <= 1)
})

test('a JSON waiting-point snapshot retains 寒冰坚韧 and its damage effects after restore', async () => {
  let battle = await createBattle('snapshot', {
    players: [
      player('A', [pet('冰川豚', id('pet_bingchuantun'), [id('skill_hanbingjianren'), 'skill_jianying'])]),
      player('B', [pet('迪兰特', 'pet_dilan', ['skill_zhuangji', 'skill_jianying'])]),
    ],
  })
  let running = battle.startBattle().catch(cancelled)
  await battle.waitForInputReady()
  battle.playerA.currentRage = 100
  battle.playerB.currentRage = 100
  stripMark(battle.playerA.activePet, id('mark_ability_houjin'))
  stripMark(battle.playerB.activePet, 'mark_ability_zhongjie')
  await runTurn(battle, () => {
    useSkill(battle, battle.playerA, id('skill_hanbingjianren'))
    useSkill(battle, battle.playerB, 'skill_jianying')
  })
  assert.equal(hasMark(battle.playerA.activePet, id('mark_hanbingjianren')), true)
  const saved = JSON.parse(JSON.stringify(directory.snapshot(battle)))
  await battle.cleanup()
  await running

  battle = await directory.restore(saved)
  battles.push(battle)
  try {
    const a = battle.playerA.activePet
    const b = battle.playerB.activePet
    assert.equal(hasMark(a, id('mark_hanbingjianren')), true)
    const physical = new DamageContext(
      new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, b.skills[0]),
      b,
      a,
      100,
      DamageType.Physical,
      false,
      1,
      false,
      1,
    )
    const special = new DamageContext(
      new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, b.skills[0]),
      b,
      a,
      100,
      DamageType.Special,
      false,
      1,
      false,
      1,
    )
    battle.applyEffects(physical, EffectTrigger.OnBeforeCalculateDamage)
    battle.applyEffects(special, EffectTrigger.OnBeforeCalculateDamage)
    assert.equal(physical.modified[0], -25)
    assert.equal(special.modified[0], -15)

    running = battle.resumeBattle().catch(cancelled)
    await battle.waitForInputReady()
    battle.playerA.currentRage = 100
    battle.playerB.currentRage = 100
    const rows = collectDamage(battle)
    await runTurn(battle, () => {
      useSkill(battle, battle.playerA, 'skill_jianying')
      useSkill(battle, battle.playerB, 'skill_zhuangji')
    })
    assert.ok(rows.some(row => row.target === battle.playerA.activePet.id && row.damage > 0))
  } finally {
    await battle.cleanup()
    await running.catch(cancelled)
  }
})

test('all three forms retain their own stats and inherited learning lists in the base catalog', () => {
  const rows = loadBasePrototypeData().species as {
    id: string
    num: number
    baseStats: Record<string, number>
    learnable_skills: { skill_id: string; level: number; hidden: boolean }[]
  }[]
  const forms = ['pet_tuntun', 'pet_binghutun', 'pet_bingchuantun'].map(id => rows.find(row => row.id === id)!)
  assert.ok(forms.every(Boolean))
  assert.deepEqual(
    forms.map(row => row.num),
    [119, 120, 121],
  )
  assert.deepEqual(
    forms.map(row => row.baseStats),
    [
      { hp: 80, atk: 116, def: 112, spa: 117, spd: 110, spe: 95 },
      { hp: 120, atk: 141, def: 142, spa: 142, spd: 140, spe: 115 },
      { hp: 180, atk: 166, def: 172, spa: 167, spd: 170, spe: 145 },
    ],
  )
  for (let i = 1; i < forms.length; i++)
    for (const learned of forms[i - 1].learnable_skills)
      assert.ok(forms[i].learnable_skills.some(row => row.skill_id === learned.skill_id && row.level === learned.level))
  assert.deepEqual(
    forms[2].learnable_skills
      .filter(row => row.hidden)
      .map(row => row.skill_id)
      .sort(),
    ['skill_hanlengzhiqi', 'skill_bingzhuiyu', 'skill_binglengyiji', 'skill_binglengpifu'].sort(),
  )
  assert.ok(!forms[0].learnable_skills.some(row => row.skill_id === 'skill_bingbao'))
})
