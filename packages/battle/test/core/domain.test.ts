import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createBattle,
  EffectRegistry,
  EffectTrigger,
  StackStrategy,
  Nature,
  type BattleContent,
  type TrustedEffect,
} from '@arcadia-eternity/battle/core'
import { officialContent, basicOptions, skillAction, registry } from './official.js'

let original: BattleContent
beforeAll(async () => {
  original = await officialContent()
})
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
function setup(effects: TrustedEffect[] = []) {
  const content = clone(original)
  content.skills.forEach(s => {
    s.effects = []
    s.sureHit = true
  })
  content.marks.forEach(m => {
    m.effects = []
  })
  if (effects.length) content.skills[0].effects = effects.map(e => ({ id: e.id, version: e.version, params: {} }))
  const battle = createBattle(basicOptions(), content, new EffectRegistry(effects))
  return { battle, content }
}
function turn(battle: ReturnType<typeof createBattle>) {
  expect(battle.submitAction(skillAction(battle, 'A')).accepted).toBe(true)
  expect(battle.submitAction(skillAction(battle, 'B')).accepted).toBe(true)
}
describe('domain ownership and lifecycle', () => {
  it('keeps species, build, calculated stats, skill instances and owner references', () => {
    const options = basicOptions()
    options.players[0].team[0].nature = Nature.Adamant
    const b = createBattle(options, original, registry),
      pet = b.playerA.activePet
    expect(pet.owner).toBe(b.playerA)
    expect(b.playerA.battle).toBe(b)
    expect(pet.originalSpecies.id).toBe('pet_huanli')
    expect(pet.level).toBe(50)
    expect(pet.ivs.atk).toBe(31)
    expect(pet.evs.atk).toBe(0)
    expect(pet.calculateStats().atk).toBeCloseTo(Math.floor((2 * pet.originalSpecies.baseStats.atk + 31) / 2 + 5) * 1.1)
    expect(pet.skills[0].owner).toBe(pet)
    expect(pet.skills[0].base.id).toBe('skill_paida')
    options.players[0].team[0].maxHp = 1
    expect(pet.currentHp).toBe(100)
    expect(b.getAvailableActions('A')).toEqual([])
    b.start()
    turn(b)
    expect(pet.lastSkill).toBe(pet.skills[0])
    expect(pet.lastSkillUsedTimes).toBe(1)
    expect(pet.skills[0].appeared).toBe(true)
    turn(b)
    expect(pet.lastSkillUsedTimes).toBe(2)
  })
  it('validates actions against the active seat and rejects duplicates without changing state', () => {
    const { battle: b } = setup()
    b.start()
    const before = b.snapshot()
    expect(b.submitAction({ ...skillAction(b, 'B'), player: 'A' }).accepted).toBe(false)
    expect(b.snapshot()).toEqual(before)
    expect(b.submitAction(skillAction(b, 'A'), false).accepted).toBe(true)
    const partial = b.snapshot()
    expect(b.submitAction(skillAction(b, 'A')).accepted).toBe(false)
    expect(b.snapshot()).toEqual(partial)
  })
  it('uses V1 switch rage rounding and refreshes the attack target after the switch', () => {
    const { battle: b } = setup()
    b.start()
    b.playerA.currentRage = 21
    const leadHp = b.playerA.activePet.currentHp
    expect(b.submitAction({ type: 'switch-pet', player: 'A', pet: 'A/reserve' }).accepted).toBe(true)
    expect(b.submitAction(skillAction(b, 'B')).accepted).toBe(true)
    const switched = b.getEvents().find(e => e.type === 'rageChange' && e.data.reason === 'switch')!
    expect(switched.data.newRage).toBe(16)
    expect(b.playerA.team[0].currentHp).toBe(leadHp)
    expect(b.playerA.activePet.currentHp).toBeLessThan(100)
  })
  it('grants turn rage to a fainted player before replacement and supports reward decline', () => {
    const content = clone(original)
    content.skills.forEach(s => {
      s.effects = []
      s.sureHit = true
      s.power = 5000
    })
    content.marks.forEach(m => {
      m.effects = []
    })
    const options = basicOptions()
    const b = createBattle(options, content)
    b.start()
    turn(b)
    expect(b.phase.kind).toBe('switch')
    expect(b.phase.forced).toEqual(['B'])
    expect(b.phase.reward).toBe('A')
    expect(
      b.getEvents().some(e => e.type === 'rageChange' && e.data.playerId === 'B' && e.data.reason === 'turn'),
    ).toBe(true)
    expect(b.getAvailableActions('B').every(a => a.type === 'switch-pet')).toBe(true)
    expect(b.submitAction({ type: 'do-nothing', player: 'B' }).accepted).toBe(false)
    b.submitAction({ type: 'do-nothing', player: 'A' })
    b.submitAction({ type: 'switch-pet', player: 'B', pet: 'B/reserve' })
    expect(b.phase.kind).toBe('selection')
    turn(b)
    expect(b.status).toBe('ended')
    expect(b.victor).toBe('A')
  })
  it('honors skill priority, multi-hit, sure-hit and sure-crit', () => {
    const content = clone(original)
    content.skills.forEach(s => {
      s.effects = []
      s.sureHit = true
      s.sureCrit = true
      s.power = 1
      s.multihit = [2, 2]
    })
    content.marks.forEach(m => {
      m.effects = []
    })
    const options = basicOptions()
    options.players[1].team[0].skills = ['skill_shuipao']
    content.skills.find(s => s.id === 'skill_shuipao')!.priority = 10
    const b = createBattle(options, content)
    b.start()
    turn(b)
    expect(b.getEvents().filter(e => e.type === 'skillUse')[0].data.petId).toBe('B/lead')
    const damage = b.getEvents().filter(e => e.type === 'damage')
    expect(damage).toHaveLength(4)
    expect(damage.every(e => e.data.isCrit)).toBe(true)
    expect(b.getEvents().filter(e => e.type === 'rageChange' && e.data.reason === 'skillHit')).toHaveLength(2)
  })
  it('supports surrender and permits no more actions after settlement', () => {
    const { battle: b } = setup()
    b.start()
    b.submitAction({ type: 'surrender', player: 'A' })
    expect(b.victor).toBe('B')
    expect(b.endReason).toBe('surrender')
    expect(b.getAvailableActions('B')).toEqual([])
    expect(b.advance()).toBe(false)
  })
})

describe('trusted seam and mark lifecycle', () => {
  function withMarks(definitions: Partial<BattleContent['marks'][number]>[] = [], callback?: TrustedEffect['execute']) {
    const { content } = setup()
    const config = {
      duration: 2,
      persistent: false,
      maxStacks: 10,
      stackable: true,
      stackStrategy: StackStrategy.stack,
      destroyable: true,
      isShield: false,
      keepOnSwitchOut: true,
      transferOnSwitch: false,
      inheritOnFaint: false,
    }
    content.marks = definitions.map((m, i) => ({
      id: `m${i}`,
      tags: [],
      effects: [],
      ...m,
      config: { ...config, ...m.config },
    }))
    const effect: TrustedEffect = {
      id: 'test',
      version: '1',
      triggers: [EffectTrigger.OnBattleStart],
      execute:
        callback ??
        (ctx => {
          ctx.battle.addMark(ctx.battle.playerA.activePet, 'm0')
        }),
    }
    // Mark effects participate at start; use a build ability to install the hook.
    content.marks.push({
      id: 'ability',
      tags: [],
      config: { ...config, persistent: true, duration: -1 },
      effects: [{ id: 'test', version: '1', params: {} }],
    })
    const options = basicOptions()
    options.players[0].team[0].ability = 'ability'
    return { content, options, effects: new EffectRegistry([effect]) }
  }
  it('rebinds ability and emblem by IDs and expires a finite mark at its duration', () => {
    const { content, options, effects } = withMarks([{}])
    options.players[0].team[0].emblem = 'm0'
    const b = createBattle(options, content, effects)
    b.start()
    expect(b.playerA.activePet.marks.map(m => m.base.id)).toEqual(['ability', 'm0'])
    expect(b.playerA.activePet.marks[1].stack).toBe(2)
    turn(b)
    expect(b.playerA.activePet.marks[1].duration).toBe(1)
    turn(b)
    expect(b.playerA.activePet.marks.map(m => m.base.id)).toEqual(['ability'])
  })
  it('preserves persistent duration and pauses benched mark duration like V1 turn.ts', () => {
    const { content, options, effects } = withMarks([{}])
    const b = createBattle(options, content, effects)
    b.start()
    b.submitAction({ type: 'switch-pet', player: 'A', pet: 'A/reserve' })
    b.submitAction(skillAction(b, 'B'))
    expect(b.playerA.team[0].marks.find(m => m.base.id === 'm0')!.duration).toBe(2)
    expect(b.playerA.team[0].marks.find(m => m.base.id === 'ability')!.duration).toBe(-1)
  })
  it('transfers marks to the replacement and removes marks that do not survive switching', () => {
    const { content, options, effects } = withMarks([{}, {}], ctx => {
      ctx.battle.addMark(ctx.battle.playerA.activePet, 'm0')
      ctx.battle.addMark(ctx.battle.playerA.activePet, 'm1')
    })
    content.marks[0].config.transferOnSwitch = true
    content.marks[1].config.keepOnSwitchOut = false
    const b = createBattle(options, content, effects)
    b.start()
    const id = b.playerA.activePet.marks.find(m => m.base.id === 'm0')!.id
    b.submitAction({ type: 'switch-pet', player: 'A', pet: 'A/reserve' })
    b.submitAction(skillAction(b, 'B'))
    expect(b.playerA.activePet.marks.find(m => m.id === id)!.owner).toBe(b.playerA.activePet)
    expect(b.playerA.team[0].marks.some(m => m.base.id === 'm1')).toBe(false)
  })
  it('consumes shields through the common stack path and runs destroy hooks once', () => {
    let destroys = 0
    const { content, options, effects: _effects } = withMarks([{}])
    content.marks[0].config.isShield = true
    content.marks[0].effects = [{ id: 'destroy', version: '1', params: {} }]
    content.marks.find(m => m.id === 'ability')!.effects = [{ id: 'add', version: '1', params: {} }]
    const effects = new EffectRegistry([
      {
        id: 'add',
        version: '1',
        triggers: [EffectTrigger.OnBattleStart],
        execute(ctx) {
          ctx.battle.addMark(ctx.battle.playerA.activePet, 'm0', 10)
        },
      },
      {
        id: 'destroy',
        version: '1',
        triggers: [EffectTrigger.OnMarkDestroy],
        execute() {
          destroys++
        },
      },
    ])
    const b = createBattle(options, content, effects)
    b.start()
    turn(b)
    expect(destroys).toBe(1)
    expect(b.playerA.activePet.marks.some(m => m.base.id === 'm0')).toBe(false)
    expect(b.getEvents().filter(e => e.type === 'damage' && e.data.targetId === 'A/lead')[0].data.damage).toBeLessThan(
      20,
    )
  })
  it('removing a stage mark removes the stat bonus without stale modifiers', () => {
    const { content, options, effects } = withMarks([], ctx => {
      const pet = ctx.battle.playerA.activePet,
        base = pet.stat.atk
      ctx.battle.addStatStage(pet, 'atk', 2)
      expect(pet.stat.atk).toBe(base * 2)
      ctx.battle.consumeMarkStacks(pet.marks.find(m => m.base.id === 'stat_stage_atk_up')!, 2)
      expect(pet.stat.atk).toBe(base)
    })
    const b = createBattle(options, content, effects)
    b.start()
    expect(b.playerA.activePet.stages.atk).toBe(0)
  })
  it('isolates event subscribers, prevents reentry and leaves a stable save boundary', () => {
    const { battle: b } = setup()
    const events: string[] = []
    b.events(() => {
      b.start()
    })
    b.events(e => {
      events.push(e.type)
      e.type = 'mutated'
      expect(b.snapshot().state.status).toBe('active')
    })
    const stop = b.events(() => {
      throw new Error('view failed')
    })
    b.start()
    expect(events).toContain('battleStart')
    expect(b.getEvents()[0].type).toBe('battleStart')
    expect(b.takeObserverErrors().length).toBeGreaterThan(0)
    stop()
    expect(b.takeObserverErrors()).toEqual([])
  })
  it('rolls back data, pending actions, journal and RNG when trusted code throws', () => {
    let fail = true
    const effect: TrustedEffect = {
      id: 'throw',
      version: '1',
      triggers: [EffectTrigger.BeforeHit],
      execute(ctx) {
        ctx.battle.random()
        ctx.battle.addStatStage(ctx.battle.playerA.activePet, 'atk', 1)
        if (fail) throw new Error('test failure')
      },
    }
    const { battle: b } = setup([effect])
    b.start()
    b.submitAction(skillAction(b, 'A'))
    const before = b.snapshot()
    expect(() => b.submitAction(skillAction(b, 'B'))).toThrow('test failure')
    expect(b.snapshot()).toEqual(before)
    fail = false
    expect(b.submitAction(skillAction(b, 'B')).accepted).toBe(true)
  })
  it('does not consult ambient random or wall-clock time', () => {
    const { battle: b } = setup()
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('ambient RNG')
    })
    const now = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('wall time')
    })
    try {
      b.start()
      turn(b)
      expect(b.turn).toBe(1)
    } finally {
      random.mockRestore()
      now.mockRestore()
    }
  })
})
