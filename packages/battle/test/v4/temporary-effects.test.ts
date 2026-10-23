import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  Effect,
  BattleMessageType,
  UseSkillContext,
  AttackTargetOpinion,
  GameRng,
  EffectContext,
  EffectTrigger,
  TurnContext,
  SynchronousPhase,
  InteractivePhase,
  PhaseType,
  BaseMark,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  setGlobalLogger,
  type Battle,
  type effectId,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { Operators, EffectParser, DataRepository } from '@arcadia-eternity/battle/v4/legacy'
import { makeScenario } from './scenario'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
class TestPhase extends SynchronousPhase<TurnContext> {
  constructor(
    battle: Battle,
    id: string,
    type: PhaseType,
    private run: () => void,
  ) {
    super(battle, id)
    this.phaseType = type
  }
  protected createContext() {
    return new TurnContext(this.battle)
  }
  protected executeOperation() {
    this.run()
  }
}
class AsyncTestPhase extends InteractivePhase<TurnContext> {
  constructor(
    battle: Battle,
    id: string,
    private run: () => void,
  ) {
    super(battle, id)
    this.phaseType = PhaseType.Skill
  }
  protected createContext() {
    return new TurnContext(this.battle)
  }
  protected async executeOperation() {
    await Promise.resolve()
    this.run()
  }
}
function fixture() {
  const f = makeScenario(241)
  battles.push(f.battle)
  for (const pet of [...f.a.team, ...f.b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const mark = new BaseMark('fixture/temporary-mark' as baseMarkId, [], f.debuff.config).createInstance()
  mark.owner = f.a.activePet
  f.a.activePet.marks.push(mark)
  const global = new BaseMark('fixture/temporary-global' as baseMarkId, [], f.debuff.config).createInstance()
  global.owner = f.battle
  f.battle.marks.push(global)
  const targets = [f.a.activePet.skills[0], mark, global]
  const ctx = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnEnd, targets[0])
  const calls: string[] = []
  const effect = new Effect<EffectTrigger>(
    'fixture/temporary' as effectId,
    [EffectTrigger.TurnEnd],
    ctx => calls.push(ctx.source.id),
    0,
  )
  return { ...f, targets, ctx, effect, calls }
}
it('without a managed phase does not evaluate the value source or add effects', () => {
  const f = fixture()
  Operators.addTemporaryEffect(() => {
    throw new Error('must not evaluate')
  })(f.ctx, f.targets)
  for (const target of f.targets) expect(target.getEffects(EffectTrigger.TurnEnd)).toEqual([])
})
for (const async of [false, true])
  for (const fail of [false, true])
    it(`cleans all owners on completion async=${async} fail=${fail}`, async () => {
      const f = fixture()
      const run = () => {
        Operators.addTemporaryEffect(() => [f.effect])(f.ctx, f.targets)
        for (const target of f.targets) {
          expect(target.effects).toEqual([])
          expect(target.getEffects(EffectTrigger.TurnEnd)).toEqual([f.effect])
        }
        f.battle.applyEffects(f.ctx.parent, EffectTrigger.TurnEnd)
        expect(f.calls.sort()).toEqual(f.targets.map(t => t.id).sort())
        if (fail) throw new Error('fixture failure')
      }
      const phase = async
        ? new AsyncTestPhase(f.battle, 'temporary-phase', run)
        : new TestPhase(f.battle, 'temporary-phase', PhaseType.Skill, run)
      f.battle.phaseManager.registerPhase(phase)
      const result = async
        ? await f.battle.phaseManager.executePhaseAsync(phase.id, { skipOnError: true })
        : f.battle.phaseManager.executePhase(phase.id, { skipOnError: true })
      expect(result.success).toBe(!fail)
      if (fail) expect(result.error?.message).toBe('fixture failure')
      for (const target of f.targets) expect(target.getEffects(EffectTrigger.TurnEnd)).toEqual([])
    })
for (const outerType of [PhaseType.Skill, PhaseType.Turn, PhaseType.Damage])
  it(`scope selection under ${outerType}`, () => {
    const f = fixture()
    const outer = new TestPhase(f.battle, 'outer', outerType, () => {
      const inner = new TestPhase(f.battle, 'inner', PhaseType.Effect, () =>
        Operators.addTemporaryEffect(() => [f.effect])(f.ctx, f.targets),
      )
      f.battle.phaseManager.registerPhase(inner)
      f.battle.phaseManager.executePhase(inner.id)
      for (const target of f.targets)
        expect(target.getEffects(EffectTrigger.TurnEnd)).toHaveLength(outerType === PhaseType.Damage ? 0 : 1)
    })
    f.battle.phaseManager.registerPhase(outer)
    f.battle.phaseManager.executePhase(outer.id)
    for (const target of f.targets) expect(target.getEffects(EffectTrigger.TurnEnd)).toEqual([])
  })
it('clearing one phase preserves permanent effects and other phase additions', () => {
  const f = fixture(),
    target = f.targets[0]
  target.effects.push(f.effect)
  target.addTemporaryEffect(f.effect, 'one')
  target.addTemporaryEffect(f.effect, 'two')
  expect(target.getEffects(EffectTrigger.TurnEnd)).toHaveLength(3)
  target.clearTemporaryEffects('one')
  expect(target.getEffects(EffectTrigger.TurnEnd)).toHaveLength(2)
  target.clearTemporaryEffects('two')
  expect(target.getEffects(EffectTrigger.TurnEnd)).toEqual([f.effect])
})
it('rejects active phase lifetimes at checkpoints and round trips after cleanup', async () => {
  const f = fixture()
  let ready!: () => void
  const prompt = new Promise<void>(resolve => {
    ready = resolve
  })
  f.battle.registerListener(message => {
    if (message.type === BattleMessageType.TurnAction) ready()
  })
  const run = f.battle.startBattle().catch(() => {})
  await prompt
  const catalog = new SnapshotCatalog('temporary/1')
  catalog.registerEffect(f.effect.id, f.effect)
  const baseEffects = [...f.a.team, ...f.b.team].flatMap(p => p.skills.flatMap(s => s.base.effects))
  for (const effect of baseEffects) catalog.registerEffect(effect.id, effect)
  for (const target of f.targets) target.addTemporaryEffect(f.effect, 'active-phase')
  expect(() => snapshotBattle(f.battle, catalog)).toThrow('active temporary effects')
  f.battle.cleanupPhaseEffects('active-phase')
  const data = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalog)))
  await f.battle.cleanup()
  await run
  const fresh = new SnapshotCatalog('temporary/1')
  for (const effect of baseEffects) fresh.registerEffect(effect.id, effect)
  for (const node of data.nodes) if (node.fields) delete node.fields.temporaryEffects
  const restored = restoreBattle(data, fresh)
  battles.push(restored)
  const targets = [restored.playerA.activePet.skills[0], restored.playerA.activePet.marks[0], restored.marks[0]]
  for (const target of targets) expect(target.getEffects(EffectTrigger.TurnEnd)).toEqual([])
})
it('accepts an effect entity reference as the temporary effect value', () => {
  expect(
    EffectParser.parse({
      id: 'fixture/temporary-parser',
      trigger: 'BeforeHit',
      priority: 0,
      apply: {
        type: 'addTemporaryEffect',
        target: 'skill',
        effect: { type: 'entity:effect', value: 'effect_fixture' },
      },
    }).id,
  ).toBe('fixture/temporary-parser')
})

for (const seed of [1, 2, 3, 4])
  it(`original xifa selects one effect and expires with its turn seed=${seed}`, () => {
    const f = fixture()
    const original = parse(
      readFileSync(new URL('./fixtures/effect-regression/effect_skill.yaml', import.meta.url), 'utf8'),
      { merge: true },
    ).find((d: { id: string }) => d.id === 'effect_skill_random_xifa_effect')
    const ids: string[] = original.apply.effect.value.map((v: { value: string }) => v.value)
    const repo = DataRepository.getInstance(),
      previous = ids.map(id => repo.effects.get(id)),
      calls: string[] = []
    const deps = ids.map(
      id => new Effect<EffectTrigger>(id as effectId, [EffectTrigger.BeforeHit], () => calls.push(id), 0),
    )
    deps.forEach(effect => repo.effects.set(effect.id, effect))
    const source = f.a.activePet.skills[0]
    source.effects.push(EffectParser.parse(original))
    const rng = new GameRng(seed)
    const shuffle = f.battle.shuffle.bind(f.battle)
    // The fixture battle uses seed 241; an independent local RNG selects all test paths deterministically.
    f.battle.shuffle = items => rng.shuffle(items)
    try {
      const turn = new TestPhase(f.battle, 'xifa-turn', PhaseType.Turn, () => {
        const use = new UseSkillContext(
          new TurnContext(f.battle),
          f.a,
          f.a.activePet,
          AttackTargetOpinion.opponent,
          source,
        )
        f.battle.applyEffects(use, EffectTrigger.BeforeSort, source)
        const selected = source.getEffects(EffectTrigger.BeforeHit)
        expect(selected).toHaveLength(1)
        expect(selected[0].id).toBe(new GameRng(seed).shuffle(ids)[0])
        f.battle.applyEffects(use, EffectTrigger.BeforeHit, source)
        expect(calls).toEqual([selected[0].id])
      })
      f.battle.phaseManager.registerPhase(turn)
      f.battle.phaseManager.executePhase(turn.id)
      expect(source.getEffects(EffectTrigger.BeforeHit)).toEqual([])
      expect(source.effects).toHaveLength(1)
    } finally {
      f.battle.shuffle = shuffle
      ids.forEach((id, i) => {
        const effect = previous[i]
        if (effect) repo.effects.set(id, effect)
        else repo.effects.delete(id)
      })
    }
  })

it('a nested skill expires independently while the turn addition survives', () => {
  const f = fixture(),
    target = f.targets[0]
  const turn = new TestPhase(f.battle, 'turn-scope', PhaseType.Turn, () => {
    Operators.addTemporaryEffect(() => [f.effect])(f.ctx, [target])
    const skill = new TestPhase(f.battle, 'skill-scope', PhaseType.Skill, () => {
      Operators.addTemporaryEffect(() => [f.effect])(f.ctx, [target])
      expect(target.getEffects(EffectTrigger.TurnEnd)).toHaveLength(2)
    })
    f.battle.phaseManager.registerPhase(skill)
    f.battle.phaseManager.executePhase(skill.id)
    expect(target.getEffects(EffectTrigger.TurnEnd)).toHaveLength(1)
  })
  f.battle.phaseManager.registerPhase(turn)
  f.battle.phaseManager.executePhase(turn.id)
  expect(target.getEffects(EffectTrigger.TurnEnd)).toEqual([])
})
