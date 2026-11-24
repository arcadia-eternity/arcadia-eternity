import { applyEffect } from '../../src/engine/phase/effectExecution'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import * as sdk from '../../authoring'
import { ArenaEffectModule, sandboxPolicy, type SandboxPolicy, type EffectModuleArtifact } from '../../sandbox'
import { browserSandboxPolicy } from '../../src/sandbox/contracts'
import {
  codeEffectDefinition,
  BaseMark,
  compileBehaviorUse,
  EffectContext,
  EffectTrigger,
  TurnContext,
  setGlobalLogger,
} from '../../engine'
import { makeScenario } from './scenario'

const modules: ArenaEffectModule[] = [],
  battles: ReturnType<typeof makeScenario>['battle'][] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
  for (const module of modules.splice(0)) module.dispose()
})
const artifact = (source: string): EffectModuleArtifact => ({
  format: 'arcadia.effect-module',
  version: 1,
  sdkApi: 4,
  packageId: 'test',
  source,
})
async function prepare(source: string, policy: SandboxPolicy = sandboxPolicy) {
  const module = await ArenaEffectModule.prepare(artifact(source), policy)
  modules.push(module)
  return module
}
function compile(module: ArenaEffectModule, marks: BaseMark[] = []) {
  const f = makeScenario()
  battles.push(f.battle)
  const exports = module.createEffects({
    sdk,
    marks: new Map(marks.map(mark => [mark.id, mark])),
    id: id => `test:${id}`,
  })
  const result = compileBehaviorUse(
    codeEffectDefinition(exports[0]),
    { useId: 'one', definitionId: exports[0].id },
    {
      owner: { kind: 'skill', id: f.a.activePet.skills[0].baseId },
      nativeExports: exports,
    },
  )
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics))
  result.parameters.install(f.battle.configSystem)
  const ctx = new EffectContext(
    new TurnContext(f.battle),
    EffectTrigger.TurnEnd,
    f.a.activePet.skills[0],
    result.effect,
  )
  return { ...f, effect: result.effect, ctx }
}
it('uses the injected SDK with canonical parameters and synchronous custom computations', async () => {
  const module = await prepare(`
    if ([typeof process,typeof fetch,typeof document,typeof Worker].some(x=>x!=='undefined')) throw Error('capability leak');
    if(Date.now()!==0 || new Date().getTime()!==0 || new Date().constructor.now()!==0)throw Error('ambient clock');
    export function createEffects({sdk,id}) {
      return [sdk.defineCodeEffect({ id:id('heal'),sourceKind:'skill',build:({effectId})=>{
        const amount=sdk.numberParam({default:12});
        return sdk.defineEffect({id:effectId,triggers:[sdk.EffectTrigger.TurnEnd],parameters:{amount},
          apply:sdk.targets.ownerPet.apply(sdk.ops.heal(amount.map(x=>x+1)))});
      }})];
    }
  `)
  const f = compile(module)
  f.a.activePet.currentHp = 40
  applyEffect(f.effect, f.ctx)
  expect(f.a.activePet.currentHp).toBe(53)
  expect(module.state).toBe('ready')
})
it('passes only the current selection member to sandbox predicates and projections', async () => {
  const module = await prepare(`export function createEffects({sdk,id}) {
    const selected = sdk.selectFrom([1, 2, 3, 4])
      .where(function (value) { return arguments.length === 1 && value % 2 === 0; })
      .select(function (value) { return arguments.length === 1 ? value + 1 : -1; })
      .all();
    return [sdk.defineCodeEffect({id:id('select'),sourceKind:'skill',build:({effectId}) =>
      sdk.defineEffect({id:effectId,triggers:[sdk.EffectTrigger.TurnEnd],
        when:frame => frame.read(selected).join(',') === '3,5',
        apply() {}
      })
    })];
  }`)
  const f = compile(module)
  expect(f.battle.executionBudget.run(f.battle.currentTurn, () => f.effect.condition!(f.ctx))).toBe(true)
})
it.each([
  { host: 'browser', policy: browserSandboxPolicy, delay: 2_500, succeeds: true },
  { host: 'browser', policy: browserSandboxPolicy, delay: 4_001, succeeds: false },
  { host: 'server', policy: sandboxPolicy, delay: 750, succeeds: true },
  { host: 'server', policy: sandboxPolicy, delay: 2_001, succeeds: false },
])('enforces the $host effect deadline after a $delay ms scheduling delay', async ({ policy, delay, succeeds }) => {
  const module = await prepare(
    `export function createEffects({sdk,id}) {
    return [sdk.defineCodeEffect({id:id('read'),sourceKind:'skill',triggers:[sdk.EffectTrigger.TurnEnd],
      when: ctx => ctx.parent.battle.currentTurn >= 0, apply() {}
    })];
  }`,
    policy,
  )
  const f = compile(module)
  const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(delay)
  try {
    const condition = () => f.effect.condition!(f.ctx)
    if (succeeds) expect(condition()).toBe(true)
    else expect(condition).toThrow(/deadline/)
    expect(module.state).toBe(succeeds ? 'ready' : 'faulted')
  } finally {
    clock.mockRestore()
  }
})
it('reads current domain state independently on each callback', async () => {
  const module = await prepare(`
    export function createEffects({sdk,id}) {
      return [sdk.defineCodeEffect({id:id('read'),sourceKind:'skill',triggers:[sdk.EffectTrigger.TurnEnd],
        apply(ctx){
          const pet=ctx.read(sdk.targets.ownerPet.first());
          if(pet!==ctx.read(sdk.targets.ownerPet.first()))throw Error('identity');
          sdk.ops.heal(pet.currentHp / 10)(ctx,[pet]);
        }
      })];
    }`)
  const f = compile(module)
  f.a.activePet.currentHp = 40
  applyEffect(f.effect, f.ctx)
  expect(f.a.activePet.currentHp).toBe(44)
  f.a.activePet.currentHp = 30
  const next = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnEnd, f.a.activePet.skills[0], f.effect)
  applyEffect(f.effect, next)
  expect(f.a.activePet.currentHp).toBe(33)
  expect(module.state).toBe('ready')
})
it('uses native SDK healing and the battle RNG through scoped domain capabilities', async () => {
  const module = await prepare(`export function createEffects({sdk,id}){
    return [sdk.defineCodeEffect({id:id('native-heal'),sourceKind:'skill',triggers:[sdk.EffectTrigger.TurnEnd],
      apply(ctx){const pet=ctx.read(sdk.targets.ownerPet.first());if(pet instanceof sdk.Pet)
        sdk.ops.heal(sdk.values.randomInt(3,3))(ctx,[pet]);
      }})]
  }`)
  const f = compile(module)
  f.a.activePet.currentHp = 40
  applyEffect(f.effect, f.ctx)
  expect(f.a.activePet.currentHp).toBe(43)
})
it('resolves damage and the mark lifecycle through SDK operators', async () => {
  const base = new BaseMark('test:stack' as sdk.baseMarkId, [])
  const module = await prepare(`export function createEffects({sdk,id,marks}) {
    for (const key of ['dealDamage','heal','changeRage','addMark','removeMark','consumeMarkStacks','transferMarks','setEffectState','DamageContext','createContentCatalog']) {
      if (key in sdk) throw Error('Unexpected SDK export: '+key);
    }
    const hits = sdk.defineEffectState({id:id('hits'),type:'number',default:0});
    const base = marks.get(id('stack'));
    return [sdk.defineCodeEffect({id:id('phases'),sourceKind:'skill',triggers:[sdk.EffectTrigger.TurnEnd],
      apply(ctx) {
        const pet = ctx.read(sdk.targets.ownerPet.first());
        if (pet.setOwner || ctx.parent.battle.applyEffects || base.createInstance || globalThis.core)
          throw Error('Unexpected host access');
        ctx.ops.setEffectState(pet,hits,ctx.getEffectState(pet,hits)+1);
        sdk.ops.dealDamage(ctx.getEffectState(pet,hits)*5)(ctx,[pet]);
        sdk.ops.addMark(base)(ctx,[pet]);
        const mark = pet.marks.find(mark => mark.base === base);
        sdk.ops.transferMarks(sdk.selectFrom([mark]).all())(ctx,[pet.owner.team[1]]);
        if (mark.owner !== pet.owner.team[1]) throw Error('Transfer failed');
        sdk.ops.consumeStacks(1)(ctx,[mark]);
        if (mark.isActive) throw Error('Consumption failed');
        sdk.contexts.battle.apply(sdk.ops.addMark(base))(ctx);
        const battle = ctx.read(sdk.contexts.battle.first());
        sdk.ops.removeMark()(ctx,[battle.marks.find(mark => mark.base === base)]);
      }
    })];
  }`)
  const f = compile(module, [base])
  const pet = f.a.activePet
  const hp = pet.currentHp
  applyEffect(f.effect, f.ctx)
  expect(pet.currentHp).toBe(hp - 5)
  for (const owner of [f.battle, ...f.a.team]) expect(owner.marks.some(mark => mark.base === base)).toBe(false)
})
it('latches denied writes even if author code catches the exception', async () => {
  const module = await prepare(`export function createEffects({sdk,id}){return [sdk.defineCodeEffect({id:id('write'),
    sourceKind:'skill',triggers:[sdk.EffectTrigger.TurnEnd],apply(ctx){try{ctx.read(sdk.targets.ownerPet.first()).currentHp=0}catch{}}})]}`)
  const f = compile(module),
    hp = f.a.activePet.currentHp
  expect(() => applyEffect(f.effect, f.ctx)).toThrow()
  expect(f.a.activePet.currentHp).toBe(hp)
  expect(module.state).toBe('faulted')
})
it('interrupts top-level loops and detached promise jobs', async () => {
  for (const source of [
    'for(;;){}',
    'const f=()=>Promise.resolve().then(f);f(); export function createEffects(){return []}',
  ])
    await expect(ArenaEffectModule.prepare(artifact(source), { ...sandboxPolicy, prepareMs: 30 })).rejects.toThrow()
})
it('lets a host extend the catalog deadline separately from ordinary module preparation', async () => {
  const module = await prepare(`
    export function createCatalog() { return { effects: new Map(), parameters: new Map() }; }
    export function createEffects() { return []; }
  `)
  const clock = vi.spyOn(performance, 'now')
  try {
    clock.mockReturnValueOnce(0).mockReturnValue(30_000)
    expect(module.createCatalog(new Map(), undefined, 40_000).effects.size).toBe(0)
    expect(() => module.createCatalog(new Map(), undefined, 40_001)).toThrow(/Invalid catalog time limit/)

    clock.mockReturnValueOnce(0).mockReturnValue(12_000)
    expect(module.createEffects({ sdk, marks: new Map(), id: id => id })).toEqual([])
    clock.mockReturnValueOnce(0).mockReturnValue(15_001)
    expect(() => module.createEffects({ sdk, marks: new Map(), id: id => id })).toThrow(/budget exceeded/)
  } finally {
    clock.mockRestore()
  }
})
it('rejects deliberately retained callback contexts after their scope expires', async () => {
  const module = await prepare(`let saved;
    export function createEffects({sdk,id}){return [sdk.defineCodeEffect({id:id('expired'),
      sourceKind:'skill',triggers:[sdk.EffectTrigger.TurnEnd],apply(ctx){
        if(saved) { try { saved.parent } catch {} } else saved=ctx;
      }})]}`)
  const f = compile(module)
  applyEffect(f.effect, f.ctx)
  // Each trigger supplies a new invocation context. Retaining a previous one must fail closed.
  const next = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnEnd, f.a.activePet.skills[0], f.effect)
  expect(() => applyEffect(f.effect, next)).toThrow(/Expired/)
  expect(module.state).toBe('faulted')
})

it.each(['new sdk.Pet()', 'new sdk.BaseMark()'])('rejects host-only construction: %s', async expression => {
  const module = await prepare(`export function createEffects({sdk}) { ${expression}; return [] }`)
  expect(() => module.createEffects({ sdk, marks: new Map(), id: id => id })).toThrow('Domain construction denied')
  expect(module.state).toBe('faulted')
})

it('reduces rage through the native context and dispatches loss events', async () => {
  const module = await prepare(`export function createEffects({sdk,id}) {
    return [sdk.defineCodeEffect({id:id('reduce-rage'),sourceKind:'skill',triggers:[sdk.EffectTrigger.TurnEnd],
      apply(ctx) {
        const pet = ctx.read(sdk.targets.ownerPet.first());
        if (pet instanceof sdk.Pet && pet.owner) {
          sdk.ops.reduceRage(12)(ctx,[pet.owner]);
        }
      }
    })];
  }`)
  const f = compile(module)
  f.a.currentRage = 50
  const dispatch = vi.spyOn(f.battle, 'applyEffects')
  applyEffect(f.effect, f.ctx)
  expect(f.a.currentRage).toBe(38)
  expect(dispatch.mock.calls.map(call => call[1])).toEqual([EffectTrigger.BeforeRageLoss, EffectTrigger.OnRageLoss])
  expect(module.state).toBe('ready')
})

// Included in tsconfig.test.json; never execute invalid author programs.
function injectedSdkTypeContract({ sdk: injected }: sdk.CodeEffectModuleContext, candidate: unknown) {
  // @ts-expect-error Host lifecycle functions are unavailable to effects.
  void injected.setGlobalLogger
  // @ts-expect-error Effects change rage through ops.
  void injected.changeRage
  if (candidate instanceof injected.Pet) {
    // @ts-expect-error Effects cannot change a pet's ownership.
    void candidate.damage
  }
  injected.defineCodeEffect({
    id: 'test:rage',
    sourceKind: 'skill',
    triggers: [injected.EffectTrigger.TurnEnd],
    apply: injected.targets.selfPlayer.apply(injected.ops.reduceRage(12)),
  })
}
void injectedSdkTypeContract
