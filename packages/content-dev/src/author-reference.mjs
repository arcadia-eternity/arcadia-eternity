import { readFile } from 'node:fs/promises'
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js'
import { NativeSpeciesSchema, NativeSkillSchema, NativeMarkSchema } from '@arcadia-eternity/battle/engine'
import { teamEnvelopeSchema, portablePetSchema } from './project-teams.mjs'
import { EnvironmentDocumentSchema } from './debug-environments.mjs'
import { WorkspaceError } from './workspace.mjs'

export const referenceTopics = ['species', 'skills', 'marks', 'team', 'environment', 'descriptions', 'effects']
const parserSchemas = { species: NativeSpeciesSchema, skills: NativeSkillSchema, marks: NativeMarkSchema }
const examples = { species: 'data/species/pet.yaml', skills: 'data/skills/strike.yaml', marks: 'data/marks/slow.yaml' }

async function template(file) {
  try {
    return await readFile(new URL(`./template/${file}`, import.meta.url), 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return readFile(new URL(`../template/${file}`, import.meta.url), 'utf8')
  }
}

/** Discover installed SDK contracts, without importing a content project's executable effects. */
export async function authorReference({ topic } = {}) {
  if (!referenceTopics.includes(topic)) throw new WorkspaceError('REFERENCE_UNKNOWN', '请选择有效的作者参考主题')
  if (parserSchemas[topic]) {
    return {
      topic,
      title: `${topic}: parser fields and source example`,
      source: '@arcadia-eternity/battle/engine',
      stage: 'linked-runtime',
      schema: toJsonSchemaCompat(parserSchemas[topic]),
      examples: [{ language: 'yaml', text: await template(examples[topic]) }],
      notes: [
        'This is the actual parser schema AFTER package linking, not a validator for unlinked source documents. JSON Schema cannot express every Zod refinement; run check and tests.',
        'Source IDs are local stable IDs. Package linking produces namespace:id runtime IDs. Official base references retain their existing IDs.',
        'Source relationship slots use {$ref:{projectId,kind,id}} for package content: species learnable_skills[].skill_id uses kind skill; ability/emblem use mark; skills/marks behaviors[].definitionId uses behavior. Declare dependencies and resolve actual IDs before writing.',
        'Keep rules, data/presentations, data/resources and localized names/descriptions separate. Do not infer behavior from description text.',
      ],
    }
  }
  if (topic === 'team') {
    const schema = toJsonSchemaCompat(teamEnvelopeSchema)
    schema.properties.team.items = JSON.parse(JSON.stringify(portablePetSchema))
    return {
      topic,
      title: 'Portable project team',
      source: '@arcadia-eternity/content-dev/project-teams',
      stage: 'source',
      schema,
      examples: [{ language: 'yaml', text: 'schemaVersion: 1\nid: blue\nname: 蓝队\nteam: []\n' }],
      notes: [
        'Save debug/teams/<id>.yaml with expectedVersion. Pets have no runtime id. Order determines the lead pet; an empty team is editable but cannot start a battle.',
        'Saving project teams does not change local page drafts, selected teams or an already running battle. Re-read before retrying a conflict.',
      ],
    }
  }
  if (topic === 'environment') {
    return {
      topic,
      title: 'Named project environment',
      source: '@arcadia-eternity/content-dev/debug-environments',
      stage: 'source',
      schema: toJsonSchemaCompat(EnvironmentDocumentSchema),
      examples: [
        {
          language: 'json',
          text: JSON.stringify({ schemaVersion: 1, id: 'interaction', name: '双包交互', packages: {}, sources: [] }),
        },
      ],
      notes: [
        'default is built in and cannot be saved as a named environment. Names must be nonblank; source package names must be unique.',
        'packages accepts registry version constraints, never file:/link:/workspace: or filesystem paths. sources lists package names already mapped locally; it does not contain paths.',
        'Save with expectedVersion. Updating a named environment neither selects it in the page nor changes a running candidate; prepare a new preview explicitly.',
      ],
    }
  }
  if (topic === 'effects') {
    return {
      topic,
      title: 'Native TypeScript effects',
      source: '@arcadia-eternity/content-dev/template/src/effects.ts',
      examples: [{ language: 'typescript', text: await template('src/effects.ts') }],
      notes: [
        'Use the host-supplied CodeEffectModuleContext and SDK; importing an effect module must not register global state.',
        'defineCodeEffect uses triggers/apply. ctx.trigger identifies the trigger; ctx.parent is the typed parent context. Use stable namespaced IDs and actual behavior definitions.',
        'This installed template is the executable example. Query content, read source versions, check, and run behavior tests after edits. No Rule Graph/DSL conversion is needed.',
      ],
    }
  }
  return {
    topic,
    title: 'ICU descriptions and semantic tags',
    source: 'docs/guides/content-presentation.md; packages/web-ui/src/i18n/richDescription.ts',
    tags: [
      'markName',
      'status',
      'guaranteedHit',
      'damage',
      'heal',
      'shield',
      'buff',
      'debuff',
      'rage',
      'strong',
      'emphasis',
      'mark',
    ],
    examples: [
      {
        language: 'text',
        text: '造成 <damage>{power}</damage> 点伤害，并附加 <mark>example-content-pack:slow</mark>。',
      },
    ],
    notes: [
      'Names are plain text. Descriptions use ICU flat variables such as {power}, plural/select, and the listed semantic tags; no Markdown, HTML attributes, dotted expressions, or legacy color codes.',
      'Only scalar public values from the actual rendering context are available. Definition previews have no live stack and preserve {stack}; battle descriptions use the real instance stack.',
      'markName highlights ordinary marks in cyan. status highlights the adverse/exceptional display subclass in orange. guaranteedHit describes the skill property in lime. Do not modify gameplay tags merely for color.',
      '<mark>namespace:id</mark> is the current mark reference. Plain highlighted names are not identities. Resolve real dependency-visible targets; never guess a matching object by name.',
      'A general cross-kind reference protocol, exhaustive variable contract and shared reference-integrity validator are not implemented. Formatting checks do not prove all references are valid.',
    ],
  }
}
