import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'skill-disabling',
  domain: 'skill',
  parameters: true,
  conditionParameters: true,
  singleAction: true,
  actionTypes: ['stun'],
  triggers: ['BeforeUseSkillCheck'],
  exportName: 'generatedSkillDisabling',
  factory: 'createGeneratedSkillDisabling',
  comment: 'Candidates only; production admission requires lifecycle and full-game evidence.',
}
export const classifySkillDisabling = original => classifySequence(original, profile)
export const generateSkillDisabling = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateSkillDisabling({ check: process.argv.includes('--check') })))
}
