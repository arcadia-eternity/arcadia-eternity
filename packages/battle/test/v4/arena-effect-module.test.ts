import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import * as sdk from '../../v4-authoring'
import { ArenaEffectModule, sandboxPolicy, type EffectModuleArtifact } from '../../v4-sandbox'
import { compileBehaviorUse, EffectContext, EffectTrigger, TurnContext, setGlobalLogger } from '../../v4'
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
  sdkApi: 2,
  packageId: 'test',
  source,
})
async function prepare(source: string) {
  const module = await ArenaEffectModule.prepare(artifact(source))
  modules.push(module)
  return module
}
function compile(module: ArenaEffectModule) {
  const f = makeScenario()
  battles.push(f.battle)
  const exports = module.createEffects({ sdk, marks: new Map(), id: id => `test:${id}` })
  const result = compileBehaviorUse(
    sdk.codeEffectDefinition(exports[0]),
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
  f.effect.innerApply(f.ctx)
  expect(f.a.activePet.currentHp).toBe(53)
  expect(module.state).toBe('ready')
})
it('reads current domain state independently on each callback', async () => {
  const module = await prepare(`
    export function createEffects({sdk,id}) {
      return [sdk.defineCodeEffect({id:id('read'),sourceKind:'skill',triggers:[sdk.EffectTrigger.TurnEnd],
        apply(ctx){
          const pet=ctx.source.owner;
          if(pet!==ctx.source.owner)throw Error('identity');
          pet.heal(new sdk.HealContext(ctx,ctx.source,pet,pet.currentHp / 10));
        }
      })];
    }`)
  const f = compile(module)
  f.a.activePet.currentHp = 40
  f.effect.innerApply(f.ctx)
  expect(f.a.activePet.currentHp).toBe(44)
  f.a.activePet.currentHp = 30
  const next = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnEnd, f.a.activePet.skills[0], f.effect)
  f.effect.innerApply(next)
  expect(f.a.activePet.currentHp).toBe(33)
  expect(module.state).toBe('ready')
})
it('uses native SDK healing and the battle RNG through scoped domain capabilities', async () => {
  const module = await prepare(`export function createEffects({sdk,id}){
    return [sdk.defineCodeEffect({id:id('native-heal'),sourceKind:'skill',triggers:[sdk.EffectTrigger.TurnEnd],
      apply(ctx){const pet=ctx.source.owner;if(pet instanceof sdk.Pet)
        pet.heal(new sdk.HealContext(ctx,ctx.source,pet,ctx.battle.randomInt(3,3)));
      }})]
  }`)
  const f = compile(module)
  f.a.activePet.currentHp = 40
  f.effect.innerApply(f.ctx)
  expect(f.a.activePet.currentHp).toBe(43)
})
it('latches denied writes even if author code catches the exception', async () => {
  const module = await prepare(`export function createEffects({sdk,id}){return [sdk.defineCodeEffect({id:id('write'),
    sourceKind:'skill',triggers:[sdk.EffectTrigger.TurnEnd],apply(ctx){try{ctx.source.owner.currentHp=0}catch{}}})]}`)
  const f = compile(module),
    hp = f.a.activePet.currentHp
  expect(() => f.effect.innerApply(f.ctx)).toThrow()
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
    clock.mockReturnValueOnce(0).mockReturnValue(11_000)
    expect(module.createCatalog(new Map(), undefined, 25_000).effects.size).toBe(0)
    expect(() => module.createCatalog(new Map(), undefined, 25_001)).toThrow(/Invalid catalog time limit/)

    clock.mockReturnValueOnce(0).mockReturnValue(11_000)
    expect(() => module.createEffects({ sdk, marks: new Map(), id: id => id })).toThrow(/budget exceeded/)
  } finally {
    clock.mockRestore()
  }
})
it('rejects deliberately retained callback contexts after their scope expires', async () => {
  const module = await prepare(`let saved;
    export function createEffects({sdk,id}){return [sdk.defineCodeEffect({id:id('expired'),
      sourceKind:'skill',triggers:[sdk.EffectTrigger.TurnEnd],apply(ctx){
        if(saved) { try { saved.source } catch {} } else saved=ctx;
      }})]}`)
  const f = compile(module)
  f.effect.innerApply(f.ctx)
  // Each trigger supplies a new invocation context. Retaining a previous one must fail closed.
  const next = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnEnd, f.a.activePet.skills[0], f.effect)
  expect(() => f.effect.innerApply(next)).toThrow(/Expired/)
  expect(module.state).toBe('faulted')
})
