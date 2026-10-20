import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'skill-flags',
  singleAction: true,
  optionalCondition: true,
  domain: 'skill',
  actionTypes: ['setValue'],
  triggers: ['OnBattleStart'],
  retainedLedgers: ['docs/v4/validation/authoring-api-candidates.json'],
  exportName: 'generatedSkillFlags',
  factory: 'createGeneratedSkillFlags',
  comment: 'Skill instance flags; candidates only, not production admission.',
}
export const classifySkillFlag = d => classifySequence(d, profile)
export const generateSkillFlags = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateSkillFlags({ check: process.argv.includes('--check') })))
}
