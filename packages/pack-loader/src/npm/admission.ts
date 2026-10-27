import { readFile, stat } from 'node:fs/promises'
import { fail } from '../works/model'

export async function readNpmAdmission(file: string) {
  if ((await stat(file)).size > 8192) fail('NPM_ADMISSION', file, 'Admission record exceeds size limit')
  const record = JSON.parse(await readFile(file, 'utf8'))
  if (
    record?.format !== 'arcadia.npm-admission' ||
    record.version !== 1 ||
    !['local-development', 'self-hosted', 'official'].includes(record.profile) ||
    typeof record.installationDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.installationDigest)
  )
    fail('NPM_ADMISSION', file, 'Expected an explicit npm installation approval')
  return { installationDigest: record.installationDigest as string, policy: { profile: record.profile as string } }
}
