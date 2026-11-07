import {
  AddMarkContext,
  BattleMessageType,
  EffectContext,
  EffectTrigger,
  TurnContext,
  setGlobalLogger,
  type Battle,
  type BattleMessage,
  type BattleOptions,
  type Pet,
  type Player,
} from '@arcadia-eternity/battle/v4'
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

type Stats = Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>
type PetInput = {
  name: string
  species: string
  skills: string[]
  level: number
  evs: Stats
  ivs: Stats
  nature: 'Hardy'
  gender?: 'Male' | 'Female'
  maxHp?: number
  ability?: string
  emblem?: string
}
type TeamInput = { name: string; team: PetInput[] }
type DamageRecord = { source: string; target: string; damage: number; isCrit: boolean; damageType: string }

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

function team(name: string, pets: PetInput[]): TeamInput {
  return { name, team: pets }
}

/** Player draft that equips the species' ability and emblem, like a real team entry. */
function kadunPet(species: string, skills: string[], overrides: Partial<PetInput> = {}): PetInput {
  return pet(species, skills, {
    ability: 'mark_ability_yinji',
    emblem: 'mark_emblem_hongxin',
    ...overrides,
  })
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
  const directory = createOfficialContent(data, 'kadundudu/test-build')
  const [a, b] = directory.parsePlayers(teams)
  const battle = directory.createBattle(a, b, {
    rngSeed: 'kadundudu/test/71',
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

function hasMark(pet: Pet, baseId: string) {
  return pet.marks.some(mark => mark.baseId === baseId)
}

function markStack(pet: Pet, baseId: string) {
  return pet.marks.find(mark => mark.baseId === baseId)?.stack ?? 0
}

function statStage(pet: Pet, stat: string) {
  const mark = pet.marks.find(entry => entry.baseId === `stat_stage_${stat}_up`) as { level?: number } | undefined
  return mark?.level ?? 0
}

function stripMark(pet: Pet, baseId: string) {
  pet.marks = pet.marks.filter(mark => mark.baseId !== baseId)
}

/** Add a mark with the same public battle API used by authored effects. */
function addMark(battle: Battle, directory: ReturnType<typeof createOfficialContent>, pet: Pet, baseId: string) {
  const context = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, pet.skills[0])
  battle.addMark(new AddMarkContext(context, pet, directory.getMark(baseId as never), 1))
}

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
    id: 'skill_test_status',
    element: 'Normal',
    category: 'Status',
    target: 'self',
    power: 0,
    rage: 0,
    accuracy: 100,
    sureHit: true,
    ignoreShield: false,
    tags: [],
    effect: [],
  },
] as const

const KADUN = 'pet_kadundudu'
const KADUN_NO_ABILITY = 'pet_kadundudu_no_ability'
const KADUN_NO_EMBLEM = 'pet_kadundudu_no_emblem'

function speciesVariant(
  data: OfficialPrototypeData,
  id: string,
  overrides: Record<string, unknown>,
): OfficialPrototypeData {
  const source = data.species.find(entry => (entry as { id?: string }).id === KADUN) as Record<string, unknown>
  return { ...data, species: [...data.species, { ...source, id, ...overrides }] }
}

const baseTestData: OfficialPrototypeData = {
  ...baseData,
  skills: [...baseData.skills, ...(TEST_SKILLS as never)],
}
const testData = speciesVariant(speciesVariant(baseTestData, KADUN_NO_ABILITY, { ability: [] }), KADUN_NO_EMBLEM, {
  emblem: [],
})

it('loads form 71 stats, the 17-move learn list, and battle-start ability/emblem marks for every team member', () => {
  const directory = createOfficialContent(baseData, 'kadundudu/catalog')
  const species = directory.getSpecies(KADUN as never)
  expect(species.element).toBe('Normal')
  expect(species.baseStats).toEqual({ hp: 178, atk: 175, spa: 163, def: 174, spd: 164, spe: 144 })
  const rawSpecies = baseData.species.find(entry => (entry as { id?: string }).id === KADUN) as {
    ability: string[]
    emblem: string[]
    learnable_skills: { skill_id: string; hidden: boolean }[]
  }
  expect(rawSpecies.ability).toEqual(['mark_ability_yinji'])
  expect(rawSpecies.emblem).toEqual(['mark_emblem_hongxin'])
  expect(rawSpecies.learnable_skills.map(skill => skill.skill_id)).toEqual([
    'skill_chongzhuang',
    'skill_jianqiang',
    'skill_hongxin',
    'skill_hongxinyinji',
    'skill_hongxinchongzhuang',
    'skill_jianren',
    'skill_hongxinqianghua',
    'skill_hongxinshexian',
    'skill_quanliyiji_kadundudu',
    'skill_tuihuashexian',
    'skill_quanlichongfeng',
    'skill_hongxinhuifu',
    'skill_qunxinmantian',
    'skill_taohongyinji',
    'skill_hongxinpengzhuang',
    'skill_hongxinjizhuang',
    'skill_hongxinlianjie',
  ])
  expect(rawSpecies.learnable_skills.filter(skill => skill.hidden).map(skill => skill.skill_id)).toEqual([
    'skill_taohongyinji',
    'skill_hongxinpengzhuang',
    'skill_hongxinjizhuang',
    'skill_hongxinlianjie',
  ])
})

it('grants the 印记 and 红心 emblem marks to active and benched team members at battle start', async () => {
  const { battle, a } = start(testData, [
    team('A', [kadunPet(KADUN, ['skill_hongxinyinji']), kadunPet('pet_dudu', ['skill_hongxinyinji'])]),
    team('B', [pet('pet_dilan', ['skill_test_status'], { maxHp: 9999 })]),
  ])
  const ready = prompt(battle)
  running.push(battle.startBattle().catch(() => {}))
  await ready
  for (const member of a.team) {
    expect(member.marks.filter(mark => mark.baseId === 'mark_ability_yinji')).toHaveLength(1)
    expect(member.marks.filter(mark => mark.baseId === 'mark_emblem_hongxin')).toHaveLength(1)
  }
})

it('红心印记 adds one self stack per hit and the 印记 ability raises damage by 10%', async () => {
  const { battle, a, b } = start(testData, [
    team('A', [kadunPet(KADUN, ['skill_hongxinyinji', 'skill_test_status'], { maxHp: 8000 })]),
    team('B', [pet('pet_dilan', ['skill_test_status'], { maxHp: 99999 })]),
  ])
  a.currentRage = 100
  const ready = prompt(battle)
  running.push(battle.startBattle().catch(() => {}))
  await ready

  await runTurn(battle, () => {
    use(battle, a, 'skill_hongxinyinji')
    use(battle, b, 'skill_test_status')
  })
  expect(markStack(a.activePet, 'mark_hongxinyinji')).toBe(1)

  await runTurn(battle, () => {
    use(battle, a, 'skill_hongxinyinji')
    use(battle, b, 'skill_test_status')
  })
  expect(markStack(a.activePet, 'mark_hongxinyinji')).toBe(2)

  async function attack(mark: 'none' | 'hongxin' | 'taohong') {
    const run = start(testData, [
      team('A', [kadunPet(KADUN, ['skill_test_physical_120'], { maxHp: 8000 })]),
      team('B', [pet('pet_dilan', ['skill_test_status'], { maxHp: 99999 })]),
    ])
    const received = collectDamage(run.battle)
    const ready = prompt(run.battle)
    running.push(run.battle.startBattle().catch(() => {}))
    await ready
    if (mark === 'hongxin') addMark(run.battle, run.directory, run.a.activePet, 'mark_hongxinyinji')
    if (mark === 'taohong') addMark(run.battle, run.directory, run.a.activePet, 'mark_taohongyinji')
    await runTurn(run.battle, () => {
      use(run.battle, run.a, 'skill_test_physical_120')
      use(run.battle, run.b, 'skill_test_status')
    })
    const dealt = received.filter(entry => entry.target === run.b.activePet.id)
    return dealt[dealt.length - 1]?.damage ?? -1
  }

  const normal = await attack('none')
  const boosted = await attack('hongxin')
  const substitute = await attack('taohong')
  expect(normal).toBeGreaterThan(0)
  expect(Math.abs(boosted - normal * 1.1)).toBeLessThanOrEqual(2)
  expect(Math.abs(substitute - normal * 1.1)).toBeLessThanOrEqual(2)
})

it('红心强化 is ATK+1 without a mark, ATK+2 and consumes one real mark with 红心印记', async () => {
  async function strengthen(withMark: 'none' | 'hongxin' | 'taohong' | 'two-hongxin') {
    const run = start(testData, [
      team('A', [kadunPet(KADUN, ['skill_hongxinqianghua', 'skill_test_status'], { maxHp: 8000 })]),
      team('B', [pet('pet_dilan', ['skill_test_status'], { maxHp: 99999 })]),
    ])
    run.a.currentRage = 100
    const ready = prompt(run.battle)
    running.push(run.battle.startBattle().catch(() => {}))
    await ready
    if (withMark === 'hongxin') addMark(run.battle, run.directory, run.a.activePet, 'mark_hongxinyinji')
    if (withMark === 'taohong') addMark(run.battle, run.directory, run.a.activePet, 'mark_taohongyinji')
    if (withMark === 'two-hongxin') {
      addMark(run.battle, run.directory, run.a.activePet, 'mark_hongxinyinji')
      addMark(run.battle, run.directory, run.a.activePet, 'mark_hongxinyinji')
    }
    await runTurn(run.battle, () => {
      use(run.battle, run.a, 'skill_hongxinqianghua')
      use(run.battle, run.b, 'skill_test_status')
    })
    return {
      stage: statStage(run.a.activePet, 'atk'),
      hongxin: markStack(run.a.activePet, 'mark_hongxinyinji'),
      taohong: markStack(run.a.activePet, 'mark_taohongyinji'),
    }
  }

  expect(await strengthen('none')).toMatchObject({ stage: 1, hongxin: 0, taohong: 0 })
  expect(await strengthen('hongxin')).toMatchObject({ stage: 2, hongxin: 0 })
  expect(await strengthen('taohong')).toMatchObject({ stage: 2, taohong: 1 })
  expect(await strengthen('two-hongxin')).toMatchObject({ stage: 2, hongxin: 1 })
})

it('红心冲撞 consumes 红心印记 for double power and 桃红印记 substitutes without being consumed', async () => {
  async function strike(mark: 'none' | 'hongxin' | 'taohong') {
    const run = start(testData, [
      team('A', [pet(KADUN_NO_ABILITY, ['skill_hongxinchongzhuang'], { maxHp: 8000 })]),
      team('B', [pet('pet_dilan', ['skill_test_status'], { maxHp: 99999 })]),
    ])
    const received = collectDamage(run.battle)
    const ready = prompt(run.battle)
    running.push(run.battle.startBattle().catch(() => {}))
    await ready
    if (mark === 'hongxin') addMark(run.battle, run.directory, run.a.activePet, 'mark_hongxinyinji')
    if (mark === 'taohong') addMark(run.battle, run.directory, run.a.activePet, 'mark_taohongyinji')
    await runTurn(run.battle, () => {
      use(run.battle, run.a, 'skill_hongxinchongzhuang')
      use(run.battle, run.b, 'skill_test_status')
    })
    const dealt = received.filter(entry => entry.target === run.b.activePet.id)
    return {
      damage: dealt[dealt.length - 1]?.damage ?? -1,
      hongxin: markStack(run.a.activePet, 'mark_hongxinyinji'),
      taohong: markStack(run.a.activePet, 'mark_taohongyinji'),
    }
  }

  const normal = await strike('none')
  const hongxin = await strike('hongxin')
  const taohong = await strike('taohong')
  expect(normal.damage).toBeGreaterThan(0)
  expect(Math.abs(hongxin.damage - normal.damage * 2)).toBeLessThanOrEqual(2)
  expect(hongxin.hongxin).toBe(0)
  expect(Math.abs(taohong.damage - normal.damage * 2)).toBeLessThanOrEqual(2)
  expect(taohong.taohong).toBe(1)
})

/**
 * The combo moves need both a self 红心印记 and an opponent 心之印记. The form 71
 * learn list cannot apply 心之印记, so this uses a same-team 啾啾 to apply it and
 * then switches to 卡顿嘟嘟; this is the actual cross-pet combination.
 */
async function comboBattle(skill: string, options: { stripOpponentMark?: boolean; stripSelfMark?: boolean } = {}) {
  const run = start(testData, [
    team('A', [
      pet('pet_jiujiu', ['skill_xinzhiyinji', 'skill_test_status'], { maxHp: 8000 }),
      pet(KADUN_NO_ABILITY, ['skill_hongxinyinji', skill, 'skill_test_status'], { maxHp: 8000 }),
    ]),
    team('B', [pet('pet_dilan', ['skill_test_status', 'skill_test_physical_120'], { maxHp: 99999 })]),
  ])
  run.a.currentRage = 100
  const received = collectDamage(run.battle)
  const ready = prompt(run.battle)
  running.push(run.battle.startBattle().catch(() => {}))
  await ready

  await runTurn(run.battle, () => {
    use(run.battle, run.a, 'skill_xinzhiyinji')
    use(run.battle, run.b, 'skill_test_status')
  })
  expect(hasMark(run.b.activePet, 'mark_xinzhiyinji')).toBe(true)

  await runTurn(run.battle, () => {
    switchTo(run.battle, run.a, run.a.team[1].id)
    use(run.battle, run.b, 'skill_test_status')
  })
  expect(run.a.activePet.name).toBe(KADUN_NO_ABILITY)

  await runTurn(run.battle, () => {
    use(run.battle, run.a, 'skill_hongxinyinji')
    use(run.battle, run.b, 'skill_test_status')
  })
  expect(markStack(run.a.activePet, 'mark_hongxinyinji')).toBe(1)

  if (options.stripOpponentMark) stripMark(run.b.activePet, 'mark_xinzhiyinji')
  if (options.stripSelfMark) stripMark(run.a.activePet, 'mark_hongxinyinji')

  const beforeCount = received.length
  await runTurn(run.battle, () => {
    use(run.battle, run.a, skill)
    use(run.battle, run.b, 'skill_test_status')
  })
  const dealt = received.slice(beforeCount).filter(entry => entry.target === run.b.activePet.id)
  return { run, damage: dealt[0]?.damage ?? -1, received }
}

it('红心碰撞 doubles power only with self 红心印记 and opponent 心之印记 and does not consume the marks', async () => {
  const combo = await comboBattle('skill_hongxinpengzhuang')
  const control = await comboBattle('skill_hongxinpengzhuang', { stripOpponentMark: true })
  expect(combo.damage).toBeGreaterThan(0)
  expect(control.damage).toBeGreaterThan(0)
  expect(Math.abs(combo.damage - control.damage * 2)).toBeLessThanOrEqual(2)
  expect(hasMark(combo.run.a.activePet, 'mark_hongxinyinji')).toBe(true)
  expect(hasMark(combo.run.b.activePet, 'mark_xinzhiyinji')).toBe(true)
})

it('红心激撞 consumes both marks for double power; 红心连接 consumes both and applies the 5-turn shared-damage mark', async () => {
  const jizhuang = await comboBattle('skill_hongxinjizhuang')
  const control = await comboBattle('skill_hongxinjizhuang', { stripOpponentMark: true })
  expect(jizhuang.damage).toBeGreaterThan(0)
  expect(control.damage).toBeGreaterThan(0)
  expect(Math.abs(jizhuang.damage - control.damage * 2)).toBeLessThanOrEqual(3)
  expect(hasMark(jizhuang.run.a.activePet, 'mark_hongxinyinji')).toBe(false)
  expect(hasMark(jizhuang.run.b.activePet, 'mark_xinzhiyinji')).toBe(false)

  const lianjie = await comboBattle('skill_hongxinlianjie')
  expect(hasMark(lianjie.run.a.activePet, 'mark_hongxinlianjie')).toBe(true)
  expect(hasMark(lianjie.run.a.activePet, 'mark_hongxinyinji')).toBe(false)
  expect(hasMark(lianjie.run.b.activePet, 'mark_xinzhiyinji')).toBe(false)
})

it('红心连接 shares one quarter of damage with the opponent and expires after five turns', async () => {
  const combo = await comboBattle('skill_hongxinlianjie')
  const { run } = combo
  const { battle, a, b } = run
  expect(hasMark(a.activePet, 'mark_hongxinlianjie')).toBe(true)

  // The opponent attacks with a real physical skill; the owner's damage event is
  // already reduced to 3/4, and the opponent takes 1/4 (one third of the reduced
  // value) as an Effect damage event.
  const hpBefore = a.activePet.currentHp
  await runTurn(battle, () => {
    use(battle, a, 'skill_test_status')
    use(battle, b, 'skill_test_physical_120')
  })
  const incoming = combo.received.filter(entry => entry.target === a.activePet.id && entry.damageType === 'Physical')
  const shared = combo.received.filter(entry => entry.target === b.activePet.id && entry.damageType === 'Effect')
  expect(incoming.length).toBeGreaterThan(0)
  expect(shared.length).toBeGreaterThan(0)
  const taken = incoming[incoming.length - 1].damage
  const share = shared[shared.length - 1].damage
  expect(share).toBe(Math.floor(taken / 3))
  expect(a.activePet.currentHp).toBe(hpBefore - taken)

  // 5-turn duration: present after turns 2-4, gone after the fifth update.
  expect(hasMark(a.activePet, 'mark_hongxinlianjie')).toBe(true)
  for (let turn = 6; turn <= 7; turn++) {
    await runTurn(battle, () => {
      use(battle, a, 'skill_test_status')
      use(battle, b, 'skill_test_status')
    })
    expect(hasMark(a.activePet, 'mark_hongxinlianjie')).toBe(true)
  }
  await runTurn(battle, () => {
    use(battle, a, 'skill_test_status')
    use(battle, b, 'skill_test_status')
  })
  expect(hasMark(a.activePet, 'mark_hongxinlianjie')).toBe(false)
})

it('桃红印记 lasts three turns, serves as 红心印记 for the ability and combo, and is not consumed', async () => {
  const run = start(testData, [
    team('A', [kadunPet(KADUN, ['skill_taohongyinji', 'skill_hongxinqianghua', 'skill_test_status'], { maxHp: 8000 })]),
    team('B', [pet('pet_dilan', ['skill_test_status'], { maxHp: 99999 })]),
  ])
  run.a.currentRage = 100
  const ready = prompt(run.battle)
  running.push(run.battle.startBattle().catch(() => {}))
  await ready

  await runTurn(run.battle, () => {
    use(run.battle, run.a, 'skill_taohongyinji')
    use(run.battle, run.b, 'skill_test_status')
  })
  expect(hasMark(run.a.activePet, 'mark_taohongyinji')).toBe(true)

  await runTurn(run.battle, () => {
    use(run.battle, run.a, 'skill_hongxinqianghua')
    use(run.battle, run.b, 'skill_test_status')
  })
  expect(statStage(run.a.activePet, 'atk')).toBe(2)
  expect(hasMark(run.a.activePet, 'mark_taohongyinji')).toBe(true)

  await runTurn(run.battle, () => {
    use(run.battle, run.a, 'skill_test_status')
    use(run.battle, run.b, 'skill_test_status')
  })
  expect(hasMark(run.a.activePet, 'mark_taohongyinji')).toBe(false)
})

it('红心纹章 makes 红心印记 and 桃红印记 sure-hit (accuracy 0 control)', async () => {
  const zeroAccuracy: OfficialPrototypeData = {
    ...testData,
    skills: testData.skills.map(skill => {
      const record = skill as Record<string, unknown>
      return record.id === 'skill_hongxinyinji' || record.id === 'skill_taohongyinji'
        ? { ...record, accuracy: 0 }
        : skill
    }),
  }
  async function useWithEmblem(data: OfficialPrototypeData, species: string, skill: string, withEmblem: boolean) {
    const run = start(data, [
      team('A', [withEmblem ? kadunPet(species, [skill], { maxHp: 8000 }) : pet(species, [skill], { maxHp: 8000 })]),
      team('B', [pet('pet_dilan', ['skill_test_status'], { maxHp: 99999 })]),
    ])
    run.a.currentRage = 100
    const misses: unknown[] = []
    run.battle.registerListener(message => {
      if (message.type === BattleMessageType.SkillMiss) misses.push(message)
    })
    const ready = prompt(run.battle)
    running.push(run.battle.startBattle().catch(() => {}))
    await ready
    await runTurn(run.battle, () => {
      use(run.battle, run.a, skill)
      use(run.battle, run.b, 'skill_test_status')
    })
    return skill === 'skill_hongxinyinji'
      ? hasMark(run.a.activePet, 'mark_hongxinyinji')
      : hasMark(run.a.activePet, 'mark_taohongyinji')
  }

  expect(await useWithEmblem(zeroAccuracy, KADUN, 'skill_hongxinyinji', false)).toBe(false)
  expect(await useWithEmblem(zeroAccuracy, KADUN, 'skill_hongxinyinji', true)).toBe(true)
  expect(await useWithEmblem(zeroAccuracy, KADUN, 'skill_taohongyinji', false)).toBe(false)
  expect(await useWithEmblem(zeroAccuracy, KADUN, 'skill_taohongyinji', true)).toBe(true)
})

it('退化射线 clears opponent positive stat stages and 红心回复 heals 120 then 60 on consecutive use', async () => {
  const { battle, a, b } = start(testData, [
    team('A', [kadunPet(KADUN, ['skill_tuihuashexian', 'skill_hongxinhuifu', 'skill_test_status'], { maxHp: 500 })]),
    team('B', [pet('pet_dilan', ['skill_jianqiang', 'skill_test_status'], { maxHp: 99999 })]),
  ])
  a.currentRage = 100
  b.currentRage = 100
  const ready = prompt(battle)
  running.push(battle.startBattle().catch(() => {}))
  await ready

  await runTurn(battle, () => {
    use(battle, a, 'skill_test_status')
    use(battle, b, 'skill_jianqiang')
  })
  expect(statStage(b.activePet, 'def')).toBe(1)

  await runTurn(battle, () => {
    a.currentRage = 100
    use(battle, a, 'skill_tuihuashexian')
    use(battle, b, 'skill_test_status')
  })
  expect(statStage(b.activePet, 'def')).toBe(0)

  a.activePet.currentHp = 100
  await runTurn(battle, () => {
    a.currentRage = 100
    use(battle, a, 'skill_hongxinhuifu')
    use(battle, b, 'skill_test_status')
  })
  expect(a.activePet.currentHp).toBe(220)

  await runTurn(battle, () => {
    a.currentRage = 100
    use(battle, a, 'skill_hongxinhuifu')
    use(battle, b, 'skill_test_status')
  })
  expect(a.activePet.currentHp).toBe(280)

  await runTurn(battle, () => {
    use(battle, a, 'skill_test_status')
    use(battle, b, 'skill_test_status')
  })
  await runTurn(battle, () => {
    a.currentRage = 100
    use(battle, a, 'skill_hongxinhuifu')
    use(battle, b, 'skill_test_status')
  })
  expect(a.activePet.currentHp).toBe(400)
})

it('群心满天 is a 160-power Climax move and 红心射线 deals damage', async () => {
  const { battle, a, b } = start(testData, [
    team('A', [kadunPet(KADUN, ['skill_qunxinmantian', 'skill_hongxinshexian'], { maxHp: 8000 })]),
    team('B', [pet('pet_dilan', ['skill_test_status'], { maxHp: 99999 })]),
  ])
  a.currentRage = 100
  const received = collectDamage(battle)
  const ready = prompt(battle)
  running.push(battle.startBattle().catch(() => {}))
  await ready

  await runTurn(battle, () => {
    a.currentRage = 100
    use(battle, a, 'skill_qunxinmantian')
    use(battle, b, 'skill_test_status')
  })
  const climax = received.filter(entry => entry.target === b.activePet.id)
  expect(climax[climax.length - 1]?.damage ?? 0).toBeGreaterThan(0)

  await runTurn(battle, () => {
    a.currentRage = 100
    use(battle, a, 'skill_hongxinshexian')
    use(battle, b, 'skill_test_status')
  })
  const ray = received.filter(entry => entry.target === b.activePet.id)
  expect(ray[ray.length - 1]?.damage ?? 0).toBeGreaterThan(0)
})

it('clears 红心印记 on switch and restores battle-start marks without duplication through a snapshot', async () => {
  const { battle, a, b, directory } = start(testData, [
    team('A', [
      kadunPet(KADUN, ['skill_hongxinyinji', 'skill_taohongyinji'], { maxHp: 8000 }),
      kadunPet(KADUN, ['skill_test_status']),
    ]),
    team('B', [pet('pet_dilan', ['skill_test_status'], { maxHp: 99999 })]),
  ])
  a.currentRage = 100
  const ready = prompt(battle)
  running.push(battle.startBattle().catch(() => {}))
  await ready

  await runTurn(battle, () => {
    use(battle, a, 'skill_hongxinyinji')
    use(battle, b, 'skill_test_status')
  })
  expect(hasMark(a.activePet, 'mark_hongxinyinji')).toBe(true)
  const saved = JSON.parse(JSON.stringify(directory.snapshot(battle)))
  const hp = a.activePet.currentHp
  battles.splice(battles.indexOf(battle), 1)
  await battle.cleanup()
  const restored = directory.restore(saved)
  battles.push(restored)
  const restoredPet = restored.playerA.activePet
  expect(restoredPet.marks.filter(mark => mark.baseId === 'mark_ability_yinji')).toHaveLength(1)
  expect(restoredPet.marks.filter(mark => mark.baseId === 'mark_emblem_hongxin')).toHaveLength(1)
  expect(markStack(restoredPet, 'mark_hongxinyinji')).toBe(1)
  expect(restoredPet.currentHp).toBe(hp)
})

it('红心连接 share reduces a would-be lethal hit to 3/4 and the owner survives', async () => {
  async function takeHit(withMark: boolean, hp: number) {
    const combo = await comboBattle('skill_hongxinlianjie')
    const { battle, a } = combo.run
    if (!withMark) stripMark(a.activePet, 'mark_hongxinlianjie')
    a.activePet.currentHp = hp
    const beforeCount = combo.received.length
    await runTurn(battle, () => {
      use(battle, a, 'skill_test_status')
      use(battle, combo.run.b, 'skill_test_physical_120')
    })
    const damage = combo.received.slice(beforeCount).filter(entry => entry.target === a.activePet.id)[0]?.damage ?? -1
    return { combo, damage }
  }

  const control = await takeHit(false, 99999)
  const lethal = await takeHit(true, control.damage)
  expect(control.damage).toBeGreaterThan(0)
  expect(lethal.damage).toBeGreaterThan(0)
  expect(Math.abs(lethal.damage - Math.floor(control.damage * 0.75))).toBeLessThanOrEqual(1)
  expect(lethal.combo.run.a.activePet.isAlive).toBe(true)
  expect(lethal.combo.run.a.activePet.currentHp).toBe(control.damage - lethal.damage)
  expect(lethal.combo.run.a.activePet.currentHp).toBeGreaterThan(0)
})

it('clears 红心印记 on switch while the battle-start ability/emblem marks follow the pet', async () => {
  const { battle, a, b } = start(testData, [
    team('A', [kadunPet(KADUN, ['skill_hongxinyinji']), kadunPet(KADUN, ['skill_test_status'])]),
    team('B', [pet('pet_dilan', ['skill_test_status'], { maxHp: 99999 })]),
  ])
  a.currentRage = 100
  const ready = prompt(battle)
  running.push(battle.startBattle().catch(() => {}))
  await ready

  await runTurn(battle, () => {
    use(battle, a, 'skill_hongxinyinji')
    use(battle, b, 'skill_test_status')
  })
  expect(hasMark(a.activePet, 'mark_hongxinyinji')).toBe(true)

  await runTurn(battle, () => {
    switchTo(battle, a, a.team[1].id)
    use(battle, b, 'skill_test_status')
  })
  expect(hasMark(a.team[0], 'mark_hongxinyinji')).toBe(false)
  expect(hasMark(a.activePet, 'mark_ability_yinji')).toBe(true)
  expect(hasMark(a.activePet, 'mark_emblem_hongxin')).toBe(true)
})

it.each([0.09, 0.11])('restoration secondary effects respect the 10 percent chance (roll %s)', async roll => {
  for (const skill of ['skill_hongxinshexian', 'skill_qunxinmantian', 'skill_quanliyiji_kadundudu']) {
    const { battle, a, b } = start(testData, [
      team('A', [kadunPet(KADUN, [skill], { maxHp: 8000 })]),
      team('B', [pet('pet_dilan', ['skill_test_status'], { maxHp: 99999 })]),
    ])
    const ready = prompt(battle)
    running.push(battle.startBattle().catch(() => {}))
    await ready
    battle.random = () => roll
    await runTurn(battle, () => {
      a.currentRage = 100
      use(battle, a, skill)
      use(battle, b, 'skill_test_status')
    })
    const target = skill === 'skill_hongxinshexian' ? b.activePet : a.activePet
    const markId = skill === 'skill_hongxinshexian' ? 'stat_stage_spe_down' : 'stat_stage_atk_up'
    expect(hasMark(target, markId)).toBe(roll < 0.1)
  }
})
