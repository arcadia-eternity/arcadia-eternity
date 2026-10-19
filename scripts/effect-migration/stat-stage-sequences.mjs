import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'stat-stage-sequences',
  actionTypes: ['statStageBuff'],
  triggers: ['BeforeHit', 'OnDamage'],
  exportName: 'generatedStatStageSequences',
  factory: 'createGeneratedStatStageSequences',
  comment: 'Candidates only.',
}
export const classifyStatStageSequence = original => classifySequence(original, profile)
export const generateStatStageSequences = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateStatStageSequences({ check: process.argv.includes('--check') })))
}
