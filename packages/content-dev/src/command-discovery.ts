import { createRequire } from 'node:module'

type Command = {
  name: string
  arguments: string
  target: 'sdk' | 'project' | 'desktop'
  description: string
}

const commands: Command[] = [
  {
    name: 'commands',
    arguments: '--json',
    target: 'sdk',
    description: 'List CLI commands and workspace operations as JSON.',
  },
  {
    name: 'init',
    arguments: '<pack|environment> <directory> [--id <id>]',
    target: 'sdk',
    description: 'Create an author project in a new or empty directory.',
  },
  {
    name: 'check',
    arguments: '',
    target: 'project',
    description: 'Check content sources or a standalone environment declaration.',
  },
  {
    name: 'build',
    arguments: '',
    target: 'project',
    description: 'Compile TypeScript and assemble content pack metadata.',
  },
  {
    name: 'rename',
    arguments: '--name <package-name> --project-id <id> --namespace <namespace>',
    target: 'project',
    description: 'Change the identities and local references of a content pack.',
  },
  {
    name: 'demo',
    arguments: '[--seed <seed>]',
    target: 'project',
    description: 'Run a headless battle with the saved project teams.',
  },
  {
    name: 'preview',
    arguments: '',
    target: 'project',
    description: 'Prepare a local candidate for the full battle client. Stop with Ctrl+C.',
  },
  {
    name: 'pack',
    arguments: '[--release]',
    target: 'project',
    description: 'Build a content pack or environment archive. --release verifies a content pack in a clean consumer.',
  },
  {
    name: 'setup',
    arguments: '[--sdk-dir <directory>] [--offline]',
    target: 'project',
    description: 'Install the pinned development SDK and tool.',
  },
  {
    name: 'workspace',
    arguments: '<directory> [<operation>] [--execute]',
    target: 'project',
    description: 'Run a structured author operation. The default operation is describe.',
  },
  ...(
    [
      ['keygen', '--public-out <file>', 'Generate a Workshop signing key. The private key is printed once to stdout.'],
      [
        'root',
        '--registry <id> --version <n> --root-key <file>... --snapshot-key <file>... --mirror <url>... --out <file>',
        'Write an unsigned Workshop root metadata file.',
      ],
      ['sign', '<envelope.json> --key-env <NAME>', 'Add a signature from the key in an environment variable.'],
      ['check', '[<directory>] [--project <id>]...', 'Verify Registry declarations and their npm releases.'],
      [
        'build',
        '[<directory>] --out <directory> --key-env <NAME> [--published <url|directory>]... [--first] [--bump]',
        'Discover npm releases and write a signed Registry site after the newest published snapshot.',
      ],
    ] as const
  ).map(([name, arguments_, description]): Command => ({
    name: 'registry ' + name,
    arguments: arguments_,
    target: 'sdk',
    description,
  })),
  {
    name: 'desktop instances',
    arguments: '',
    target: 'desktop',
    description: 'List running Desktop instances available to this user.',
  },
  ...(['packages', 'environments'] as const).flatMap((library): Command[] => [
    {
      name: 'desktop ' + library + ' list',
      arguments: '[--instance <id>]',
      target: 'desktop',
      description: 'List ' + library + ' in the selected Desktop library.',
    },
    {
      name: 'desktop ' + library + ' install',
      arguments:
        library === 'packages'
          ? '<file.tgz|file.zip|name@version> [--instance <id>] [--allow-download]'
          : '<file.tgz|name@version> [--instance <id>] [--allow-download] [--id <environment-id>]',
      target: 'desktop',
      description: 'Install into the selected Desktop library. Downloads require --allow-download.',
    },
  ]),
]

export const desktopHelp = commands
  .filter(command => command.target === 'desktop')
  .map(command => ['arcadia-content', command.name, command.arguments].filter(Boolean).join(' '))
  .join('\n')

export const commandHelp = [
  'arcadia-content <command>',
  ...commands.map(
    command => `  ${[command.name, command.arguments].filter(Boolean).join(' ')}  ${command.description}`,
  ),
].join('\n')

export async function commandsCli(args: string[]) {
  if (args.length !== 1 || args[0] !== '--json') throw new Error('Usage: arcadia-content commands --json')
  const { jobKind, outputSchemas } = await import('./mcp-contracts.ts')
  // These raw session operations have no corresponding structured MCP result schema.
  const operations = [...Object.keys(outputSchemas), 'snapshot', 'job', 'jobs', 'cancel'].sort()
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      sdkVersion: createRequire(import.meta.url)('../package.json').version,
      commands,
      workspace: {
        operations,
        input: { source: 'stdin', format: 'json-object', ignoredBy: ['describe', 'git-status'] },
        jobs: jobKind.options.map(name => ({
          name,
          requiresExecute: name !== 'check',
          projectKinds: name === 'release' ? ['pack'] : ['pack', 'environment'],
          options: [
            ...(name === 'preview' || name === 'demo' ? ['--environment <id>'] : []),
            ...(name === 'demo' ? ['--seed <seed>'] : []),
          ],
        })),
        previewOperations: [
          { name: 'team-validate', requiresExecute: false },
          { name: 'battle', requiresExecute: true },
        ],
      },
    }),
  )
}
