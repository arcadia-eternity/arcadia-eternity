import { Command, InvalidArgumentError } from 'commander'
import { resolve } from 'node:path'
import type { CommandContext } from '../context'
import { CliError } from '../reporting/errors'
import { reserveOutputs, writeJson } from '../io/files'
import { registerNpmCommands } from './npm'
import { registerProjectCommands } from './project'

function positive(value: string) {
  const n = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < 1)
    throw new InvalidArgumentError('Expected a positive safe integer')
  return n
}
function battleOptions(command: Command) {
  return command
    .requiredOption('-1, --player1 <path>', 'First team YAML/JSON')
    .requiredOption('-2, --player2 <path>', 'Second team YAML/JSON')
    .option('--pack-ref <ref>', 'Content manifest or built-in pack', 'builtin:workspace')
    .option('--works <path>', 'Selected immutable works from an .arcadia archive')
    .option('--npm-project <path>', 'Installed npm environment (code requires explicit approval)')
    .option('--approval <path>', 'Approval file; defaults to the npm project admission file')
    .option('--seed <seed>', 'Root deterministic seed', '0')
    .option('--max-turns <count>', 'Deterministic turn limit', positive, 300)
    .option('--max-actions <count>', 'Accepted input limit', positive, 10000)
    .option('--team-selection', 'Enable pre-battle roster selection', false)
    .option('--strict', 'Strict content validation (always enabled)')
    .option('--validate-data', 'Validate inputs and references (always enabled)')
}
function outputOptions(command: Command) {
  return command
    .option('--format <format>', 'text or json', 'text')
    .option('--json', 'JSON output')
    .option('--out <path>', 'Write result JSON to a new file')
}
export function registerCommands(program: Command, context: CommandContext) {
  let exitCode = 0
  async function emit(report: unknown, options: { out?: string; json?: boolean; format: string }, text: string) {
    if (options.out) await writeJson(resolve(context.cwd, options.out), report)
    await context.stdout(options.json || options.format === 'json' ? JSON.stringify(report) + '\n' : text + '\n')
  }
  function checkFormat(options: { format: string }) {
    if (!['json', 'text'].includes(options.format))
      throw new CliError('FORMAT_INVALID', 'Expected --format text or json')
  }
  const battle = program.command('battle').description('Offline native battles')
  outputOptions(battleOptions(battle.command('simulate')))
    .option('--runs <count>', 'Finite sequential batch', positive, 1)
    .option('--replay-out <path>', 'Save one replay (requires --runs 1)')
    .action(async options => {
      checkFormat(options)
      if (options.replayOut && options.runs !== 1) throw new CliError('REPLAY_BATCH', '--replay-out requires --runs 1')
      await reserveOutputs([options.out, options.replayOut].filter(Boolean).map((p: string) => resolve(context.cwd, p)))
      const [{ prepareContent, prepareRun }, { simulate }] = await Promise.all([
        import('../application/prepare'),
        import('../application/simulate'),
      ])
      const loaded = await prepareContent(options.packRef, context.cwd, options)
      const spec = await prepareRun(options, context.cwd, loaded.content)
      const run = await simulate(loaded, spec, options.runs, {
        signal: context.signal,
        captureReplay: !!options.replayOut,
      })
      if (options.replayOut && run.replays[0]) await writeJson(resolve(context.cwd, options.replayOut), run.replays[0])
      await emit(run.report, options, JSON.stringify(run.report.counts))
      exitCode = run.exitCode
    })
  outputOptions(battle.command('replay').argument('<file>', 'Replay JSON'))
    .option('--verify', 'Verify recorded inputs and result (always enabled)')
    .option('--npm-project <path>', 'Original installed npm environment')
    .option('--approval <path>', 'Explicit npm approval file')
    .action(async (file, options) => {
      checkFormat(options)
      await reserveOutputs(options.out ? [resolve(context.cwd, options.out)] : [])
      const [{ readDocument }, { replay }] = await Promise.all([import('../io/files'), import('../application/replay')])
      if (options.approval && !options.npmProject)
        throw new CliError('CONTENT_OPTIONS', '--approval requires --npm-project')
      const loaded = options.npmProject
        ? await (await import('../application/prepare')).prepareContent('builtin:workspace', context.cwd, options)
        : undefined
      const result = await replay(await readDocument(resolve(context.cwd, file)), context.signal, loaded)
      await emit(result.report, options, result.report.verified ? 'Replay verified' : 'Replay cancelled')
      exitCode = result.exitCode
    })
  async function local(options: {
    player1: string
    player2: string
    seed: string
    maxTurns: number
    maxActions: number
    teamSelection: boolean
    packRef: string
    works?: string
    npmProject?: string
    approval?: string
    ai?: string
    debug?: boolean
  }) {
    const ai = options.ai?.split(',').map(s => s.trim().toLowerCase()) ?? []
    if (ai.some(s => !['player1', 'player2'].includes(s))) throw new CliError('AI_INVALID', 'Expected player1,player2')
    const [{ prepareContent, prepareRun }, { runBattle }, { ConsoleUIV2, initI18n }] = await Promise.all([
      import('../application/prepare'),
      import('../application/run'),
      import('@arcadia-eternity/console'),
    ])
    const loaded = await prepareContent(options.packRef, context.cwd, options)
    const spec = await prepareRun(options, context.cwd, loaded.content)
    const run = await runBattle(loaded.content, spec, {
      signal: context.signal,
      humans: [0, 1].filter(seat => !ai.includes(`player${seat + 1}`)),
      present: async (system, ids) => {
        await initI18n(options.debug, loaded.locales)
        await context.stdout(`已加载 ${loaded.content.effects.length} 个效果实现\n`)
        const ui = new ConsoleUIV2(system, ...ids)
        return { cleanup: () => ui.cleanup(), failure: ui.inputFailure }
      },
    })
    if (run.result.error) await context.stderr(run.result.error.message + '\n')
    await context.stdout(`${run.result.status}: ${run.result.reason}\n`)
    exitCode = run.result.status === 'completed' ? 0 : run.result.status === 'cancelled' ? 130 : 1
  }
  function localOptions(c: Command) {
    return battleOptions(c).option('--ai <players>', 'AI seats: player1,player2').option('--debug', 'Terminal debug')
  }
  localOptions(battle.command('local')).action(local)
  localOptions(program.command('local').description('Alias for battle local')).action(local)
  async function validate(options: {
    packRef: string
    works?: string
    npmProject?: string
    approval?: string
    format: string
    json?: boolean
    out?: string
  }) {
    checkFormat(options)
    await reserveOutputs(options.out ? [resolve(context.cwd, options.out)] : [])
    const { prepareContent } = await import('../application/prepare')
    const loaded = await prepareContent(options.packRef, context.cwd, options)
    const counts = {
      effect: loaded.content.effects.length,
      mark: loaded.content.marks.length,
      skill: loaded.content.skills.length,
      species: loaded.content.species.length,
    }
    await emit(
      {
        format: 'arcadia.cli.validation',
        version: 1,
        valid: true,
        revision: loaded.revision,
        build: loaded.build,
        packs: loaded.packs,
        counts,
        diagnostics: [],
      },
      options,
      `effect=${counts.effect}, mark=${counts.mark}, skill=${counts.skill}, species=${counts.species}\n数据包验证通过`,
    )
  }
  function validationOptions(c: Command) {
    return outputOptions(
      c
        .option('--pack-ref <ref>', 'Content manifest', 'builtin:workspace')
        .option('--works <path>', 'Selected immutable works from an .arcadia archive')
        .option('--npm-project <path>', 'Installed and explicitly approved npm environment')
        .option('--approval <path>', 'Explicit npm approval file')
        .option('--strict', 'Strict validation (always enabled)')
        .option('--validate-data', 'Data validation (always enabled)'),
    )
  }
  const content = program.command('content')
  validationOptions(content.command('validate')).action(validate)
  registerNpmCommands(content, context)
  registerProjectCommands(content, context)
  validationOptions(program.command('validate').description('Alias for content validate')).action(validate)
  return () => exitCode
}
