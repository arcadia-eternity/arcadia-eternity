import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectDesktopLicenses } from './desktop-runtime-licenses.mjs'

const mit = `The MIT License (MIT)
Copyright (c) 2026 Sample Author
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`
const bsd = `Copyright (c) 2026 Sample Author
Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE.`

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-license-test-'))
  const runtime = join(root, 'runtime')
  await mkdir(runtime)
  const repositoryLicense = join(root, 'project-license')
  const electronLicense = join(root, 'electron-license')
  const electronNotices = join(root, 'electron-notices')
  await writeFile(
    repositoryLicense,
    'Mozilla Public License Version 2.0\n2.1. Grants\nDisclaimer of Warranty\n10. Versions of the License\n' +
      'project license text\n'.repeat(700),
  )
  await writeFile(electronLicense, 'Electron MIT license\n' + 'license text\n'.repeat(10))
  await writeFile(electronNotices, 'Chromium third-party notices\n' + 'notice text\n'.repeat(10))
  async function pkg(path, name, license, files = {}, extra = {}) {
    const dir = join(runtime, path)
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name, version: '1.0.0', ...(license ? { license } : {}), ...extra }),
    )
    for (const [file, text] of Object.entries(files)) await writeFile(join(dir, file), text)
    return dir
  }
  return { root, runtime, pkg, options: { repositoryLicense, electronLicense, electronNotices } }
}

test('inventories physical dependencies and bundled npm licenses, deduplicates bytes, and reports declarations without text', async () => {
  const f = await fixture()
  try {
    await f.pkg('node_modules/.pnpm/a/node_modules/a', 'a', 'MIT', { LICENSE: mit })
    await f.pkg('node_modules/.pnpm/b/node_modules/b', 'b', 'MIT', { 'LICENSE.md': mit })
    await f.pkg('node_modules/.pnpm/c/node_modules/c', 'c', 'BSD-2-Clause', { 'README.md': `# C\n${bsd}` })
    await f.pkg('node_modules/.pnpm/d/node_modules/d', 'd', 'MIT', { 'README.md': 'Licensed under MIT.' })
    await f.pkg('node_modules/.pnpm/e/node_modules/e', 'e', 'MIT', {
      LICENSE:
        'SPDX-License-Identifier: MIT. See the external link for complete terms.\n' +
        'This is not the license text.\n'.repeat(5),
    })
    await f.pkg('node_modules/.pnpm/placeholder/node_modules/placeholder', 'placeholder', 'MIT', {
      LICENSE: mit.replace('2026 Sample Author', '<year> <copyright holder>'),
    })
    await f.pkg('node_modules/.pnpm/unattributed/node_modules/unattributed', 'unattributed', 'MIT', {
      LICENSE: mit.replace('Copyright (c) 2026 Sample Author\n', ''),
    })
    await f.pkg(
      'node_modules/.pnpm/dual/node_modules/dual',
      'dual',
      'MIT OR Apache-2.0',
      { LICENSE: mit },
      {
        repository: { url: 'git+https://example.test/owner/project.git?secret=hidden#ref' },
      },
    )
    await f.pkg('node_modules/.pnpm/combined/node_modules/combined', 'combined', 'MIT AND Apache-2.0', {
      LICENSE: mit,
    })
    await f.pkg('node_modules/@arcadia-eternity/mismatch', '@arcadia-eternity/mismatch', 'MIT')
    await f.pkg('node_modules/@arcadia-eternity/mpl-mismatch', '@arcadia-eternity/mpl-mismatch', 'MIT', {
      LICENSE: await readFile(f.options.repositoryLicense),
    })
    await f.pkg('node_modules/@arcadia-eternity/base', '@arcadia-eternity/base', undefined)
    await f.pkg('node_modules/@arcadia-eternity/mpl', '@arcadia-eternity/mpl', 'MPL-2.0')
    await f.pkg('node_modules/.pnpm/mismatch/node_modules/mismatch', 'mismatch', 'MIT', { LICENSE: bsd })
    await f.pkg('runtime/npm', 'npm', 'Artistic-2.0', {
      LICENSE:
        'The Artistic License 2.0\nPermissions for Redistribution of the Standard Version\nPatent License\nDisclaimer of Warranty\n' +
        'terms\n'.repeat(1200),
    })
    await f.pkg('runtime/npm/node_modules/dependency', 'npm-dependency', 'MIT', { LICENSE: mit })
    const result = await collectDesktopLicenses(f.runtime, f.options)
    assert.deepEqual(
      result.missing.map(record => record.name),
      [
        '@arcadia-eternity/base',
        '@arcadia-eternity/mismatch',
        '@arcadia-eternity/mpl-mismatch',
        'combined',
        'd',
        'e',
        'mismatch',
        'placeholder',
        'unattributed',
      ],
    )
    assert.equal(result.packages.length, 16)
    assert.equal(result.electron.length, 2)
    const a = result.packages.find(record => record.name === 'a')
    const b = result.packages.find(record => record.name === 'b')
    const bundled = result.packages.find(record => record.name === 'npm-dependency')
    assert.equal(a.files[0].sha256, b.files[0].sha256)
    assert.equal(a.files[0].path, bundled.files[0].path)
    assert.equal(await readFile(join(f.runtime, a.files[0].path), 'utf8'), mit)
    assert.equal(result.packages.find(record => record.name === 'c').files[0].source.endsWith('README.md'), true)
    assert.equal(
      result.packages.find(record => record.name === 'dual').repository,
      'https://example.test/owner/project.git',
    )
    assert.equal(
      result.packages.find(record => record.name === '@arcadia-eternity/mpl').files[0].source,
      'repository:LICENSE',
    )
    assert.equal(
      result.missing.find(record => record.name === 'mismatch').reason,
      'unmatched-or-unsupported-declaration',
    )
    assert.equal(
      result.missing.find(record => record.name === '@arcadia-eternity/mpl-mismatch').reason,
      'unmatched-or-unsupported-declaration',
    )
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('rejects package license symlinks and escaping package stores', async () => {
  const f = await fixture()
  try {
    const dir = await f.pkg('runtime/npm', 'npm', 'MIT')
    await symlink(f.options.repositoryLicense, join(dir, 'LICENSE'))
    await assert.rejects(collectDesktopLicenses(f.runtime, f.options), /Unsafe linked license/)
    await rm(join(f.runtime, 'licenses'), { recursive: true })
    await rm(join(dir, 'LICENSE'))
    await mkdir(join(f.runtime, 'node_modules'), { recursive: true })
    await symlink(f.root, join(f.runtime, 'node_modules', '.pnpm'), 'dir')
    await assert.rejects(collectDesktopLicenses(f.runtime, f.options), /Package store escapes runtime/)
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('matches the complete pinned SPDX terms, while preserving conflicts and changed terms for review', async () => {
  const f = await fixture()
  try {
    const mit0 = (await readFile(new URL('./desktop-license-reference/MIT-0.txt', import.meta.url), 'utf8'))
      .replace('MIT No Attribution', 'MIT No Attribution (MIT-0)')
      .replace('Copyright <YEAR> <COPYRIGHT HOLDER>', 'Copyright © CSSTools Contributors')
    const bsd3 = (
      await readFile(new URL('./desktop-license-reference/BSD-3-Clause.txt', import.meta.url), 'utf8')
    ).replace(
      'Copyright (c) <year> <owner>.',
      'BSD 3-Clause License\nCopyright (c) 2014, Nathan LaFreniere and other contributors\nAll rights reserved.',
    )
    const blueOak = await readFile(new URL('./desktop-license-reference/BlueOak-1.0.0.txt', import.meta.url), 'utf8')
    const packages = [
      ['mit0', 'MIT-0', mit0],
      ['bsd3', 'BSD-3-Clause', bsd3],
      ['blueoak', 'BlueOak-1.0.0', blueOak.replace('***As far', '**_As far').replace('claim.***', 'claim._**')],
      [
        'nodemailer-variant',
        'MIT-0',
        mit0.replace('furnished to do so.', 'furnished to do so, subject to the following conditions:'),
      ],
      ['mit0-extra', 'MIT-0', `${mit0}\nAdditional restrictions apply.`],
      ['mit0-wrong-declaration', 'MIT', mit0],
      [
        'mit0-placeholder',
        'MIT-0',
        mit0.replace('Copyright © CSSTools Contributors', 'Copyright <YEAR> <COPYRIGHT HOLDER>'),
      ],
      ['bsd3-altered', 'BSD-3-Clause', bsd3.replace('name of the copyright holder', 'name of the ESQuery')],
      ['bsd2-extra-clause', 'BSD-2-Clause', bsd3],
      [
        'blueoak-altered',
        'BlueOak-1.0.0',
        blueOak.replace('without any warranty or condition', 'with any warranty or condition'),
      ],
    ]
    for (const [name, license, contents] of packages)
      await f.pkg(`node_modules/.pnpm/${name}/node_modules/${name}`, name, license, { LICENSE: contents })
    await f.pkg('runtime/npm', 'npm', 'MIT', { LICENSE: mit })
    const result = await collectDesktopLicenses(f.runtime, f.options)
    assert.deepEqual(
      result.missing.map(record => record.name),
      [
        'blueoak-altered',
        'bsd2-extra-clause',
        'bsd3-altered',
        'mit0-extra',
        'mit0-placeholder',
        'mit0-wrong-declaration',
        'nodemailer-variant',
      ],
    )
    for (const [name, license] of packages.slice(0, 3)) {
      const record = result.packages.find(item => item.name === name)
      assert.deepEqual(record.recognizedLicenses, [license])
      assert.equal(
        await readFile(join(f.runtime, record.files[0].path), 'utf8'),
        packages.find(item => item[0] === name)[2],
      )
    }
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('recognizes exact reviewed package notices without accepting changed bytes or different package identities', async () => {
  const f = await fixture()
  try {
    const fixtures = [
      ['balanced-match', '4.0.4', 'MIT', 'balanced-match-4.0.4.txt'],
      ['pngjs', '7.0.0', 'MIT', 'pngjs-7.0.0.txt'],
      ['diff', '8.0.4', 'BSD-3-Clause', 'diff-8.0.4.txt'],
      ['esquery', '1.7.0', 'BSD-3-Clause', 'esquery-1.7.0.txt'],
      ['istanbul-lib-coverage', '3.2.2', 'BSD-3-Clause', 'istanbul-licenses.txt'],
      ['istanbul-lib-report', '3.0.1', 'BSD-3-Clause', 'istanbul-licenses.txt'],
      ['istanbul-reports', '3.2.0', 'BSD-3-Clause', 'istanbul-licenses.txt'],
      ['source-map-js', '1.2.2', 'BSD-3-Clause', 'source-map-js-1.2.2.txt'],
      ['tough-cookie', '5.1.2', 'BSD-3-Clause', 'tough-cookie-5.1.2.txt'],
    ]
    for (const [name, version, license, file] of fixtures) {
      const contents = await readFile(new URL(`./desktop-license-reference/packages/${file}`, import.meta.url))
      await f.pkg(`node_modules/.pnpm/${name}/node_modules/${name}`, name, license, { LICENSE: contents }, { version })
    }
    const balanced = await readFile(
      new URL('./desktop-license-reference/packages/balanced-match-4.0.4.txt', import.meta.url),
    )
    await f.pkg(
      'node_modules/.pnpm/other/node_modules/other',
      'other',
      'MIT',
      { LICENSE: balanced },
      { version: '4.0.4' },
    )
    await f.pkg(
      'node_modules/.pnpm/newer/node_modules/newer',
      'balanced-match',
      'MIT',
      { LICENSE: balanced },
      { version: '4.0.5' },
    )
    await f.pkg(
      'node_modules/.pnpm/changed/node_modules/changed',
      'balanced-match',
      'MIT',
      {
        LICENSE: Buffer.concat([balanced, Buffer.from('\nAdditional restrictions apply.\n')]),
      },
      { version: '4.0.4' },
    )
    await f.pkg(
      'node_modules/.pnpm/wrong/node_modules/wrong',
      'balanced-match',
      'BSD-3-Clause',
      { LICENSE: balanced },
      { version: '4.0.4' },
    )
    await f.pkg(
      'node_modules/.pnpm/notice/node_modules/notice',
      'balanced-match',
      'MIT',
      { NOTICE: balanced },
      { version: '4.0.4' },
    )
    await f.pkg('runtime/npm', 'npm', 'MIT', { LICENSE: mit })
    const result = await collectDesktopLicenses(f.runtime, f.options)
    for (const [name, version, license] of fixtures) {
      const record = result.packages.find(
        item => item.packagePath === `node_modules/.pnpm/${name}/node_modules/${name}`,
      )
      assert.equal(record.version, version)
      assert.deepEqual(record.recognizedLicenses, [license])
      assert.deepEqual(
        await readFile(join(f.runtime, record.files[0].path)),
        await readFile(
          new URL(
            `./desktop-license-reference/packages/${fixtures.find(item => item[0] === name)[3]}`,
            import.meta.url,
          ),
        ),
      )
      assert.equal(
        result.missing.some(item => item.packagePath === record.packagePath),
        false,
      )
    }
    for (const name of ['other', 'newer', 'changed', 'wrong', 'notice'])
      assert.equal(
        result.missing.some(item => item.packagePath === `node_modules/.pnpm/${name}/node_modules/${name}`),
        true,
      )
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})
