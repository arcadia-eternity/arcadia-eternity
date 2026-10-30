import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import {
  AttackTargetOpinion,
  BattleMessageType,
  TurnContext,
  UseSkillContext,
  createContentCatalog,
} from '@arcadia-eternity/battle/v4'
import { nativeBuildIdentity } from '@arcadia-eternity/battle/v4/build'
import { prepareNpmProject, resolveNpmInvocation } from '@arcadia-eternity/pack-loader/node'

const exec = promisify(execFile)
async function npm(args, options) {
  const invocation = await resolveNpmInvocation(args)
  return exec(invocation.file, invocation.args, options)
}

/** Pack and install exactly what a consuming server receives. Approval is limited to this local demo. */
export async function prepareContentPack(root = process.cwd(), { offline = true, cache } = {}) {
  root = resolve(root)
  const { default: config } = await import(pathToFileURL(join(root, 'arcadia.config.mjs')).href)
  if (typeof config?.players !== 'function')
    throw new Error('arcadia.config.mjs must export a players({ namespace }) function')
  const temporary = await mkdtemp(join(tmpdir(), 'arcadia-pack-template-'))
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const cacheArgs = cache ? ['--cache', resolve(cache)] : []
  const battles = new Set()
  let environment
  async function dispose() {
    for (const battle of battles) await battle.cleanup()
    await environment?.dispose()
    await rm(temporary, { recursive: true, force: true })
  }
  try {
    const result = await npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary, ...cacheArgs], {
      cwd: root,
    })
    const packed = JSON.parse(result.stdout)[0]
    const files = packed.files.map(file => file.path)
    assert.ok(files.includes(manifest.arcadia.content))
    if (manifest.arcadia.effects) assert.ok(files.includes(manifest.arcadia.effects))
    assert.ok(
      !files.some(file => /^(?:\.arcadia|\.github|node_modules|test|scripts)\//.test(file)),
      'the package must contain content, not a developer workspace',
    )
    const installation = join(temporary, 'server-project')
    await mkdir(installation)
    await writeFile(
      join(installation, 'package.json'),
      JSON.stringify({
        name: 'arcadia-template-demo-server',
        version: '1.0.0',
        private: true,
        dependencies: {
          [manifest.name]: `file:${join(temporary, packed.filename)}`,
        },
      }),
    )
    await npm(
      [
        'install',
        ...(offline ? ['--offline'] : []),
        '--ignore-scripts',
        '--omit=dev',
        '--no-audit',
        '--no-fund',
        ...cacheArgs,
      ],
      { cwd: installation },
    )
    environment = await prepareNpmProject(
      installation,
      {
        build: nativeBuildIdentity,
        base: { marks: [], skills: [], species: [] },
        templates: [],
        createContent: (data, revision, registrations) =>
          createContentCatalog(data, revision, undefined, registrations),
      },
      { policy: { profile: 'local-development' } },
    )
    const candidate = {
      packageName: manifest.name,
      version: manifest.version,
      integrity: packed.integrity,
      shasum: packed.shasum,
      sdkApi: manifest.arcadia.sdkApi,
      build: nativeBuildIdentity,
      environmentRevision: environment.revision,
    }
    if (process.env.ARCADIA_AUTHOR_RESULT === '1') console.log(`ARCADIA_RESULT=${JSON.stringify({ candidate })}`)
    function createBattle(seed = 'content-pack-template') {
      const namespace = manifest.arcadia.namespace
      const players = environment.content.parsePlayers(config.players({ namespace, manifest }))
      if (players.length !== 2) throw new Error('The demo requires exactly two players')
      const battle = environment.content.createBattle(players[0], players[1], {
        rngSeed: seed,
        timerConfig: { enabled: false },
      })
      battles.add(battle)
      return battle
    }
    return {
      environment,
      candidate,
      manifest,
      files,
      createBattle,
      dispose,
      track: battle => battles.add(battle),
    }
  } catch (error) {
    await dispose()
    throw error
  }
}

export function attack(battle) {
  const player = battle.playerA
  const context = new UseSkillContext(
    new TurnContext(battle),
    player,
    player.activePet,
    AttackTargetOpinion.opponent,
    player.activePet.skills[0],
  )
  context.updateActualTarget()
  return context
}
export function cancelled(error) {
  if (!(error instanceof Error) || error.message !== 'Battle cancelled') throw error
}
export function nextTurn(battle) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error('Battle did not reach its next input boundary'))
    }, 10000)
    const listener = message => {
      if (message.type !== BattleMessageType.TurnAction) return
      clearTimeout(timeout)
      unsubscribe()
      resolve()
    }
    const unsubscribe = () => battle.unregisterListener(listener)
    battle.registerListener(listener)
  })
}
export async function runBattle(battle, onTurn = () => {}) {
  const damage = [],
    failures = []
  battle.registerListener(message => {
    if (message.type === BattleMessageType.Damage) damage.push(message.data.damage)
    if (message.type === BattleMessageType.Error || message.type === BattleMessageType.EffectApplyFail)
      failures.push(message)
    if (message.type === BattleMessageType.TurnEnd) onTurn(battle)
    if (message.type !== BattleMessageType.TurnAction) return
    for (const player of [battle.playerA, battle.playerB]) {
      const selection =
        battle.currentTurn >= 40
          ? { type: 'surrender', player: player.id }
          : {
              type: 'use-skill',
              player: player.id,
              skill: player.activePet.skills[0].id,
              target: AttackTargetOpinion.opponent,
            }
      if (!battle.setSelection(selection)) throw new Error('Example selection rejected')
      if (selection.type === 'surrender') break
    }
  })
  await battle.startBattle()
  assert.deepEqual(failures, [], 'the demonstration must not hide effect execution failures')
  assert.ok(battle.currentTurn < 40, 'the demonstration should finish by defeating the opposing pet')
  return {
    winner: battle.victor?.name,
    turns: battle.currentTurn,
    hp: [battle.playerA, battle.playerB].map(player => player.activePet.currentHp),
    damage,
  }
}
