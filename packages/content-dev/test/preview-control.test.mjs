import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSourceProject } from '../src/project.mjs'
import { startPreview } from '../src/preview.mjs'
import { callPreviewControl } from '../src/preview-control.mjs'
import { setGlobalLogger } from '@arcadia-eternity/battle/v4'
import { LocalBattleSystemV4 } from '@arcadia-eternity/battle/v4/host'
import { AuthorWorkspace } from '../src/workspace.mjs'
import { ProjectTeams } from '../src/project-teams.mjs'

setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
const exec = promisify(execFile)
const human = async (endpoint, method, ...args) => {
  const response = await fetch(`${endpoint}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args }),
  })
  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))
  return result.result
}
const combat = state => ({
  turn: state.currentTurn,
  phase: state.currentPhase,
  status: state.status,
  players: state.players.map(player => ({
    rage: player.rage,
    pets: player.team.map(pet => ({
      hp: pet.currentHp,
      alive: pet.isAlive,
      marks: pet.marks.map(mark => ({ baseId: mark.baseId, stack: mark.stack })),
    })),
  })),
})

test(
  'automation has isolated, versioned, reproducible battles and bounded event pages over a real candidate',
  { timeout: 90000 },
  async t => {
    const temporary = await mkdtemp(join(tmpdir(), 'arcadia-battle-control-'))
    const root = join(temporary, 'pack')
    let preview
    t.after(async () => {
      await preview?.close()
      await rm(temporary, { recursive: true, force: true })
    })
    await createSourceProject(root, 'battle-control')
    await exec(process.execPath, [fileURLToPath(new URL('../src/cli.mjs', import.meta.url)), 'build'], { cwd: root })
    preview = await startPreview(root)
    const endpoint = preview.endpoint
    const call = (operation, input) => callPreviewControl(endpoint, operation, input)
    await human(endpoint, 'open')
    await human(endpoint, 'ready')
    const humanBefore = await human(endpoint, 'getState', undefined, true)

    const config = { teamIds: ['blue', 'orange'], seed: 'reproducible-case' }
    const first = await call('create', config)
    const second = await call('create', config)
    assert.notEqual(first.sessionId, second.sessionId)
    assert.equal(first.revision, 0)
    assert.ok(first.teamVersions.blue)
    assert.ok(first.selections.some(selection => selection.type === 'use-skill'))
    assert.deepEqual(combat(first.state), combat(second.state))
    const selection = first.selections.find(selection => selection.type === 'use-skill')
    const concurrent = await Promise.allSettled(
      [0, 1].map(() =>
        call('action', {
          sessionId: first.sessionId,
          expectedRevision: first.revision,
          selection,
        }),
      ),
    )
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(concurrent.find(result => result.status === 'rejected').reason.code, 'BATTLE_REVISION_CONFLICT')
    const changed = concurrent.find(result => result.status === 'fulfilled').value
    assert.equal(changed.revision, 1)
    const repeated = await call('action', {
      sessionId: second.sessionId,
      expectedRevision: second.revision,
      selection: second.selections.find(selection => selection.type === 'use-skill'),
    })
    assert.deepEqual(combat(changed.state), combat(repeated.state))
    assert.notDeepEqual(combat(first.state), combat(changed.state))
    assert.deepEqual(await human(endpoint, 'getState', undefined, true), humanBefore)

    const pendingDecision = LocalBattleSystemV4.prototype.waitForPendingDecision
    let failed
    try {
      LocalBattleSystemV4.prototype.waitForPendingDecision = async () => {
        throw new Error('engine execution failed')
      }
      failed = await call('read', { sessionId: first.sessionId })
    } finally {
      LocalBattleSystemV4.prototype.waitForPendingDecision = pendingDecision
    }
    assert.equal(failed.stateCurrent, false)
    assert.equal(failed.failure.code, 'BATTLE_EXECUTION_FAILED')
    assert.equal(failed.revision, changed.revision)
    assert.deepEqual(failed.selections, [])

    const page = await call('events', { sessionId: first.sessionId, limit: 2 })
    assert.equal(page.events.length, 2)
    assert.equal(page.hasMore, true)
    const nextPage = await call('events', { sessionId: first.sessionId, afterCursor: page.nextCursor, limit: 2 })
    assert.ok(nextPage.events[0].cursor > page.events.at(-1).cursor)
    await assert.rejects(
      call('action', {
        sessionId: first.sessionId,
        expectedRevision: changed.revision,
        selection: { type: 'surrender', player: humanBefore.players[0].id },
      }),
      { code: 'BATTLE_ACTION_INVALID' },
    )
    await assert.rejects(
      call('reset', {
        sessionId: first.sessionId,
        expectedRevision: changed.revision,
        teamIds: ['missing', 'orange'],
      }),
      /TEAM_MISSING/,
    )
    assert.deepEqual(combat((await call('read', { sessionId: first.sessionId })).state), combat(changed.state))
    const reset = await call('reset', { sessionId: first.sessionId, expectedRevision: changed.revision })
    assert.equal(reset.revision, 2)
    assert.deepEqual(combat(reset.state), combat(first.state))
    await assert.rejects(call('events', { sessionId: first.sessionId, afterCursor: 0 }), {
      code: 'BATTLE_EVENTS_EXPIRED',
    })
    assert.deepEqual(await human(endpoint, 'getState', undefined, true), humanBefore)

    // Inject failure after the real engine accepts an action, when replaying it would be unsafe.
    const broken = await call('create', config)
    const failAction = async session => {
      const submitAction = LocalBattleSystemV4.prototype.submitAction
      try {
        LocalBattleSystemV4.prototype.submitAction = async function (selection) {
          await submitAction.call(this, selection)
          throw new Error('engine failed after accepting input')
        }
        return await call('action', {
          sessionId: session.sessionId,
          expectedRevision: session.revision,
          selection: session.selections.find(selection => selection.type === 'use-skill'),
        })
      } finally {
        LocalBattleSystemV4.prototype.submitAction = submitAction
      }
    }
    const failedAction = await failAction(broken)
    assert.equal(failedAction.revision, broken.revision + 1)
    assert.equal(failedAction.stateCurrent, false)
    assert.equal(failedAction.failure.message, 'engine failed after accepting input')
    assert.deepEqual(failedAction.selections, [])
    assert.deepEqual(await call('read', { sessionId: broken.sessionId }), failedAction)
    await assert.rejects(
      call('reset', {
        sessionId: broken.sessionId,
        expectedRevision: broken.revision,
      }),
      { code: 'BATTLE_REVISION_CONFLICT' },
    )
    const recovered = await call('reset', {
      sessionId: broken.sessionId,
      expectedRevision: failedAction.revision,
    })
    assert.equal(recovered.failure, undefined)
    assert.equal(recovered.stateCurrent, true)
    assert.equal(recovered.revision, failedAction.revision + 1)
    const failedAgain = await failAction(recovered)
    assert.equal(
      (
        await call('close', {
          sessionId: broken.sessionId,
          expectedRevision: failedAgain.revision,
        })
      ).closed,
      true,
    )
    assert.deepEqual(await human(endpoint, 'getState', undefined, true), humanBefore)

    await call('create', config)
    await call('create', config)
    await assert.rejects(call('create', config), { code: 'BATTLE_SESSION_LIMIT' })
    const closed = await call('close', { sessionId: first.sessionId, expectedRevision: reset.revision })
    assert.equal(closed.closed, true)
    await assert.rejects(call('read', { sessionId: first.sessionId }), { code: 'BATTLE_SESSION_UNKNOWN' })
    assert.ok((await call('create', config)).sessionId)
    // Human cleanup does not reset or close independent automated battles.
    await human(endpoint, 'cleanup')
    assert.equal((await call('read', { sessionId: second.sessionId })).revision, 1)
    await preview.close()
    assert.equal(preview.closed, true)
    await assert.rejects(call('read', { sessionId: second.sessionId }))
  },
)

test('battle transport rejects arbitrary hosts and methods before fetching', async () => {
  await assert.rejects(callPreviewControl('https://example.com/preview', 'read', {}), { code: 'PREVIEW_UNAVAILABLE' })
  await assert.rejects(callPreviewControl(`http://127.0.0.1:1000/${'a'.repeat(48)}`, 'submitAction', {}), {
    code: 'BATTLE_OPERATION_INVALID',
  })
})

test(
  'new and reset automated battles read current saved teams from the source root while active battles keep their snapshots',
  { timeout: 90000 },
  async t => {
    const temporary = await mkdtemp(join(tmpdir(), 'arcadia-live-teams-'))
    const root = join(temporary, 'source'),
      captured = join(temporary, 'candidate')
    let preview, workspace
    t.after(async () => {
      await preview?.close()
      await workspace?.close()
      await rm(temporary, { recursive: true, force: true })
    })
    await createSourceProject(root, 'live-teams')
    await exec(process.execPath, [fileURLToPath(new URL('../src/cli.mjs', import.meta.url)), 'build'], { cwd: root })
    await cp(root, captured, { recursive: true })
    // Real preview jobs build a copy and retain the original project as lockRoot.
    preview = await startPreview(captured, { lockRoot: root })
    workspace = await AuthorWorkspace.open(root, { watch: false })
    const teams = new ProjectTeams(workspace)
    const contentRevision = await workspace.revision({ contentOnly: true })
    const catalogBefore = await (await fetch(`${preview.endpoint}/content`)).json()
    const call = (operation, input) => callPreviewControl(preview.endpoint, operation, input)
    const config = { teamIds: ['blue', 'orange'], seed: 'saved-teams' }
    await human(preview.endpoint, 'open')
    await human(preview.endpoint, 'ready')
    const humanBefore = await human(preview.endpoint, 'getState', undefined, true)
    const original = await call('create', config)
    const { version, ...blue } = (await teams.list()).find(team => team.id === 'blue')
    const edited = structuredClone(blue)
    edited.name = '最新蓝队'
    edited.team[0].level = 65
    const saved = await teams.save({ document: edited, expectedVersion: version })
    const updated = await call('create', config)
    assert.equal(updated.state.players[0].name, '最新蓝队')
    assert.equal(updated.state.players[0].team[0].level, 65)
    assert.equal(updated.teamVersions.blue, saved.version)
    assert.notEqual(updated.teamVersions.blue, original.teamVersions.blue)
    assert.deepEqual(await call('read', { sessionId: original.sessionId }), original)

    const added = await teams.save({
      document: { ...edited, id: 'new-blue', name: '创建预览后新增的队伍' },
      expectedVersion: null,
    })
    const newTeamBattle = await call('create', { ...config, teamIds: ['new-blue', 'orange'] })
    assert.equal(newTeamBattle.state.players[0].name, '创建预览后新增的队伍')
    assert.equal(newTeamBattle.teamVersions['new-blue'], added.version)

    edited.name = '再次更新蓝队'
    edited.team[0].level = 66
    const savedAgain = await teams.save({ document: edited, expectedVersion: saved.version })
    assert.equal((await call('read', { sessionId: updated.sessionId })).teamVersions.blue, saved.version)
    const reset = await call('reset', { sessionId: updated.sessionId, expectedRevision: updated.revision })
    assert.equal(reset.state.players[0].name, '再次更新蓝队')
    assert.equal(reset.state.players[0].team[0].level, 66)
    assert.equal(reset.teamVersions.blue, savedAgain.version)
    assert.equal(reset.seed, updated.seed)
    assert.deepEqual(reset.teamIds, updated.teamIds)
    assert.deepEqual(await call('read', { sessionId: original.sessionId }), original)
    assert.deepEqual(await human(preview.endpoint, 'getState', undefined, true), humanBefore)
    assert.equal(await workspace.revision({ contentOnly: true }), contentRevision)
    assert.deepEqual((await (await fetch(`${preview.endpoint}/content`)).json()).candidate, catalogBefore.candidate)
  },
)
