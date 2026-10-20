import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'skill-numeric-references',
  domain: 'skill',
  parameters: true,
  conditionParameters: true,
  singleAction: true,
  optionalCondition: true,
  actionTypes: ['addValue'],
  triggers: ['BeforeSort', 'BeforeUseSkillCheck', 'AfterUseSkillCheck'],
  exportName: 'generatedSkillNumericReferences',
  factory: 'createGeneratedSkillNumericReferences',
  comment: 'Candidates only; production admission requires lifecycle and full-game evidence.',
}
export const classifySkillNumericReferences = original => classifySequence(original, profile)
export const generateSkillNumericReferences = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateSkillNumericReferences({ check: process.argv.includes('--check') })))
}
