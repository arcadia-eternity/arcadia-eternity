import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'multihit',
  singleAction: true,
  actionTypes: ['addMultihitResult', 'setMultihit'],
  triggers: ['BeforeMultiHit', 'AfterUseSkillCheck'],
  parameters: true,
  conditionParameters: true,
  orderConditions: Object.fromEntries(
    [
      ['effect_skill_multihit_4_if_first', 'isFirstSkillUsedThisTurn'],
      ['effect_skill_multihit_4_if_last', 'isLastSkillUsedThisTurn'],
      ['effect_skill_multihit_4_times_if_last', 'isLastSkillUsedThisTurn'],
    ].map(([id, condition]) => [id, [{ path: '/condition/conditions/1', condition }]]),
  ),
  exportName: 'generatedMultihit',
  factory: 'createGeneratedMultihit',
  comment: 'Candidates only; production admission requires lifecycle and full-game evidence.',
}
export const classifyMultihit = original => classifySequence(original, profile)
export const generateMultihit = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateMultihit({ check: process.argv.includes('--check') })))
}
