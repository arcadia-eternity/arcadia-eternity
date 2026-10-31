import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AttackTargetOpinion,
  EffectContext,
  EffectTrigger,
  RemoveMarkContext,
  TurnContext,
  parameterAddress,
  setGlobalLogger,
} from '@arcadia-eternity/battle/v4'
import { attack, cancelled, nextTurn, prepareContentPack, runBattle } from '@arcadia-eternity/content-dev/testing'
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
    assert.ok(example.files.some(file => file.startsWith('data/species/')))
    assert.ok(!example.files.includes('content.json'))
  },
  { timeout: 60000 },
)
after(async () => {
  await example?.dispose()
})

test('the installed package includes local artwork, remote declarations and both languages', () => {
  for (const file of [
    'dist/presentation.json',
    'docs/presentation.md',
    'assets/pets/frostling-icon.png',
    'assets/pets/frostling-portrait.png',
    'assets/pets/frostling-battle.png',
    'assets/marks/slow.png',
    ...['zh-CN', 'en'].flatMap(language =>
      ['species', 'skill', 'mark'].map(kind => `locales/${language}/${kind}.yaml`),
    ),
  ])
    assert.ok(example.files.includes(file), `Missing packaged file: ${file}`)
  const presentation = example.environment.presentation.find(
    item => item.namespace === example.manifest.arcadia.namespace,
  )
  assert.ok(presentation)
  assert.equal(presentation.resources.length, 4, 'only the four packaged images have local file paths')
  const remote = presentation.manifest.resources.filter(resource => resource.kind === 'http')
  assert.equal(remote.length, 3)
  assert.ok(remote.some(resource => resource.mime === 'application/x-shockwave-flash'))
  assert.ok(remote.some(resource => resource.mime === 'audio/mpeg'))
  for (const resource of remote) {
    assert.notEqual(resource.id, resource.source)
    assert.equal('sha256' in resource, false)
    assert.equal('bytes' in resource, false)
  }
  assert.equal(presentation.manifest.version, 2)
  assert.equal(presentation.manifest.bindings.length, 5)
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

test('the installed package handles miss, hit, refresh, parameter updates, transfer and source removal', () => {
  const battle = example.createBattle(),
    other = example.createBattle()
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
  example.environment.content
    .parametersFor(effect.id)
    .set(battle.configSystem, parameterAddress(effect.id, 'parameters', 'amount'), -40, mark)
  assert.equal(b.stat.spe, speed - 40)
  assert.equal(other.playerB.activePet.stat.spe, otherSpeed)
  assert.equal(other.playerB.activePet.marks.length, 0)
  mark.isSuppressed = true
  assert.equal(b.stat.spe, speed)
  const context = new EffectContext(attack(battle), EffectTrigger.OnHit, a.skills[0])
  const aSpeed = a.stat.spe
  a.transferMarks(context, mark)
  assert.equal(b.stat.spe, speed)
  assert.equal(mark.owner, a)
  assert.equal(a.stat.spe, aSpeed)
  mark.isSuppressed = false
  assert.equal(a.stat.spe, aSpeed - 40)
  battle.removeMark(new RemoveMarkContext(context, mark))
  assert.equal(a.stat.spe, aSpeed)
})

test(
  'JSON waiting-point restoration retains the parameter and natural expiry releases the modifier',
  { timeout: 20000 },
  async () => {
    let battle = example.createBattle(),
      running = battle.startBattle().catch(cancelled)
    try {
      await battle.waitForInputReady()
      battle.applyEffects(attack(battle), EffectTrigger.OnHit)
      const speed = battle.playerB.activePet.stat.spe + 25
      const mark = battle.playerB.activePet.marks[0],
        effect = mark.effects[0]
      example.environment.content
        .parametersFor(effect.id)
        .set(battle.configSystem, parameterAddress(effect.id, 'parameters', 'amount'), -30, mark)
      const saved = JSON.parse(JSON.stringify(example.environment.content.snapshot(battle)))
      await battle.cleanup()
      await running
      battle = example.environment.content.restore(saved)
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
  const first = await runBattle(example.createBattle('repeatable-example'))
  const second = await runBattle(example.createBattle('repeatable-example'))
  assert.deepEqual(first, second)
})
