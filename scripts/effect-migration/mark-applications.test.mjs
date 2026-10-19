import { test } from 'node:test'
import ts from 'typescript'
import assert from 'node:assert/strict'
import { classifyMarkApplication, generateMarkApplications, renderMarkApplications } from './mark-applications.mjs'
const source = () => ({
  id: 'example',
  trigger: 'OnHit',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: { type: 'addMark', target: 'self', mark: { type: 'entity:baseMark', value: 'mark/example' }, stack: 2 },
})
test('recognizes exact fixed dependencies and preserves the old zero-as-omitted behavior', () => {
  assert.equal(classifyMarkApplication(source()).markId, 'mark/example')
  assert.equal(classifyMarkApplication(source()).stack, 2)
  const zero = source()
  zero.apply.stack = 0
  zero.apply.duration = 0
  assert.equal(classifyMarkApplication(zero).stack, undefined)
  assert.equal(classifyMarkApplication(zero).duration, undefined)
  assert.deepEqual(classifyMarkApplication({ ...source(), trigger: ['OnHit', 'OnMiss'] }).triggers, ['OnHit', 'OnMiss'])
})
test('rejects extra semantics rather than silently dropping them', () => {
  const d = source()
  for (const invalid of [
    { ...d, consumesStacks: 1 },
    { ...d, trigger: 'OnDamage' },
    { ...d, trigger: ['OnHit', 'OnHit'] },
    { ...d, priority: NaN },
    { ...d, condition: { type: 'some', conditions: [d.condition, { type: 'isFirstSkillUsedThisTurn' }] } },
    { ...d, condition: { type: 'not', condition: d.condition } },
    { ...d, apply: { ...d.apply, config: { duration: 1 } } },
    { ...d, apply: { ...d.apply, stack: { type: 'raw:number', value: 2, unknown: true } } },
    { ...d, apply: { ...d.apply, duration: Infinity } },
    { ...d, apply: { ...d.apply, target: 'selfTeam' } },
    { ...d, apply: { ...d.apply, mark: { ...d.apply.mark, configId: 'dynamic' } } },
  ])
    assert.ok(classifyMarkApplication(invalid).reason)
})
test('regenerates the exact current native source and dependency ledger without writes', async () => {
  assert.deepEqual(await generateMarkApplications({ check: true }), {
    generated: 264,
    protected: 2,
    dependencies: 180,
    rejected: 21,
  })
})

test('requires a positive self-use guard and retains composed admission order and C08', () => {
  const d = source()
  const ordered = {
    ...d,
    condition: { type: 'every', conditions: [d.condition, { type: 'isFirstSkillUsedThisTurn' }] },
  }
  assert.equal(
    classifyMarkApplication(ordered).when,
    'conditions.all(conditions.selfUsesSkill,conditions.firstSkillThisTurn)',
  )
  assert.deepEqual(classifyMarkApplication(ordered).additionalDecisions, ['C08'])
  assert.ok(
    classifyMarkApplication({
      ...d,
      condition: {
        type: 'every',
        conditions: [{ type: 'some', conditions: [d.condition, { type: 'isFirstSkillUsedThisTurn' }] }],
      },
    }).reason,
  )
  assert.ok(
    classifyMarkApplication({ ...d, condition: { type: 'every', conditions: [d.condition, { type: 'unknown' }] } })
      .reason,
  )
})

test('rendered imports cover shared-emitter context expressions beyond current catalog cases', () => {
  for (const extra of [
    {
      type: 'evaluate',
      target: { base: 'usingSkillContext', chain: [{ type: 'selectPath', arg: 'category' }] },
      evaluator: { type: 'same', value: 'Physical' },
    },
    {
      type: 'evaluate',
      target: { base: 'battle', chain: [{ type: 'select', arg: { type: 'dynamic', arg: 'currentTurn' } }] },
      evaluator: { type: 'compare', operator: '>', value: 1 },
    },
  ]) {
    const d = source()
    const recipe = classifyMarkApplication({ ...d, condition: { type: 'every', conditions: [d.condition, extra] } })
    assert.ok(!recipe.reason)
    assert.match(recipe.when, /contexts\./)
    const code = renderMarkApplications([recipe], [recipe.markId])
    const file = ts.createSourceFile('candidate.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const imports = file.statements
      .filter(ts.isImportDeclaration)
      .flatMap(node =>
        node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
          ? node.importClause.namedBindings.elements.map(item => item.name.text)
          : [],
      )
    assert.ok(imports.includes('contexts'))
    assert.equal(file.parseDiagnostics.length, 0)
    assert.ok(code.includes(recipe.when))
  }
})

test('preserves queried zero, optional first reads and configurable option identity', () => {
  const d = source()
  const configurable = classifyMarkApplication({
    ...d,
    apply: { ...d.apply, stack: { type: 'raw:number', value: 0, configId: 'layers', tags: ['layer_tag'] } },
  })
  assert.equal(configurable.stack, undefined)
  assert.equal(configurable.stackValue, 'parameters.stack')
  assert.deepEqual(configurable.parameters, [{ name: 'stack', value: 0, configId: 'layers', tags: ['layer_tag'] }])
  const rendered = renderMarkApplications([configurable], [configurable.markId])
  assert.match(rendered, /example.layers/)
  assert.match(rendered, /layer_tag/)
  const dynamic = classifyMarkApplication({
    ...d,
    apply: {
      ...d.apply,
      stack: {
        type: 'dynamic',
        selector: { base: 'self', chain: [{ type: 'select', arg: { type: 'dynamic', arg: 'weight' } }] },
      },
    },
  })
  assert.equal(dynamic.stackValue, 'targets.ownerPet.select(pet => pet.weight).first()')
  const duplicateAliases = {
    ...d,
    apply: {
      ...d.apply,
      stack: { type: 'raw:number', value: 2, configId: 'shared' },
      duration: { type: 'raw:number', value: 3, configId: 'shared' },
    },
  }
  assert.ok(classifyMarkApplication(duplicateAliases).reason)
})

test('imports contexts used only by an option expression', () => {
  for (const key of ['stack', 'duration']) {
    const d = source()
    const recipe = classifyMarkApplication({
      ...d,
      apply: {
        ...d.apply,
        [key]: {
          type: 'dynamic',
          selector: { base: 'battle', chain: [{ type: 'select', arg: { type: 'dynamic', arg: 'currentTurn' } }] },
        },
      },
    })
    assert.ok(!recipe.reason)
    assert.match(recipe[`${key}Value`], /contexts\.battle/)
    const file = ts.createSourceFile(
      'candidate.ts',
      renderMarkApplications([recipe], [recipe.markId]),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )
    const imported = file.statements
      .filter(ts.isImportDeclaration)
      .some(
        node =>
          node.importClause?.namedBindings &&
          ts.isNamedImports(node.importClause.namedBindings) &&
          node.importClause.namedBindings.elements.some(item => item.name.text === 'contexts'),
      )
    assert.ok(imported)
  }
})

test('declares probability parameters in condition order before action parameters', () => {
  const d = source()
  const chance = {
    type: 'evaluate',
    target: 'self',
    evaluator: {
      type: 'probability',
      percent: { type: 'raw:number', value: 40, configId: 'chance', tags: ['chance_tag'] },
    },
  }
  const recipe = classifyMarkApplication({
    ...d,
    trigger: 'BeforeHit',
    condition: { type: 'every', conditions: [d.condition, chance] },
    apply: { ...d.apply, stack: { type: 'raw:number', value: 3, configId: 'layers' } },
  })
  assert.ok(!recipe.reason)
  assert.deepEqual(
    recipe.parameters.map(p => p.name),
    ['condition_1_percent', 'stack'],
  )
  assert.match(recipe.when, /conditions.chance\(parameters.condition_1_percent\)/)
  assert.ok(
    classifyMarkApplication({
      ...d,
      condition: { type: 'every', conditions: [d.condition, chance] },
      apply: { ...d.apply, stack: { type: 'raw:number', value: 3, configId: 'chance' } },
    }).reason,
  )
})

test('battle targets use the shared current-battle query', async () => {
  const d = source()
  d.apply.target = 'battle'
  const recipe = classifyMarkApplication(d)
  assert.equal(recipe.target, 'battle')
  const code = renderMarkApplications([recipe], [recipe.markId])
  assert.ok(code.includes('contexts.battle.apply(ops.addMark('))
  assert.ok(code.includes('contexts,'))
})

test('preserves effect tags without accepting unknown metadata', () => {
  const d = { ...source(), tags: ['xingzhili'] }
  const recipe = classifyMarkApplication(d)
  assert.deepEqual(recipe.tags, ['xingzhili'])
  d.tags.push('later')
  assert.deepEqual(recipe.tags, ['xingzhili'])
  assert.ok(renderMarkApplications([recipe], [recipe.markId]).includes('tags: ["xingzhili"]'))
  assert.ok(classifyMarkApplication({ ...source(), tags: [1] }).reason)
  assert.ok(classifyMarkApplication({ ...source(), tags: 'xingzhili' }).reason)
})

test('keeps entry-stage recognition separate from mandatory skill guards', () => {
  const d = source()
  assert.equal(
    classifyMarkApplication({ ...d, trigger: 'OnSwitchIn', condition: { type: 'selfSwitchIn' } }).when,
    'conditions.ownerSwitchesIn',
  )
  assert.equal(
    classifyMarkApplication({ ...d, trigger: 'OnBattleStart', condition: { type: 'petIsActive' } }).when,
    'conditions.ownerIsActive',
  )
  const { condition, ...unconditional } = d
  assert.equal(classifyMarkApplication({ ...unconditional, trigger: 'OnBattleStart' }).when, '() => true')
  assert.ok(classifyMarkApplication({ ...unconditional, trigger: 'OnHit' }).reason)
  assert.ok(classifyMarkApplication({ ...unconditional, trigger: 'OnSwitchIn' }).reason)
  assert.ok(classifyMarkApplication({ ...d, trigger: ['OnHit', 'OnSwitchIn'] }).reason)
})

test('accepts unconditional fixed mark lifecycle actions and retains strict stage boundaries', () => {
  const { condition, ...d } = source()
  for (const trigger of ['OnMarkDestroy', 'OnMarkDurationEnd']) {
    assert.equal(classifyMarkApplication({ ...d, trigger }).when, '() => true')
    assert.ok(classifyMarkApplication({ ...d, trigger, condition: { type: 'selfUseSkill' } }).reason)
    assert.ok(classifyMarkApplication({ ...d, trigger: [trigger, 'OnHit'] }).reason)
  }
})
