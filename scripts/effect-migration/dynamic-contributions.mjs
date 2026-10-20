import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'dynamic-contributions',
  domain: 'skill',
  parameters: true,
  conditionParameters: true,
  singleAction: true,
  retainedLedgers: ['docs/v4/validation/authoring-api-candidates.json'],
  optionalCondition: true,
  actionTypes: ['addDynamicAttributeModifier'],
  triggers: ['OnMarkCreated'],
  exportName: 'generatedDynamicContributions',
  factory: 'createGeneratedDynamicContributions',
  comment: 'Candidates only; production admission requires lifecycle and full-game evidence.',
}
export const classifyDynamicContributions = original => classifySequence(original, profile)
export const generateDynamicContributions = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateDynamicContributions({ check: process.argv.includes('--check') })))
}
