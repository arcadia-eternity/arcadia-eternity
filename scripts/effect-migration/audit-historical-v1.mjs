import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Only --check supported')
const revision = '61c349fa7ca35c392b0e751c9238759b02aefcb3'
const files = [
  ['parser', 'packages/parser/src/parseEffect.ts', 'packages/battle/src/v4/legacy/parser/parseEffect.ts'],
  [
    'operators',
    'packages/effectBuilder/src/operator.ts',
    'packages/battle/src/v4/legacy/effectBuilder/src/operator.ts',
  ],
  [
    'conditions',
    'packages/effectBuilder/src/condition.ts',
    'packages/battle/src/v4/legacy/effectBuilder/src/condition.ts',
  ],
  [
    'selectors',
    'packages/effectBuilder/src/selector.ts',
    'packages/battle/src/v4/legacy/effectBuilder/src/selector.ts',
  ],
  ['dsl', 'packages/schema/src/effectDsl.ts', 'packages/battle/src/v4/legacy/schema/effectDsl.ts'],
  ['schema', 'packages/schema/src/effectSchema.ts', 'packages/battle/src/v4/legacy/schema/effectSchema.ts'],
]
files.push(
  ['rage-phase', 'packages/battle/src/phases/rage.ts', 'packages/battle/src/v4/phase/rage.ts'],
  ['turn-phase', 'packages/battle/src/phases/turn.ts', 'packages/battle/src/v4/phase/turn.ts'],
  ['context', 'packages/battle/src/context.ts', 'packages/battle/src/v4/context.ts'],
)
const sha = s => createHash('sha256').update(s).digest('hex')
const cases = s => [...new Set([...s.matchAll(/case '([^']+)'/g)].map(m => m[1]))].sort()
const members = s => [...new Set([...s.matchAll(/^  (\w+):/gm)].map(m => m[1]))].sort()
const lines = (s, word) => s.split('\n').flatMap((line, i) => (line.includes(word) ? [i + 1] : []))
const records = []
for (const [kind, historicalPath, importedPath] of files) {
  const historical = execFileSync('git', ['show', `${revision}:${historicalPath}`], { encoding: 'utf8' })
  const imported = await readFile(importedPath, 'utf8')
  const names = kind === 'parser' ? cases : members
  records.push({
    kind,
    historicalPath,
    importedPath,
    historicalSha256: sha(historical),
    importedSha256: sha(imported),
    ...(kind === 'parser' || kind === 'operators' || kind === 'conditions'
      ? { missingNames: names(historical).filter(n => !names(imported).includes(n)) }
      : {}),
    evidence: Object.fromEntries(
      [
        'setRage',
        'sampleBetween',
        'selectorValue',
        'selfBeDamaged',
        'isFirstSkillUsedThisTurn',
        'isLastSkillUsedThisTurn',
        'setIgnoreShield',
        'executeActions',
        'addTemporaryEffect',
        'avg',
        'BeforeRageGain',
        'BeforeRageLoss',
        'OnRageGain',
        'OnRageLoss',
        'pushContext',
      ].map(word => [word, { historicalLines: lines(historical, word), importedLines: lines(imported, word) }]),
    ),
  })
}
const effects = []
const inspectTypes = (v, found = new Set()) => {
  if (v && typeof v === 'object') {
    if (typeof v.type === 'string') found.add(v.type)
    for (const trigger of Array.isArray(v.trigger) ? v.trigger : [v.trigger])
      if (typeof trigger === 'string') found.add(trigger)
    for (const child of Object.values(v)) inspectTypes(child, found)
  }
  return found
}
const relevant = new Set([
  ...records[0].missingNames,
  'selectorValue',
  'setRage',
  'BeforeRageGain',
  'BeforeRageLoss',
  'OnRageGain',
  'OnRageLoss',
  'selfBeDamaged',
  'isFirstSkillUsedThisTurn',
  'isLastSkillUsedThisTurn',
])
for (const kind of ['global', 'ability', 'emblem', 'mark', 'skill']) {
  const sourceFile = `packs/base/data/effect_${kind}.yaml`
  for (const [index, d] of parse(await readFile(sourceFile, 'utf8'), { merge: true }).entries()) {
    const types = [...inspectTypes(d)].filter(t => relevant.has(t)).sort()
    if (types.length) effects.push({ id: d.id, sourceFile, sourcePath: `/${index}`, types })
  }
}
const result = {
  revision,
  scope:
    'Historical existence audit only; source presence does not prove behavioral equivalence or production acceptance.',
  records,
  effects,
}
const path = 'docs/v4/validation/historical-v1-audit.json'
const text = JSON.stringify(result, null, 2) + '\n'
if (process.argv.includes('--check')) {
  if ((await readFile(path, 'utf8')) !== text) throw new Error('Historical audit is stale')
} else await writeFile(path, text)
console.log(
  JSON.stringify({ revision, missingParserCases: records[0].missingNames, affectedDefinitions: effects.length }),
)
