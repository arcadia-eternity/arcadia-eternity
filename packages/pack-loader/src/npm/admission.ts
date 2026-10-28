import { readFile, stat } from 'node:fs/promises'
import { fail } from '../works/model'

export async function readNpmAdmission(file: string) {
  if ((await stat(file)).size > 8192) fail('NPM_ADMISSION', file, 'Admission record exceeds size limit')
  const record = JSON.parse(await readFile(file, 'utf8'))
  if (
    record?.format !== 'arcadia.npm-admission' ||
    record.version !== 2 ||
    Object.keys(record).some(key => !['format', 'version', 'profile'].includes(key)) ||
    !['local-development', 'self-hosted', 'official'].includes(record.profile)
  )
    fail('NPM_ADMISSION', file, 'Expected an explicit npm project approval')
  return { policy: { profile: record.profile as string } }
}
