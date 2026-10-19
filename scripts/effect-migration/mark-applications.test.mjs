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
    { ...d, trigger: 'OnDamage', condition: { type: 'petIsActive' } },
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
    generated: 278,
    protected: 2,
    dependencies: 188,
    rejected: 7,
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

test('requires a mandatory damaged-owner or skill-owner guard at damage stages', () => {
  const d = { ...source(), trigger: 'PostDamage', condition: { type: 'selfBeDamaged' } }
  assert.equal(classifyMarkApplication(d).when, 'conditions.selfBeDamaged')
  assert.equal(classifyMarkApplication({ ...d, condition: { type: 'selfUseSkill' } }).when, 'conditions.selfUsesSkill')
  assert.ok(
    classifyMarkApplication({ ...d, condition: { type: 'some', conditions: [d.condition, { type: 'selfUseSkill' }] } })
      .reason,
  )
  assert.ok(classifyMarkApplication({ ...d, trigger: ['PostDamage', 'OnHit'] }).reason)
})

test('damage-stage checkSelf retains target ownership in nested admission and option branches', () => {
  for (const trigger of ['OnDamage', 'PostDamage']) {
    const d = {
      ...source(),
      trigger,
      condition: {
        type: 'every',
        conditions: [
          { type: 'selfBeDamaged' },
          { type: 'not', condition: { type: 'not', condition: { type: 'checkSelf' } } },
        ],
      },
    }
    d.apply.stack = {
      type: 'conditional',
      condition: { type: 'checkSelf' },
      trueValue: 2,
      falseValue: 1,
    }
    const recipe = classifyMarkApplication(d)
    assert.equal(
      recipe.when,
      'conditions.all(conditions.selfBeDamaged,conditions.not(conditions.not(conditions.selfBeDamaged)))',
    )
    assert.equal(recipe.stackValue, 'values.choose(conditions.selfBeDamaged,2,1)')
  }
  assert.equal(
    classifyMarkApplication({
      ...source(),
      condition: {
        type: 'every',
        conditions: [{ type: 'selfUseSkill' }, { type: 'checkSelf' }],
      },
    }).when,
    'conditions.all(conditions.selfUsesSkill,conditions.ownerUsesSkill)',
  )
})

test('switch option checkSelf queries the direct incoming pet', () => {
  const d = { ...source(), trigger: 'OnSwitchIn', condition: { type: 'selfSwitchIn' } }
  d.apply.stack = { type: 'conditional', condition: { type: 'checkSelf' }, trueValue: 2, falseValue: 1 }
  assert.equal(classifyMarkApplication(d).stackValue, 'values.choose(conditions.ownerSwitchesIn,2,1)')
})

test('target-side skill admission requires a positive mandatory guard', () => {
  const d = { ...source(), trigger: 'OnMiss', condition: { type: 'selfBeSkillTarget' } }
  assert.equal(classifyMarkApplication(d).when, 'conditions.ownerIsSkillTarget')
  assert.ok(classifyMarkApplication({ ...d, condition: { type: 'not', condition: d.condition } }).reason)
  assert.ok(classifyMarkApplication({ ...d, trigger: 'PostDamage' }).reason)
})

test('skill selector corrections retain source paths without mutating input', () => {
  const d = {
    ...source(),
    condition: {
      type: 'every',
      conditions: [
        { type: 'selfUseSkill' },
        {
          type: 'evaluate',
          target: { base: 'useSkillContext', chain: [{ type: 'selectPath', arg: 'category' }] },
          evaluator: { type: 'same', value: 'Physical' },
        },
      ],
    },
  }
  const before = structuredClone(d)
  const recipe = classifyMarkApplication(d)
  assert.deepEqual(d, before)
  assert.deepEqual(recipe.selectorRepairs, ['/condition/conditions/1/target/base'])
  assert.deepEqual(recipe.additionalDecisions, ['C07'])
  assert.match(recipe.when, /events\[0\]\?\.category/)
})

test('named mark skill paths require the reviewed source node and retain a C09 record', () => {
  for (const id of [
    'effect_ability_add_mark_opponent_xifamihuo_if_using_xifa_skill',
    'effect_emblem_add_mark_fenshenhying_when_use_fenshenshu',
  ]) {
    const d = {
      ...source(),
      id,
      condition: {
        type: 'every',
        conditions: [
          { type: 'selfUseSkill' },
          {
            type: 'evaluate',
            target: {
              base: 'useSkillContext',
              chain: [
                { type: 'selectPath', arg: 'skillId' },
                { type: 'select', arg: { type: 'base', arg: 'baseId' } },
              ],
            },
            evaluator: { type: 'same', value: 'skill/example' },
          },
        ],
      },
    }
    const before = structuredClone(d)
    const recipe = classifyMarkApplication(d)
    assert.deepEqual(d, before)
    assert.deepEqual(recipe.pathRepairs, [
      { path: '/condition/conditions/1/target/chain/0/arg', before: 'skillId', after: 'skill' },
    ])
    assert.deepEqual(recipe.additionalDecisions, ['C07', 'C09'])
    d.condition.conditions[1].target.chain[0].arg = 'unreviewed'
    assert.match(classifyMarkApplication(d).reason, /C09 source node changed/)
    d.condition.conditions[1].target.chain[0].arg = 'skillId'
    d.condition.conditions[1].target.chain[0].type = 'select'
    assert.match(classifyMarkApplication(d).reason, /C09 source node changed/)
    d.condition.conditions[1].target.chain[0].type = 'selectPath'
    assert.ok(classifyMarkApplication({ ...d, id: 'unreviewed-effect' }).reason)
  }
})

test('damage-result comparison emits one configured threshold and a scoped damage query', () => {
  const d = {
    ...source(),
    trigger: 'OnDamage',
    condition: {
      type: 'every',
      conditions: [
        { type: 'selfUseSkill' },
        {
          type: 'evaluate',
          target: { base: 'damageContext', chain: [{ type: 'selectPath', arg: 'damageResult' }] },
          evaluator: {
            type: 'compare',
            operator: '<',
            value: { type: 'raw:number', value: 100, configId: 'threshold', tags: ['threshold'] },
          },
        },
      ],
    },
  }
  const recipe = classifyMarkApplication(d)
  assert.match(recipe.when, /contexts\.damage\.select\(event => event\.damageResult\)\.first\(\)/)
  assert.match(recipe.when, /ctx\.read\(parameters\.condition_1_value\)/)
  assert.deepEqual(recipe.parameters, [
    { name: 'condition_1_value', value: 100, configId: 'threshold', tags: ['threshold'] },
  ])
  d.condition.conditions[1].target.chain[0].arg = 'baseDamage'
  assert.ok(classifyMarkApplication(d).reason)
  d.condition.conditions[1].target.chain[0].arg = 'damageResult'
  d.condition.conditions[1].evaluator.value.unknown = true
  assert.ok(classifyMarkApplication(d).reason)
})

test('before-multihit admission reads the computed result and requires the skill-owner guard', () => {
  const d = {
    ...source(),
    trigger: 'BeforeMultiHit',
    condition: {
      type: 'every',
      conditions: [
        { type: 'selfUseSkill' },
        {
          type: 'evaluate',
          target: { base: 'useSkillContext', chain: [{ type: 'selectPath', arg: 'multihitResult' }] },
          evaluator: { type: 'compare', operator: '==', value: 3 },
        },
      ],
    },
  }
  assert.match(
    classifyMarkApplication(d).when,
    /contexts\.skillUse\.select\(event => event\.multihitResult\)\.first\(\)/,
  )
  assert.ok(classifyMarkApplication({ ...d, condition: { type: 'selfBeSkillTarget' } }).reason)
  assert.ok(classifyMarkApplication({ ...d, trigger: ['BeforeMultiHit', 'OnDamage'] }).reason)
  d.condition.conditions[1].target.chain[0].arg = 'currentHitCount'
  assert.ok(classifyMarkApplication(d).reason)
})
