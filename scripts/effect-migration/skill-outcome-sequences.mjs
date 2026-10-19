import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'skill-outcome-sequences',
  actionTypes: ['addAccuracy', 'addCritRate', 'setSureHit', 'setSureMiss', 'setSureCrit', 'addPower', 'amplifyPower'],
  triggers: ['BeforeUseSkillCheck', 'AfterUseSkillCheck', 'BeforeHit'],
  exportName: 'generatedSkillOutcomeSequences',
  factory: 'createGeneratedSkillOutcomeSequences',
  comment: 'Explicit C07/C09 candidates.',
}
export const classifySkillOutcomeSequence = original => classifySequence(original, profile)
export const generateSkillOutcomeSequences = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateSkillOutcomeSequences({ check: process.argv.includes('--check') })))
}
