import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'skill-contributions',
  domain: 'skill',
  parameters: true,
  conditionParameters: true,
  singleAction: true,
  optionalCondition: true,
  actionTypes: ['addSkillAttributeModifier'],
  triggers: ['OnBattleStart', 'OnMarkCreated'],
  exportName: 'generatedSkillContributions',
  factory: 'createGeneratedSkillContributions',
  comment: 'Candidates only; production admission requires lifecycle and full-game evidence.',
}
export const classifySkillContributions = original => classifySequence(original, profile)
export const generateSkillContributions = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateSkillContributions({ check: process.argv.includes('--check') })))
}
