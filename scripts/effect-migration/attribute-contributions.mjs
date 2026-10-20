import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'attribute-contributions',
  domain: 'skill',
  parameters: true,
  conditionParameters: true,
  singleAction: true,
  optionalCondition: true,
  actionTypes: ['addAttributeModifier'],
  triggers: ['OnBattleStart', 'OnMarkCreated'],
  exportName: 'generatedAttributeContributions',
  factory: 'createGeneratedAttributeContributions',
  comment: 'Candidates only; production admission requires lifecycle and full-game evidence.',
}
export const classifyAttributeContributions = original => classifySequence(original, profile)
export const generateAttributeContributions = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateAttributeContributions({ check: process.argv.includes('--check') })))
}
