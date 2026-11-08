import {
  BattleMessageType,
  setGlobalLogger,
  type Battle,
  type BattleMessage,
  type BattleOptions,
  type Pet,
  type Player,
} from '@arcadia-eternity/battle/engine'
import { createOfficialContent, type OfficialPrototypeData } from '@arcadia-eternity/data-pack-base/effects'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { loadBasePrototypeData } from './base-metadata'

const baseData: OfficialPrototypeData = loadBasePrototypeData()
const battles: Battle[] = []
const running: Promise<void>[] = []

beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
  for (const task of running.splice(0)) await task.catch(() => {})
})

type PetInput = {
  name: string
  species: string
  skills: string[]
  level: number
  evs: Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>
  ivs: Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>
  nature: 'Hardy'
  gender?: 'Male' | 'Female'
  maxHp?: number
  ability?: string
  emblem?: string
}
type TeamInput = { name: string; team: PetInput[] }
type DamageRecord = { source: string; target: string; damage: number; isCrit: boolean }

function pet(species: string, skills: string[], overrides: Partial<PetInput> = {}): PetInput {
  return {
    name: species,
    species,
    skills,
    level: 50,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: 'Hardy',
    gender: 'Male',
    ...overrides,
  }
}

const palading = 'pet_palading'
function paladinPet(species: string, skills: string[], overrides: Partial<PetInput> = {}, withEmblem = true): PetInput {
  return pet(species, skills, {
    ability: 'mark_ability_shensheng',
    ...(withEmblem ? { emblem: 'mark_emblem_bihu' } : {}),
    ...overrides,
  })
}

function team(name: string, pets: PetInput[]): TeamInput {
  return { name, team: pets }
}

function prompt(battle: Battle) {
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

function start(
  data: OfficialPrototypeData,
  teams: [TeamInput, TeamInput],
  options: Partial<BattleOptions> = {},
): { battle: Battle; a: Player; b: Player; directory: ReturnType<typeof createOfficialContent> } {
  const directory = createOfficialContent(data, 'palading/test-build')
  const [a, b] = directory.parsePlayers(teams)
  const battle = directory.createBattle(a, b, {
    rngSeed: 'palading/test/201',
    timerConfig: { enabled: false },
    ...options,
  })
  battles.push(battle)
  return { battle, a, b, directory }
}

function switchTo(battle: Battle, player: Player, petId: string) {
  const selection = battle
    .getAvailableSelection(player.id)
    .find(entry => entry.type === 'switch-pet' && entry.pet === petId)
  if (!selection) throw new Error(`Switch unavailable: ${petId}`)
  battle.setSelection(selection)
}

function use(battle: Battle, player: Player, skill: string) {
  const instance = player.activePet.skills.find(entry => entry.baseId === skill)
  if (!instance) throw new Error(`Skill not on active pet: ${skill}`)
  const selection = battle
    .getAvailableSelection(player.id)
    .find(entry => entry.type === 'use-skill' && entry.skill === instance.id)
  if (!selection) throw new Error(`Skill unavailable: ${skill}`)
  battle.setSelection(selection)
}

function collectDamage(battle: Battle) {
  const received: DamageRecord[] = []
  battle.registerListener(message => {
    if (message.type === BattleMessageType.Damage) received.push((message as unknown as { data: DamageRecord }).data)
  })
  return received
}

async function runTurn(battle: Battle, play: () => void) {
  const next = prompt(battle)
  play()
  await next
}

/**
 * Test-only skills used to isolate a single paladin mechanic with a deterministic
 * damage source. They are generic stand-ins (fixed power, sure hit); the paladin
 * mechanics under test always come from the real authored effects.
 */
type Content = OfficialPrototypeData
const TEST_SKILLS = [
  {
    id: 'skill_test_physical_120',
    element: 'Normal',
    category: 'Physical',
    target: 'opponent',
    power: 120,
    rage: 0,
    accuracy: 100,
    sureHit: true,
    ignoreShield: false,
    tags: [],
    effect: [],
  },
  {
    id: 'skill_test_special_120',
    element: 'Normal',
    category: 'Special',
    target: 'opponent',
    power: 120,
    rage: 0,
    accuracy: 100,
    sureHit: true,
    ignoreShield: false,
    tags: [],
    effect: [],
  },
  {
    id: 'skill_test_paralyze',
    element: 'Electric',
    category: 'Status',
    target: 'opponent',
    power: 0,
    rage: 0,
    accuracy: 100,
    sureHit: true,
    ignoreShield: false,
    tags: [],
    effect: ['effect_skill_add_mark_opponent_mabi'],
  },
  {
    id: 'skill_test_raise_atk',
    element: 'Normal',
    category: 'Status',
    target: 'self',
    power: 0,
    rage: 0,
    accuracy: 100,
    sureHit: true,
    ignoreShield: false,
    tags: [],
    effect: ['effect_skill_raise_atk_1_stage'],
  },
] as const

const testData: Content = { ...baseData, skills: [...baseData.skills, ...(TEST_SKILLS as never)] }

/** Remove a mark outside of the normal flow to build a controlled comparison run. */
function stripMark(pet: Pet, baseId: string) {
  pet.marks = pet.marks.filter(mark => mark.baseId !== baseId)
}

function hasMark(pet: Pet, baseId: string) {
  return pet.marks.some(mark => mark.baseId === baseId)
}

type CombatRecord = { source: string; target: string; damage: number; isCrit: boolean; damageType: string }
type RageRecord = { player: string; pet: string; before: number; after: number; reason: string }

function collectCombat(battle: Battle) {
  const damage: CombatRecord[] = []
  const rage: RageRecord[] = []
  battle.registerListener(message => {
    if (message.type === BattleMessageType.Damage) damage.push((message as unknown as { data: CombatRecord }).data)
    if (message.type === BattleMessageType.RageChange) rage.push((message as unknown as { data: RageRecord }).data)
  })
  return { damage, rage }
}

const paladingSkills = [
  'skill_chongzhuang_palading',
  'skill_shengguangzhiming',
  'skill_bihuzhihuo',
  'skill_jiushuzhihuo',
]

it('loads the paladin species, skills and battle-start ability/emblem marks for every team member', async () => {
  const directory = createOfficialContent(baseData, 'palading/catalog')
  const species = directory.getSpecies(palading as never)
  expect(species.element).toBe('Light')
  expect(species.baseStats).toEqual({ hp: 182, atk: 166, spa: 169, def: 172, spd: 170, spe: 159 })

  const { battle, a } = start(baseData, [
    team('A', [paladinPet(palading, paladingSkills), paladinPet('pet_pala', ['skill_chongzhuang_palading'])]),
    team('B', [pet('pet_dilan', ['skill_daqiliu'], { maxHp: 9999 })]),
  ])
  const ready = prompt(battle)
  running.push(battle.startBattle().catch(() => {}))
  await ready

  for (const member of a.team) {
    expect(member.marks.some(mark => mark.baseId === 'mark_ability_shensheng')).toBe(true)
    expect(member.marks.some(mark => mark.baseId === 'mark_emblem_bihu')).toBe(true)
  }
})

it('heals 1/8 below half HP and 1/16 above half HP from the permanent 神圣 mark', async () => {
  const { battle, a, b } = start(baseData, [
    team('A', [paladinPet(palading, paladingSkills, { maxHp: 800 })]),
    team('B', [pet('pet_dilan', ['skill_daqiliu'], { maxHp: 9999 })]),
  ])
  a.currentRage = 100
  const ready = prompt(battle)
  running.push(battle.startBattle().catch(() => {}))
  await ready

  a.activePet.currentHp = 320 // below half of 800
  await runTurn(battle, () => {
    use(battle, a, 'skill_shengguangzhiming')
    use(battle, b, 'skill_daqiliu')
  })

  expect(a.activePet.marks.some(mark => mark.baseId === 'mark_shensheng')).toBe(true)
  expect(a.activePet.currentHp).toBe(320 + Math.floor(800 / 8))

  await runTurn(battle, () => {
    use(battle, a, 'skill_chongzhuang_palading')
    use(battle, b, 'skill_daqiliu')
  })

  expect(a.activePet.currentHp).toBe(420 + Math.floor(800 / 16))
  expect(a.activePet.marks.some(mark => mark.baseId === 'mark_shensheng')).toBe(true)
})

it('blocks critical hits while the 神圣 mark is up (sure-crit attacker control)', async () => {
  const data: Content = {
    ...baseData,
    skills: [
      ...baseData.skills,
      {
        id: 'skill_test_sure_crit',
        element: 'Normal',
        category: 'Physical',
        target: 'opponent',
        power: 40,
        rage: 0,
        accuracy: 100,
        sureHit: false,
        sureCrit: true,
        ignoreShield: false,
        tags: [],
        effect: [],
      },
    ],
  }

  async function attack(paladinSkill: string) {
    const { battle, a, b } = start(data, [
      team('A', [paladinPet(palading, [paladinSkill, 'skill_chongzhuang_palading'], { maxHp: 800 })]),
      team('B', [pet('pet_dilan', ['skill_test_sure_crit'], { maxHp: 9999 })]),
    ])
    a.currentRage = 100
    const received = collectDamage(battle)
    const ready = prompt(battle)
    running.push(battle.startBattle().catch(() => {}))
    await ready
    await runTurn(battle, () => {
      use(battle, a, paladinSkill)
      use(battle, b, 'skill_test_sure_crit')
    })
    return received.filter(entry => entry.target === a.activePet.id)
  }

  const protectedRun = await attack('skill_shengguangzhiming')
  expect(protectedRun.length).toBeGreaterThan(0)
  expect(protectedRun.every(entry => entry.isCrit === false)).toBe(true)

  const controlRun = await attack('skill_chongzhuang_palading')
  expect(controlRun.length).toBeGreaterThan(0)
  expect(controlRun.some(entry => entry.isCrit === true)).toBe(true)
})

it('reduces physical damage by a flat 50 for 庇护 and widens it to special damage with the 庇护 emblem', async () => {
  const baseSpecies = baseData.species.find(entry => (entry as { id?: string }).id === palading) as Record<
    string,
    unknown
  >
  const data: Content = {
    ...baseData,
    species: [...baseData.species, { ...baseSpecies, id: 'pet_palading_no_emblem', emblem: [] }],
    skills: [
      ...baseData.skills,
      {
        id: 'skill_test_physical_120',
        element: 'Normal',
        category: 'Physical',
        target: 'opponent',
        power: 120,
        rage: 0,
        accuracy: 100,
        sureHit: false,
        ignoreShield: false,
        tags: [],
        effect: [],
      },
      {
        id: 'skill_test_special_120',
        element: 'Normal',
        category: 'Special',
        target: 'opponent',
        power: 120,
        rage: 0,
        accuracy: 100,
        sureHit: false,
        ignoreShield: false,
        tags: [],
        effect: [],
      },
    ],
  }

  async function hit(species: string, paladinSkill: string, attackSkill: string, withEmblem: boolean) {
    const { battle, a, b } = start(data, [
      team('A', [paladinPet(species, [paladinSkill, 'skill_chongzhuang_palading'], { maxHp: 800 }, withEmblem)]),
      team('B', [pet('pet_dilan', [attackSkill], { maxHp: 9999 })]),
    ])
    a.currentRage = 100
    const received = collectDamage(battle)
    const ready = prompt(battle)
    running.push(battle.startBattle().catch(() => {}))
    await ready
    await runTurn(battle, () => {
      use(battle, a, paladinSkill)
      use(battle, b, attackSkill)
    })
    const entries = received.filter(entry => entry.target === a.activePet.id)
    return entries[entries.length - 1]?.damage ?? -1
  }

  const physicalShield = await hit(palading, 'skill_bihuzhihuo', 'skill_test_physical_120', true)
  const physicalControl = await hit(palading, 'skill_jiushuzhihuo', 'skill_test_physical_120', true)
  expect(physicalControl - physicalShield).toBe(50)

  const specialWithEmblem = await hit(palading, 'skill_bihuzhihuo', 'skill_test_special_120', true)
  const specialWithoutEmblem = await hit('pet_palading_no_emblem', 'skill_bihuzhihuo', 'skill_test_special_120', false)
  expect(specialWithoutEmblem - specialWithEmblem).toBe(50)
})
it('restores the 神圣 state without duplicating battle-start marks', async () => {
  const { battle, a, b, directory } = start(baseData, [
    team('A', [paladinPet(palading, paladingSkills, { maxHp: 800 })]),
    team('B', [pet('pet_dilan', ['skill_daqiliu'], { maxHp: 9999 })]),
  ])
  a.currentRage = 100
  const ready = prompt(battle)
  running.push(battle.startBattle().catch(() => {}))
  await ready
  await runTurn(battle, () => {
    use(battle, a, 'skill_shengguangzhiming')
    use(battle, b, 'skill_daqiliu')
  })

  const expectedHp = battle.playerA.activePet.currentHp
  const saved = JSON.parse(JSON.stringify(directory.snapshot(battle)))
  battles.splice(battles.indexOf(battle), 1)
  await battle.cleanup()
  const restored = directory.restore(saved)
  battles.push(restored)
  const restoredPet = restored.playerA.activePet
  expect(restoredPet.marks.filter(mark => mark.baseId === 'mark_ability_shensheng')).toHaveLength(1)
  expect(restoredPet.marks.filter(mark => mark.baseId === 'mark_emblem_bihu')).toHaveLength(1)
  expect(restoredPet.marks.filter(mark => mark.baseId === 'mark_shensheng')).toHaveLength(1)
  expect(restoredPet.currentHp).toBe(expectedHp)
})

// ---------------------------------------------------------------------------
// Per-skill mechanism coverage (moves.xml 11572-11586)
// ---------------------------------------------------------------------------

it('raises physical defence from 正义之火 and adds special defence only while 神圣', async () => {
  const { battle, a, b } = start(baseData, [
    team('A', [paladinPet(palading, ['skill_zhengyizhihuo', 'skill_shengguangzhiming'], { maxHp: 800 })]),
    team('B', [pet('pet_dilan', ['skill_daqiliu'], { maxHp: 9999 })]),
  ])
  a.currentRage = 100
  const ready = prompt(battle)
  running.push(battle.startBattle().catch(() => {}))
  await ready

  const defBefore = a.activePet.stat.def
  const spdBefore = a.activePet.stat.spd
  await runTurn(battle, () => {
    a.currentRage = 100
    use(battle, a, 'skill_zhengyizhihuo')
    use(battle, b, 'skill_daqiliu')
  })
  expect(a.activePet.stat.def).toBeGreaterThan(defBefore)
  expect(a.activePet.stat.spd).toBe(spdBefore)

  await runTurn(battle, () => {
    a.currentRage = 100
    use(battle, a, 'skill_shengguangzhiming')
    use(battle, b, 'skill_daqiliu')
  })
  expect(hasMark(a.activePet, 'mark_shensheng')).toBe(true)

  const defWithMark = a.activePet.stat.def
  const spdWithMark = a.activePet.stat.spd
  await runTurn(battle, () => {
    a.currentRage = 100
    use(battle, a, 'skill_zhengyizhihuo')
    use(battle, b, 'skill_daqiliu')
  })
  expect(a.activePet.stat.def).toBeGreaterThan(defWithMark)
  expect(a.activePet.stat.spd).toBeGreaterThan(spdWithMark)
})

it('heals 1/16 at exactly half HP and 1/8 strictly below half from the 神圣 mark', async () => {
  async function healOnce(maxHp: number, hp: number) {
    const { battle, a, b } = start(baseData, [
      team('A', [paladinPet(palading, ['skill_shengguangzhiming', 'skill_chongzhuang_palading'], { maxHp })]),
      team('B', [pet('pet_dilan', ['skill_daqiliu'], { maxHp: 9999 })]),
    ])
    a.currentRage = 100
    const ready = prompt(battle)
    running.push(battle.startBattle().catch(() => {}))
    await ready
    await runTurn(battle, () => {
      a.currentRage = 100
      use(battle, a, 'skill_shengguangzhiming')
      use(battle, b, 'skill_daqiliu')
    })
    expect(hasMark(a.activePet, 'mark_shensheng')).toBe(true)
    a.activePet.currentHp = hp
    await runTurn(battle, () => {
      a.currentRage = 100
      use(battle, a, 'skill_chongzhuang_palading')
      use(battle, b, 'skill_daqiliu')
    })
    return a.activePet.currentHp - hp
  }

  expect(await healOnce(800, 400)).toBe(Math.floor(800 / 16)) // exactly half is not "below half"
  expect(await healOnce(800, 399)).toBe(Math.floor(800 / 8))
  // 801 HP: half is 400.5, so 400 is strictly below half and heals 1/8.
  expect(await healOnce(801, 400)).toBe(Math.floor(801 / 8))
})

it('keeps the 庇护 1/8 turn-end heal for five turns', async () => {
  const { battle, a, b } = start(baseData, [
    team('A', [paladinPet(palading, ['skill_bihuzhihuo', 'skill_chongzhuang_palading'], { maxHp: 8000 })]),
    team('B', [pet('pet_dilan', ['skill_daqiliu'], { maxHp: 99999 })]),
  ])
  a.currentRage = 100
  const ready = prompt(battle)
  running.push(battle.startBattle().catch(() => {}))
  await ready
  a.activePet.currentHp = 100

  await runTurn(battle, () => {
    a.currentRage = 100
    use(battle, a, 'skill_bihuzhihuo')
    use(battle, b, 'skill_daqiliu')
  })
  expect(hasMark(a.activePet, 'mark_bihu')).toBe(true)
  expect(a.activePet.currentHp).toBe(100 + 1000)

  for (let turn = 2; turn <= 5; turn++) {
    await runTurn(battle, () => {
      a.currentRage = 100
      use(battle, a, 'skill_chongzhuang_palading')
      use(battle, b, 'skill_daqiliu')
    })
    expect(a.activePet.currentHp).toBe(100 + 1000 * turn)
  }
  // The mark lasts the five turns it was applied on and expires at the end of the fifth.
  expect(hasMark(a.activePet, 'mark_bihu')).toBe(false)

  await runTurn(battle, () => {
    a.currentRage = 100
    use(battle, a, 'skill_chongzhuang_palading')
    use(battle, b, 'skill_daqiliu')
  })
  expect(a.activePet.currentHp).toBe(5100)
})

it('halves special damage with 圣佑 and heals 1/8 per turn while it lasts', async () => {
  async function run(withShengyou: boolean) {
    const { battle, a, b } = start(testData, [
      team('A', [paladinPet(palading, ['skill_shengyouzhihuo', 'skill_test_physical_120'], { maxHp: 8000 })]),
      team('B', [pet('pet_dilan', ['skill_test_special_120', 'skill_daqiliu'], { maxHp: 99999 })]),
    ])
    a.currentRage = 100
    const received = collectDamage(battle)
    const ready = prompt(battle)
    running.push(battle.startBattle().catch(() => {}))
    await ready
    await runTurn(battle, () => {
      a.currentRage = 100
      use(battle, a, 'skill_shengyouzhihuo')
      use(battle, b, 'skill_daqiliu')
    })
    expect(hasMark(a.activePet, 'mark_shengyou')).toBe(true)
    if (!withShengyou) stripMark(a.activePet, 'mark_shengyou')
    a.activePet.currentHp = 4000
    await runTurn(battle, () => {
      a.currentRage = 100
      use(battle, a, 'skill_test_physical_120')
      use(battle, b, 'skill_test_special_120')
    })
    const taken = received.filter(entry => entry.target === a.activePet.id)
    return { damage: taken[taken.length - 1]?.damage ?? -1, hp: a.activePet.currentHp }
  }

  const shielded = await run(true)
  const control = await run(false)
  expect(control.damage).toBeGreaterThan(0)
  expect(Math.abs(shielded.damage - control.damage / 2)).toBeLessThanOrEqual(1)
  // The mark heals 1/8 (1000) at turn end; the control lost only the incoming damage.
  expect(shielded.hp - control.hp).toBe(control.damage - shielded.damage + 1000)
})

it('blocks opponent stat boosts with 公正 for three turns', async () => {
  const { battle, a, b } = start(testData, [
    team('A', [paladinPet(palading, ['skill_gongzhengguangchong', 'skill_chongzhuang_palading'], { maxHp: 8000 })]),
    team('B', [pet('pet_dilan', ['skill_test_raise_atk'], { maxHp: 99999 })]),
  ])
  a.currentRage = 100
  const ready = prompt(battle)
  running.push(battle.startBattle().catch(() => {}))
  await ready

  const atk = b.activePet.stat.atk
  await runTurn(battle, () => {
    a.currentRage = 100
    use(battle, a, 'skill_gongzhengguangchong')
    use(battle, b, 'skill_test_raise_atk')
  })
  expect(hasMark(b.activePet, 'mark_gongzheng')).toBe(true)
  expect(b.activePet.stat.atk).toBe(atk)

  for (let turn = 2; turn <= 3; turn++) {
    await runTurn(battle, () => {
      a.currentRage = 100
      use(battle, a, 'skill_chongzhuang_palading')
      use(battle, b, 'skill_test_raise_atk')
    })
    expect(b.activePet.stat.atk).toBe(atk)
  }

  await runTurn(battle, () => {
    a.currentRage = 100
    use(battle, a, 'skill_chongzhuang_palading')
    use(battle, b, 'skill_test_raise_atk')
  })
  expect(hasMark(b.activePet, 'mark_gongzheng')).toBe(false)
  expect(b.activePet.stat.atk).toBeGreaterThan(atk)
})

it('blocks abnormal states with 使命 for five turns', async () => {
  async function run(withMingshi: boolean) {
    const { battle, a, b } = start(testData, [
      team('A', [paladinPet(palading, ['skill_shimingzhihuo', 'skill_chongzhuang_palading'], { maxHp: 99999 })]),
      team('B', [pet('pet_dilan', ['skill_test_paralyze', 'skill_daqiliu'], { maxHp: 99999 })]),
    ])
    a.currentRage = 100
    const ready = prompt(battle)
    running.push(battle.startBattle().catch(() => {}))
    await ready
    await runTurn(battle, () => {
      a.currentRage = 100
      use(battle, a, withMingshi ? 'skill_shimingzhihuo' : 'skill_chongzhuang_palading')
      use(battle, b, 'skill_daqiliu')
    })
    expect(hasMark(a.activePet, 'mark_mingshi')).toBe(withMingshi)
    const seen: boolean[] = []
    for (let turn = 2; turn <= 6; turn++) {
      await runTurn(battle, () => {
        a.currentRage = 100
        use(battle, a, 'skill_chongzhuang_palading')
        use(battle, b, 'skill_test_paralyze')
      })
      seen.push(hasMark(a.activePet, 'mark_mabi'))
    }
    return seen
  }

  // Control: without 使命 the first 异常状态 lands, which proves the test skill works.
  expect(await run(false)).toEqual([true, true, true, true, true])
  // The 使命 mark is gone after its fifth turn, so the abnormal state lands on turn 6.
  expect(await run(true)).toEqual([false, false, false, false, true])
})

it('adds 35% damage dealt and 35% lifesteal with 征伐', async () => {
  async function run(withZhengfa: boolean) {
    const { battle, a, b } = start(testData, [
      team('A', [paladinPet(palading, ['skill_zhengfazhihuo', 'skill_test_physical_120'], { maxHp: 8000 })]),
      team('B', [pet('pet_dilan', ['skill_daqiliu'], { maxHp: 99999 })]),
    ])
    a.currentRage = 100
    const received = collectDamage(battle)
    const ready = prompt(battle)
    running.push(battle.startBattle().catch(() => {}))
    await ready
    await runTurn(battle, () => {
      a.currentRage = 100
      use(battle, a, 'skill_zhengfazhihuo')
      use(battle, b, 'skill_daqiliu')
    })
    expect(hasMark(a.activePet, 'mark_zhengfa')).toBe(true)
    if (!withZhengfa) stripMark(a.activePet, 'mark_zhengfa')
    a.activePet.currentHp = 4000
    await runTurn(battle, () => {
      a.currentRage = 100
      use(battle, a, 'skill_test_physical_120')
      use(battle, b, 'skill_daqiliu')
    })
    const dealt = received.filter(entry => entry.target === b.activePet.id)
    const damage = dealt[dealt.length - 1]?.damage ?? -1
    return { damage, hp: a.activePet.currentHp }
  }

  const boosted = await run(true)
  const control = await run(false)
  expect(control.damage).toBeGreaterThan(0)
  expect(Math.abs(boosted.damage - control.damage * 1.35)).toBeLessThanOrEqual(2)
  expect(boosted.hp).toBe(4000 + Math.floor(boosted.damage * 0.35))
  expect(control.hp).toBe(4000)
})

it('doubles 复仇光冲 power only when every partner has fainted', async () => {
  async function attack(faintedPartner: boolean) {
    const { battle, a, b } = start(baseData, [
      team('A', [
        paladinPet(palading, ['skill_fuchouguangchong'], { maxHp: 8000 }),
        paladinPet(palading, ['skill_chongzhuang_palading'], { maxHp: 8000 }),
      ]),
      team('B', [pet('pet_dilan', ['skill_daqiliu'], { maxHp: 99999 })]),
    ])
    a.currentRage = 100
    const received = collectDamage(battle)
    const ready = prompt(battle)
    running.push(battle.startBattle().catch(() => {}))
    await ready
    if (faintedPartner) a.team[1].currentHp = 0
    await runTurn(battle, () => {
      a.currentRage = 100
      use(battle, a, 'skill_fuchouguangchong')
      use(battle, b, 'skill_daqiliu')
    })
    const dealt = received.filter(entry => entry.target === b.activePet.id)
    return dealt[dealt.length - 1]?.damage ?? -1
  }

  const normal = await attack(false)
  const doubled = await attack(true)
  expect(normal).toBeGreaterThan(0)
  expect(Math.abs(doubled - normal * 2)).toBeLessThanOrEqual(2)
})

it('resolves 救赎 only strictly below 1/8 HP and consumes the mark when it heals', async () => {
  async function apply(maxHp: number, hp: number) {
    const { battle, a, b } = start(testData, [
      team('A', [paladinPet(palading, ['skill_jiushuzhihuo', 'skill_chongzhuang_palading'], { maxHp })]),
      team('B', [pet('pet_dilan', ['skill_daqiliu'], { maxHp: 99999 })]),
    ])
    a.currentRage = 100
    const ready = prompt(battle)
    running.push(battle.startBattle().catch(() => {}))
    await ready
    a.activePet.currentHp = hp
    await runTurn(battle, () => {
      a.currentRage = 100
      use(battle, a, 'skill_jiushuzhihuo')
      use(battle, b, 'skill_daqiliu')
    })
    return { hp: a.activePet.currentHp, mark: hasMark(a.activePet, 'mark_jiushu') }
  }

  expect(await apply(800, 100)).toEqual({ hp: 100, mark: true }) // exactly 1/8 does not trigger
  expect(await apply(800, 99)).toEqual({ hp: 199, mark: false })
  // 801 HP: 1/8 is 100.125, so 100 HP is already below the threshold.
  expect(await apply(801, 100)).toEqual({ hp: 200, mark: false })
})

it('triggers 救赎 when incoming damage drops the owner below 1/8 HP', async () => {
  const { battle, a, b } = start(testData, [
    team('A', [paladinPet(palading, ['skill_jiushuzhihuo', 'skill_chongzhuang_palading'], { maxHp: 800 })]),
    team('B', [pet('pet_dilan', ['skill_test_physical_120', 'skill_daqiliu'], { maxHp: 99999 })]),
  ])
  a.currentRage = 100
  const received = collectDamage(battle)
  const ready = prompt(battle)
  running.push(battle.startBattle().catch(() => {}))
  await ready
  await runTurn(battle, () => {
    a.currentRage = 100
    use(battle, a, 'skill_jiushuzhihuo')
    use(battle, b, 'skill_daqiliu')
  })
  expect(hasMark(a.activePet, 'mark_jiushu')).toBe(true)

  a.activePet.currentHp = 105
  await runTurn(battle, () => {
    a.currentRage = 100
    use(battle, a, 'skill_chongzhuang_palading')
    use(battle, b, 'skill_test_physical_120')
  })
  const taken = received.filter(entry => entry.target === a.activePet.id)
  const damage = taken[taken.length - 1]?.damage ?? -1
  expect(damage).toBeGreaterThanOrEqual(6)
  expect(a.activePet.currentHp).toBe(105 - damage + 100)
  expect(hasMark(a.activePet, 'mark_jiushu')).toBe(false)
})

it('raises exactly one defence stat from 荣耀的圣战 only in 神圣', async () => {
  async function climax(withShensheng: boolean) {
    const { battle, a, b } = start(baseData, [
      team('A', [paladinPet(palading, ['skill_shengguangzhiming', 'skill_rongyaodeshengzhan'], { maxHp: 8000 })]),
      team('B', [pet('pet_dilan', ['skill_daqiliu'], { maxHp: 99999 })]),
    ])
    a.currentRage = 100
    const ready = prompt(battle)
    running.push(battle.startBattle().catch(() => {}))
    await ready
    await runTurn(battle, () => {
      a.currentRage = 100
      use(battle, a, 'skill_shengguangzhiming')
      use(battle, b, 'skill_daqiliu')
    })
    expect(hasMark(a.activePet, 'mark_shensheng')).toBe(true)
    if (!withShensheng) stripMark(a.activePet, 'mark_shensheng')
    const before = { def: a.activePet.stat.def, spd: a.activePet.stat.spd }
    await runTurn(battle, () => {
      a.currentRage = 100
      use(battle, a, 'skill_rongyaodeshengzhan')
      use(battle, b, 'skill_daqiliu')
    })
    return {
      def: a.activePet.stat.def - before.def,
      spd: a.activePet.stat.spd - before.spd,
    }
  }

  const control = await climax(false)
  expect(control).toEqual({ def: 0, spd: 0 })
  const blessed = await climax(true)
  expect(Number(blessed.def > 0) + Number(blessed.spd > 0)).toBe(1)
})

it('resolves 圣光之名 before a faster opponent because of 先制+1', async () => {
  async function order(paladinSkill: string) {
    const { battle, a, b } = start(testData, [
      team('A', [paladinPet(palading, ['skill_shengguangzhiming', 'skill_chongzhuang_palading'], { maxHp: 8000 })]),
      team('B', [pet('pet_leiyi', ['skill_test_physical_120'], { maxHp: 99999 })]),
    ])
    a.currentRage = 100
    const used: string[] = []
    battle.registerListener(message => {
      if (message.type === BattleMessageType.SkillUse)
        used.push((message as unknown as { data: { user: string; baseSkill: string } }).data.baseSkill)
    })
    const ready = prompt(battle)
    running.push(battle.startBattle().catch(() => {}))
    await ready
    expect(b.activePet.stat.spe).toBeGreaterThan(a.activePet.stat.spe)
    await runTurn(battle, () => {
      a.currentRage = 100
      use(battle, a, paladinSkill)
      use(battle, b, 'skill_test_physical_120')
    })
    return used
  }

  expect((await order('skill_chongzhuang_palading')).slice(0, 2)).toEqual([
    'skill_test_physical_120',
    'skill_chongzhuang_palading',
  ])
  expect((await order('skill_shengguangzhiming')).slice(0, 2)).toEqual([
    'skill_shengguangzhiming',
    'skill_test_physical_120',
  ])
})

it('adds flat 15% stat damage from 惩戒之光 and 审判光冲 only in 神圣', async () => {
  async function attack(skill: string, withShensheng: boolean) {
    const { battle, a, b } = start(baseData, [
      team('A', [paladinPet(palading, ['skill_shengguangzhiming', skill], { maxHp: 8000 })]),
      team('B', [pet('pet_dilan', ['skill_daqiliu'], { maxHp: 999999 })]),
    ])
    a.currentRage = 100
    const received = collectDamage(battle)
    const ready = prompt(battle)
    running.push(battle.startBattle().catch(() => {}))
    await ready
    await runTurn(battle, () => {
      a.currentRage = 100
      use(battle, a, 'skill_shengguangzhiming')
      use(battle, b, 'skill_daqiliu')
    })
    expect(hasMark(a.activePet, 'mark_shensheng')).toBe(true)
    if (!withShensheng) stripMark(a.activePet, 'mark_shensheng')
    const spa = a.activePet.stat.spa
    const atk = a.activePet.stat.atk
    await runTurn(battle, () => {
      a.currentRage = 100
      use(battle, a, skill)
      use(battle, b, 'skill_daqiliu')
    })
    const dealt = received.filter(entry => entry.target === b.activePet.id)
    return { damage: dealt[dealt.length - 1]?.damage ?? -1, spa, atk }
  }

  const chengjie = await attack('skill_chengjiezhiguang', true)
  const chengjieControl = await attack('skill_chengjiezhiguang', false)
  expect(chengjie.damage - chengjieControl.damage).toBe(Math.floor(chengjie.spa * 0.15))

  const shenpan = await attack('skill_shenpanguangchong', true)
  const shenpanControl = await attack('skill_shenpanguangchong', false)
  expect(shenpan.damage - shenpanControl.damage).toBe(Math.floor(shenpan.atk * 0.15))
})

it('increases 十字光冲 damage by 50% while in 神圣', async () => {
  async function attack(withShensheng: boolean) {
    const { battle, a, b } = start(baseData, [
      team('A', [paladinPet(palading, ['skill_shengguangzhiming', 'skill_shiziguangchong'], { maxHp: 8000 })]),
      team('B', [pet('pet_dilan', ['skill_daqiliu'], { maxHp: 999999 })]),
    ])
    a.currentRage = 100
    const received = collectDamage(battle)
    const ready = prompt(battle)
    running.push(battle.startBattle().catch(() => {}))
    await ready
    await runTurn(battle, () => {
      a.currentRage = 100
      use(battle, a, 'skill_shengguangzhiming')
      use(battle, b, 'skill_daqiliu')
    })
    if (!withShensheng) stripMark(a.activePet, 'mark_shensheng')
    await runTurn(battle, () => {
      a.currentRage = 100
      use(battle, a, 'skill_shiziguangchong')
      use(battle, b, 'skill_daqiliu')
    })
    const dealt = received.filter(entry => entry.target === b.activePet.id)
    return dealt[dealt.length - 1]?.damage ?? -1
  }

  const blessed = await attack(true)
  const control = await attack(false)
  expect(control).toBeGreaterThan(0)
  expect(blessed).toBeGreaterThan(control)
  expect(Math.abs(blessed - control * 1.5)).toBeLessThanOrEqual(2)
})

it('heals the opponent 100 and removes 35 of their rage with 拯救之火', async () => {
  const { battle, a, b } = start(testData, [
    team('A', [paladinPet(palading, ['skill_zhengjiuzhihuo'], { maxHp: 99999 })]),
    team('B', [pet('pet_dilan', ['skill_daqiliu'], { maxHp: 99999 })]),
  ])
  a.currentRage = 100
  b.currentRage = 50
  const combat = collectCombat(battle)
  const ready = prompt(battle)
  running.push(battle.startBattle().catch(() => {}))
  await ready
  b.currentRage = 50
  b.activePet.currentHp = 500
  await runTurn(battle, () => {
    use(battle, a, 'skill_zhengjiuzhihuo')
    use(battle, b, 'skill_daqiliu')
  })
  expect(b.activePet.currentHp).toBe(600)
  const drained = combat.rage.filter(
    entry => entry.pet === b.activePet.id && entry.before - entry.after === 35 && entry.reason === 'effect',
  )
  expect(drained).toHaveLength(1)
})

it('keeps the 庇护 state and the battle-start marks across a switch out and back', async () => {
  const { battle, a, b } = start(baseData, [
    team('A', [
      paladinPet(palading, ['skill_bihuzhihuo', 'skill_chongzhuang_palading'], { maxHp: 8000 }),
      paladinPet(palading, ['skill_chongzhuang_palading'], { maxHp: 8000 }),
    ]),
    team('B', [pet('pet_dilan', ['skill_daqiliu'], { maxHp: 99999 })]),
  ])
  a.currentRage = 100
  const ready = prompt(battle)
  running.push(battle.startBattle().catch(() => {}))
  await ready
  const paladin = a.team[0]
  const backup = a.team[1]
  a.activePet.currentHp = 4000

  await runTurn(battle, () => {
    a.currentRage = 100
    use(battle, a, 'skill_bihuzhihuo')
    use(battle, b, 'skill_daqiliu')
  })
  expect(paladin.currentHp).toBe(5000)

  await runTurn(battle, () => {
    a.currentRage = 100
    switchTo(battle, a, backup.id)
    use(battle, b, 'skill_daqiliu')
  })
  expect(a.activePet).toBe(backup)
  expect(paladin.currentHp).toBe(5000) // the heal only runs while the owner is active

  await runTurn(battle, () => {
    a.currentRage = 100
    use(battle, a, 'skill_chongzhuang_palading')
    use(battle, b, 'skill_daqiliu')
  })
  expect(paladin.currentHp).toBe(5000)

  await runTurn(battle, () => {
    a.currentRage = 100
    switchTo(battle, a, paladin.id)
    use(battle, b, 'skill_daqiliu')
  })
  expect(a.activePet).toBe(paladin)
  expect(paladin.currentHp).toBe(6000)
  expect(paladin.marks.filter(mark => mark.baseId === 'mark_bihu')).toHaveLength(1)
  expect(paladin.marks.filter(mark => mark.baseId === 'mark_ability_shensheng')).toHaveLength(1)
  expect(paladin.marks.filter(mark => mark.baseId === 'mark_emblem_bihu')).toHaveLength(1)
})
