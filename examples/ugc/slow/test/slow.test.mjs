import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AttackTargetOpinion,
  BattleMessageType,
  EffectTrigger,
  RemoveMarkContext,
  TurnContext,
  UseSkillContext,
  createContentCatalog,
  setGlobalLogger,
} from '@arcadia-eternity/battle/v4'
import { inspectNpmProject, prepareNpmProject } from '@arcadia-eternity/pack-loader/node'

const exec = promisify(execFile)
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })

test(
  'the packed slow effect responds to misses, hits, refreshes, recovery and expiry',
  { timeout: 60000 },
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'arcadia-author-scenario-'))
    let environment, battle, running
    try {
      const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
      const packed = await exec(
        'npm',
        ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary, '--cache', join(temporary, 'cache')],
        { cwd: project },
      )
      const tarball = join(temporary, JSON.parse(packed.stdout)[0].filename)
      const installationDir = join(temporary, 'installation')
      await mkdir(installationDir)
      await writeFile(
        join(installationDir, 'package.json'),
        JSON.stringify({
          name: 'arcadia-author-test',
          version: '1.0.0',
          private: true,
          dependencies: { [manifest.name]: `file:${tarball}` },
        }),
      )
      await exec(
        'npm',
        [
          'install',
          '--offline',
          '--ignore-scripts',
          '--omit=dev',
          '--no-audit',
          '--no-fund',
          '--cache',
          join(temporary, 'cache'),
        ],
        { cwd: installationDir },
      )
      const installation = await inspectNpmProject(installationDir)
      // Synthetic test host identity; production approval uses the actual host build and administrator policy.
      const host = {
        build: { formatVersion: 1, coreBuildId: 'a'.repeat(64), registryBuildId: 'b'.repeat(64) },
        base: {
          marks: [],
          species: [],
          skills: [
            { id: 'skill_test_rest', element: 'Normal', category: 'Physical', power: 1, rage: 0, accuracy: 100 },
          ],
        },
        templates: [],
        createContent: (data, revision, registrations) =>
          createContentCatalog(data, revision, undefined, registrations),
      }
      environment = await prepareNpmProject(installationDir, host, {
        installationDigest: installation.digest,
        policy: { profile: 'local-test' },
      })
      const namespace = manifest.arcadia.namespace
      const players = [0, 1].map(side => ({
        id: String(side).repeat(21),
        name: `Player ${side}`,
        team: [
          {
            id: String(side + 2).repeat(21),
            name: 'Pet',
            species: `${namespace}:pet`,
            level: 100,
            nature: 'Hardy',
            skills: [`${namespace}:strike`, 'skill_test_rest'],
            evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
            ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
          },
        ],
      }))
      let [a, b] = environment.content.parsePlayers(players)
      battle = environment.content.createBattle(a, b, { rngSeed: 'author-slow', timerConfig: { enabled: false } })
      const cancelled = error => {
        if (!(error instanceof Error) || error.message !== 'Battle cancelled') throw error
      }
      running = battle.startBattle().catch(cancelled)
      await battle.waitForInputReady()
      const turn = () => new TurnContext(battle)
      const attack = () => {
        const context = new UseSkillContext(turn(), a, a.activePet, AttackTargetOpinion.opponent, a.activePet.skills[0])
        context.updateActualTarget()
        return context
      }
      const speed = b.activePet.stat.spe
      battle.applyEffects(attack(), EffectTrigger.OnMiss)
      assert.equal(b.activePet.marks.length, 0, 'a miss must not apply slow')
      battle.applyEffects(attack(), EffectTrigger.OnHit)
      const mark = b.activePet.marks[0]
      assert.equal(mark.duration, 2, 'a hit creates a two-turn slow')
      assert.equal(b.activePet.stat.spe, speed - 25, 'slow contributes -25 speed')
      mark.duration = 1
      battle.applyEffects(attack(), EffectTrigger.OnHit)
      assert.equal(b.activePet.marks.length, 1, 'repeat hits do not create extra marks')
      assert.equal(mark.duration, 2, 'repeat hits refresh the duration')
      assert.equal(mark.stack, 1, 'repeat hits do not stack the magnitude')
      assert.equal(b.activePet.stat.spe, speed - 25)
      const saved = JSON.parse(JSON.stringify(environment.content.snapshot(battle)))
      await battle.cleanup()
      await running
      battle = environment.content.restore(saved)
      a = battle.playerA
      b = battle.playerB
      assert.equal(b.activePet.marks[0].duration, 2, 'saved waiting point preserves the refreshed duration')
      assert.equal(b.activePet.stat.spe, speed - 25, 'restoration rebinds the speed contribution')
      let selected
      battle.registerListener(message => {
        if (message.type === BattleMessageType.TurnAction) selected?.()
      })
      running = battle.resumeBattle().catch(cancelled)
      await battle.waitForInputReady()
      for (const remaining of [1, 0]) {
        const next = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error(`Waiting for remaining duration ${remaining}`)), 10000)
          selected = () => {
            clearTimeout(timeout)
            resolve()
          }
        })
        for (const player of [a, b])
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
        assert.equal(b.activePet.marks[0]?.duration ?? 0, remaining, 'slow expires naturally')
      }
      assert.equal(b.activePet.stat.spe, speed, 'natural expiry restores speed')
      battle.applyEffects(attack(), EffectTrigger.OnHit)
      battle.removeMark(new RemoveMarkContext(turn(), b.activePet.marks[0]))
      assert.equal(b.activePet.stat.spe, speed, 'removing the source restores speed')
    } finally {
      await battle?.cleanup()
      await running
      await environment?.dispose()
      await rm(temporary, { recursive: true, force: true })
    }
  },
)
