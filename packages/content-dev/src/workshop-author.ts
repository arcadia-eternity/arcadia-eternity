import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  OFFICIAL_WORKSHOP_REPOSITORY,
  parseProject,
  type WorkshopProject,
} from '@arcadia-eternity/pack-loader/workshop'
import { checkRegistryProject, npmRegistry, type CheckResult, type WorkshopNpm } from './workshop-registry.ts'
import { contentError } from './workspace-materials.ts'
import { errorMessage, isRecord } from './types.ts'

export const workshopUsage =
  'arcadia-content workshop declare [<directory>] --id <owner.project> [--title <text>] [--summary <text>] [--author <name>]... [--tag <tag>]...'

export type WorkshopDeclaration = Omit<WorkshopProject, 'releases' | 'official' | 'featured'>

function githubRepository(value: unknown) {
  const raw = typeof value === 'string' ? value : isRecord(value) ? value.url : undefined
  const match =
    typeof raw === 'string'
      ? /^(?:git\+)?https:\/\/github\.com\/([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(raw)
      : null
  if (!match)
    throw contentError(
      'WORKSHOP_REPOSITORY_REQUIRED',
      'Set package.json repository.url to the HTTPS address of the GitHub repository that publishes this project.',
    )
  return match[1]
}

/** Registry declaration for a project, derived from the manifest its npm releases are built from. */
export function workshopDeclaration(
  manifest: unknown,
  input: { id: string; title?: string; summary?: string; authors?: string[]; tags?: string[] },
): WorkshopDeclaration {
  if (!isRecord(manifest) || typeof manifest.name !== 'string')
    throw contentError('WORKSHOP_DECLARATION_INVALID', 'package.json needs a name')
  const environment = isRecord(manifest.arcadiaEnvironment) ? manifest.arcadiaEnvironment : undefined
  if (!environment && !isRecord(manifest.arcadia))
    throw contentError('WORKSHOP_KIND_MISMATCH', 'package.json declares neither arcadia nor arcadiaEnvironment')
  if (manifest.name.startsWith('@arcadia-local/'))
    throw contentError('WORKSHOP_NPM_NAME_REQUIRED', 'Rename the package to an npm scope you own before publishing.')
  const repository = githubRepository(manifest.repository)
  const description = typeof manifest.description === 'string' ? manifest.description.trim() : ''
  const title = input.title ?? (typeof environment?.name === 'string' ? environment.name : undefined)
  const project = {
    id: input.id,
    kind: environment ? 'environment' : 'package',
    npm: manifest.name,
    title: title ?? manifest.name.replace(/^@[^/]+\//, ''),
    summary: input.summary ?? (description || title || manifest.name),
    authors: input.authors?.length ? input.authors : [repository.split('/')[0]],
    ...(typeof manifest.license === 'string' && { license: manifest.license }),
    repository,
    ...(typeof manifest.homepage === 'string' && manifest.homepage.startsWith('https://')
      ? { homepage: manifest.homepage }
      : {}),
    tags: input.tags ?? [],
  }
  let parsed: WorkshopProject
  try {
    parsed = parseProject({ ...project, official: false, featured: false, releases: [] }, 'declaration')
  } catch (error) {
    throw contentError('WORKSHOP_DECLARATION_INVALID', errorMessage(error))
  }
  const { releases: _releases, official: _official, featured: _featured, ...declaration } = parsed
  return declaration
}

export interface WorkshopSubmission {
  declaration: WorkshopDeclaration
  file: string
  check: CheckResult
  /** Where the declaration is reviewed; open a pull request that adds `file` with `declaration` as its content. */
  registry: string
}

/** Build the declaration for a project directory and verify its latest npm releases against the Registry rules. */
export async function prepareWorkshopSubmission(
  directory: string,
  input: Parameters<typeof workshopDeclaration>[1],
  options: { npm?: WorkshopNpm; signal?: AbortSignal } = {},
): Promise<WorkshopSubmission> {
  const manifest: unknown = JSON.parse(await readFile(join(resolve(directory), 'package.json'), 'utf8'))
  const declaration = workshopDeclaration(manifest, input)
  const check = await checkRegistryProject(declaration, { npm: options.npm ?? npmRegistry(), signal: options.signal })
  return {
    declaration,
    file: `projects/${declaration.id}.json`,
    check,
    registry: `https://github.com/${OFFICIAL_WORKSHOP_REPOSITORY}`,
  }
}

export async function workshopCli(args: string[]) {
  const [operation, ...rest] = args
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      id: { type: 'string' },
      title: { type: 'string' },
      summary: { type: 'string' },
      author: { type: 'string', multiple: true },
      tag: { type: 'string', multiple: true },
    },
  })
  if (operation !== 'declare' || !values.id || positionals.length > 1) throw new Error(workshopUsage)
  const submission = await prepareWorkshopSubmission(positionals[0] ?? '.', {
    id: values.id,
    title: values.title,
    summary: values.summary,
    authors: values.author,
    tags: values.tag,
  })
  console.log(JSON.stringify(submission, null, 2))
  if (!submission.check.verified.length) process.exitCode = 1
}
