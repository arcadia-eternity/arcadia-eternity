import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'compound-actions',
  optionalCondition: true,
  actionTypes: [
    'addMark',
    'addSkillAttributeModifier',
    'consumeStacks',
    'addMultihitResult',
    'setMultihit',
    'addValue',
    'transferMark',
    'disableContext',
  ],
  markDependencies: true,
  conditionParameters: true,
  dependenciesExport: 'generatedCompoundActionDependencies',
  triggers: [
    'OnHit',
    'OnMiss',
    'OnDamage',
    'PostDamage',
    'TurnEnd',
    'OnMarkCreated',
    'OnStack',
    'BeforeMultiHit',
    'AfterUseSkillCheck',
    'BeforeSort',
  ],
  damageTriggers: ['OnDamage', 'PostDamage'],
  parameters: true,
  retainedLedgers: [
    'authoring-api',
    'damage-sequences',
    'skill-outcome-sequences',
    'stat-stage-sequences',
    'vital-sequences',
  ].map(name => `docs/v4/validation/${name}-candidates.json`),
  exportName: 'generatedCompoundActions',
  factory: 'createGeneratedCompoundActions',
  comment: 'Candidates only; production admission requires lifecycle and full-game evidence.',
}
export const classifyCompoundActions = original => classifySequence(original, profile)
export const generateCompoundActions = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateCompoundActions({ check: process.argv.includes('--check') })))
}
