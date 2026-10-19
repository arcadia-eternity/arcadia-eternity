import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { Conditions, EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  AddMarkContext,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  ConfigModifier,
  ConfigModifierType,
  ConfigDurationType,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
for (const side of ['self', 'opponent'] as const)
  for (const kind of ['skill', 'mark'] as const)
    it.each([
      'absent',
      'present',
      'wrong-base',
      'inactive',
      'empty-values',
      'first-value',
      'owner-change',
      'switch',
      'actual-target',
      'non-pet',
    ] as const)(`${side} ${kind} historical mark condition: %s`, variant => {
      const f = makeScenario(317),
        { battle, a, b } = f
      battles.push(battle)
      const owner = a.activePet,
        skill = owner.skills[0]
      skill.effects.splice(0)
      const setup = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill)
      let source: typeof skill | (typeof owner.marks)[number] = skill
      if (kind === 'mark') {
        const base = new BaseMark('fixture/source' as baseMarkId, [], f.debuff.config)
        battle.addMark(new AddMarkContext(setup, owner, base))
        source = owner.marks.find(m => m.base === base)!
      }
      const base = new BaseMark('fixture/presence' as baseMarkId, [], f.debuff.config)
      const target = side === 'self' ? owner : b.activePet
      if (variant !== 'absent') battle.addMark(new AddMarkContext(setup, target, base))
      const mark = target.marks.find(m => m.base === base)
      if (variant === 'inactive') mark!.isActive = false
      const parent = new UseSkillContext(new TurnContext(battle), a, owner, AttackTargetOpinion.opponent, skill)
      if (variant === 'actual-target') parent.actualTarget = b.team[1]
      if (variant === 'switch') b.activePet = b.team[1]
      if (variant === 'owner-change') source.owner = b.activePet
      if (variant === 'non-pet') source.owner = battle
      const context = new EffectContext(parent, EffectTrigger.BeforeHit, source)
      const value =
        variant === 'empty-values'
          ? []
          : variant === 'first-value'
            ? ['missing', base.id]
            : variant === 'wrong-base'
              ? 'missing'
              : base.id
      const condition = side === 'self' ? Conditions.selfHasMark(value) : Conditions.opponentHasMark(value)
      expect(condition(context)).toBe(
        !['absent', 'wrong-base', 'empty-values', 'first-value', 'owner-change', 'non-pet'].includes(variant) &&
          !(variant === 'switch' && side === 'opponent'),
      )
      // The same rule also works outside a skill context, including an absent owning pet.
      expect(condition(new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, source))).toBe(
        condition(context),
      )
    })
for (const type of ['selfHasMark', 'opponentHasMark'] as const)
  it(`parses ${type} through the restored schema and resolves scoped raw base IDs`, () => {
    const id = `fixture/${type}`
    const effect = EffectParser.parse({
      id,
      trigger: 'BeforeHit',
      priority: 0,
      condition: { type, baseId: { type: 'raw:string', value: 'missing', configId: 'required' } },
      apply: { type: 'heal', target: 'self', value: 20 },
    })
    const f = makeScenario(319),
      { battle, a, b } = f
    battles.push(battle)
    const owner = a.activePet,
      skill = owner.skills[0]
    skill.effects.splice(0)
    skill.effects.push(effect)
    const base = new BaseMark('fixture/presence' as baseMarkId, [], f.debuff.config)
    battle.addMark(
      new AddMarkContext(
        new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill),
        type === 'selfHasMark' ? owner : b.activePet,
        base,
      ),
    )
    const parent = new UseSkillContext(new TurnContext(battle), a, owner, AttackTargetOpinion.opponent, skill)
    owner.currentHp = 10
    battle.applyEffects(parent, EffectTrigger.BeforeHit, skill)
    expect(owner.currentHp).toBe(10)
    const remove = battle.configSystem.addScopedConfigModifier(
      `${id}.required`,
      new ConfigModifier(ConfigDurationType.binding, 'required-mark', base.id, ConfigModifierType.override, 0),
      skill,
    )
    battle.applyEffects(parent, EffectTrigger.BeforeHit, skill)
    expect(owner.currentHp).toBe(30)
    remove()
    battle.applyEffects(parent, EffectTrigger.BeforeHit, skill)
    expect(owner.currentHp).toBe(30)
  })
it('ports the historical method bodies exactly, except const and formatting', () => {
  // Normalized historical method bodies from e19261dba321d06a971b74455b08bac5f2dc1f70.
  // A fixed digest keeps this guard usable in shallow CI checkouts.
  const historicalDigest = '9679affb00306cb980b8ff37c4decd794692efe40cbac923fe412ecdf4b6b6a1'
  const current = readFileSync(new URL('../../src/v4/legacy/effectBuilder/src/condition.ts', import.meta.url), 'utf8')
  const extract = (text: string) =>
    text
      .slice(text.indexOf('  // 简化版：检查自己'), text.indexOf('  // 当自己被选为当前UseSkillContext'))
      .replace('let opponentPet: Pet =', 'const opponentPet: Pet =')
      .replace(/\s+/g, '')
  expect(createHash('sha256').update(extract(current)).digest('hex')).toBe(historicalDigest)
  expect(extract(current)).not.toBe('')
})
