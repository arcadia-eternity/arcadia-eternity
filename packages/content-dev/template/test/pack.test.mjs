import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  removeMark,
  transferMarks,
  AttackTargetOpinion,
  EffectContext,
  EffectTrigger,
  RemoveMarkContext,
  attack,
  cancelled,
  nextTurn,
  parameterAddress,
  prepareContentPack,
  runBattle,
  setGlobalLogger,
} from '@arcadia-eternity/content-sdk/testing'
setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })

let example
before(
  async () => {
    const fetch = globalThis.fetch
    globalThis.fetch = () => {
      throw new Error('Preparing the sample pack must not fetch remote resources')
    }
    try {
      example = await prepareContentPack()
    } finally {
      globalThis.fetch = fetch
    }
    assert.ok(example.files.includes('dist/content.json'))
    assert.ok(example.files.includes('dist/presentation.json'))
    assert.ok(example.files.includes('dist/arcadia-effects.json'))
    assert.equal(
      example.files.some(file => /^(?:data|locales|src|docs)\//.test(file)),
      false,
    )
  },
  { timeout: 60000 },
)
after(async () => {
  await example?.dispose()
})

test('the installed package includes compiled content, local artwork, remote declarations and both languages', () => {
  for (const file of [
    'dist/content.json',
    'dist/presentation.json',
    'dist/arcadia-effects.json',
    'assets/pets/frostling-icon.png',
    'assets/pets/frostling-portrait.png',
    'assets/pets/frostling-battle.png',
    'assets/marks/slow.png',
  ])
    assert.ok(example.files.includes(file), `Missing packaged file: ${file}`)
  const presentation = example.environment.presentation.find(
    item => item.namespace === example.manifest.arcadia.namespace,
  )
  assert.ok(presentation)
  const local = presentation.manifest.resources.filter(resource => resource.kind === 'file')
  assert.deepEqual(
    presentation.resources.map(resource => resource.id).sort(),
    local.map(resource => resource.id).sort(),
    'every declared local resource has a prepared file path',
  )
  for (const resource of local)
    assert.ok(example.files.includes(resource.source), `Missing packaged file: ${resource.source}`)
  const remote = presentation.manifest.resources.filter(resource => resource.kind === 'http')
  for (const [id, mime] of [
    ['dilan-portrait', 'image/png'],
    ['dilan-animation', 'application/x-shockwave-flash'],
    ['strike-sound', 'audio/mpeg'],
  ])
    assert.equal(remote.find(resource => resource.id === id)?.mime, mime)
  for (const resource of remote) {
    assert.notEqual(resource.id, resource.source)
    assert.equal('sha256' in resource, false)
    assert.equal('bytes' in resource, false)
  }
  assert.equal(presentation.manifest.version, 2)
  for (const [kind, id, field, resource] of [
    ['skills', 'strike', 'sfx', 'strike-sound'],
    ['skills', 'rest', 'sfx', 'strike-sound'],
    ['species', 'pet', 'icon', 'frostling-icon'],
    ['species', 'pet-swf', 'icon', 'dilan-portrait'],
    ['marks', 'slow', 'icon', 'slow'],
  ]) {
    const binding = presentation.manifest.bindings.find(item => item.target.kind === kind && item.target.id === id)
    assert.equal(binding?.[field], resource, `Missing sample binding: ${kind}.${id}.${field}`)
  }
  for (const kind of ['species', 'skills', 'marks'])
    assert.ok(example.environment.data[kind].every(row => !('presentation' in row)))
  assert.equal(presentation.manifest.defaultLocale, 'zh-CN')
  for (const [language, name] of [
    ['zh-CN', '霜击'],
    ['en', 'Frost Strike'],
  ]) {
    const locales = presentation.manifest.locales[language]
    assert.equal(locales.skill.strike.name, name)
    assert.match(locales.skill.strike.description, /\{power, plural,/)
    assert.match(locales.skill.rest.description, /<damage>\{power\}<\/damage>/)
    assert.ok(locales.skill.strike.description.includes(`<mark>${example.manifest.arcadia.namespace}:slow</mark>`))
    assert.ok(locales.species['pet-swf'].name)
    assert.ok(locales.mark.slow.description)
  }
})

test('the installed package handles miss, hit, refresh, parameter updates, transfer and source removal', async () => {
  const battle = await example.createBattle(),
    other = await example.createBattle()
  const a = battle.playerA.activePet,
    b = battle.playerB.activePet
  const speed = b.stat.spe,
    otherSpeed = other.playerB.activePet.stat.spe
  battle.applyEffects(attack(battle), EffectTrigger.OnMiss)
  assert.equal(b.marks.length, 0)
  battle.applyEffects(attack(battle), EffectTrigger.OnHit)
  const mark = b.marks[0]
  assert.equal(mark.duration, 2)
  assert.equal(b.stat.spe, speed - 25)
  mark.duration = 1
  battle.applyEffects(attack(battle), EffectTrigger.OnHit)
  assert.equal(b.marks.length, 1)
  assert.equal(mark.duration, 2)
  assert.equal(mark.stack, 1)
  assert.equal(b.stat.spe, speed - 25)
  const effect = mark.effects[0]
  example
    .contentFor(battle)
    .parametersFor(effect.id)
    .set(battle.configSystem, parameterAddress(effect.id, 'parameters', 'amount'), -40, mark)
  assert.equal(b.stat.spe, speed - 40)
  assert.equal(other.playerB.activePet.stat.spe, otherSpeed)
  assert.equal(other.playerB.activePet.marks.length, 0)
  mark.isSuppressed = true
  assert.equal(b.stat.spe, speed)
  const context = new EffectContext(attack(battle), EffectTrigger.OnHit, a.skills[0])
  const aSpeed = a.stat.spe
  transferMarks(context, a, mark)
  assert.equal(b.stat.spe, speed)
  assert.equal(mark.owner, a)
  assert.equal(a.stat.spe, aSpeed)
  mark.isSuppressed = false
  assert.equal(a.stat.spe, aSpeed - 40)
  removeMark(new RemoveMarkContext(context, mark))
  assert.equal(a.stat.spe, aSpeed)
})

test(
  'JSON waiting-point restoration retains the parameter and natural expiry releases the modifier',
  { timeout: 20000 },
  async () => {
    let battle = await example.createBattle(),
      running = battle.startBattle().catch(cancelled)
    try {
      await battle.waitForInputReady()
      battle.applyEffects(attack(battle), EffectTrigger.OnHit)
      const speed = battle.playerB.activePet.stat.spe + 25
      const mark = battle.playerB.activePet.marks[0],
        effect = mark.effects[0]
      example
        .contentFor(battle)
        .parametersFor(effect.id)
        .set(battle.configSystem, parameterAddress(effect.id, 'parameters', 'amount'), -30, mark)
      const saved = JSON.parse(JSON.stringify(example.contentFor(battle).snapshot(battle)))
      await battle.cleanup()
      await running
      battle = await example.restoreBattle(saved)
      example.track(battle)
      assert.equal(battle.playerB.activePet.stat.spe, speed - 30)
      assert.equal(battle.playerB.activePet.marks[0].duration, 2)
      running = battle.resumeBattle().catch(cancelled)
      await battle.waitForInputReady()
      for (const remaining of [1, 0]) {
        const next = nextTurn(battle)
        for (const player of [battle.playerA, battle.playerB])
          assert.equal(
            battle.setSelection({
              type: 'use-skill',
              player: player.id,
              skill: player.activePet.skills[1].id,
              target: AttackTargetOpinion.opponent,
            }),
            true,
          )
        await next
        assert.equal(battle.playerB.activePet.marks[0]?.duration ?? 0, remaining)
      }
      assert.equal(battle.playerB.activePet.stat.spe, speed)
    } finally {
      await battle.cleanup()
      await running
    }
  },
)

test('two complete battles reproduce the same result from the same seed', { timeout: 20000 }, async () => {
  const first = await runBattle(await example.createBattle('repeatable-example'))
  const second = await runBattle(await example.createBattle('repeatable-example'))
  assert.deepEqual(first, second)
})
