import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { preparePreviewInputs } from './verify-desktop-pack.mjs'

export const previewNsisPolicy = Object.freeze({
  appId: 'com.arcadia.eternity.preview',
  perMachine: false,
  allowElevation: false,
  createDesktopShortcut: false,
  createStartMenuShortcut: false,
  runAfterFinish: false,
})

/** Builds unsigned, unpublished installable artifacts on their native host.
 * The regular production builder configuration and user data location are not changed. */
export async function packageDesktopInstallers({ webDist, runtime, output }) {
  output = resolve(output)
  await mkdir(output, { recursive: true })
  const prepared = await preparePreviewInputs({ webDist, runtime })
  try {
    const web = resolve(prepared.inputs.webDist ?? fileURLToPath(new URL('../packages/web-ui/dist', import.meta.url)))
    const staged = resolve(runtime ?? fileURLToPath(new URL('../packages/web-ui/dist/arcadia-server', import.meta.url)))
    const digestFile = async file =>
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex')
    const sourceProof = {
      mainSha256: await digestFile(fileURLToPath(new URL('../packages/web-ui/electron/main.mjs', import.meta.url))),
      contentLibrarySha256: await digestFile(
        fileURLToPath(new URL('../packages/web-ui/electron/content-library.mjs', import.meta.url)),
      ),
      rendererIndexSha256: await digestFile(join(web, 'index.html')),
      cliSha256: await digestFile(join(staged, 'cli.js')),
      serverSha256: await digestFile(join(staged, 'node_modules/@arcadia-eternity/server/dist/index.js')),
      runtimeManifestSha256: await digestFile(join(staged, 'arcadia-desktop-runtime.json')),
    }
    const require = createRequire(new URL('../packages/web-ui/package.json', import.meta.url))
    const { build, Platform, Arch } = require('electron-builder')
    const targets = {
      darwin: [Platform.MAC, ['zip']],
      win32: [Platform.WINDOWS, ['nsis', 'zip']],
      linux: [Platform.LINUX, ['AppImage']],
    }[process.platform]
    if (!targets || !['x64', 'arm64'].includes(process.arch)) throw new Error('Unsupported native installer target')
    const config = join(prepared.directory, 'installer-config.mjs')
    const verify = new URL('./verify-desktop-pack.mjs', import.meta.url).href
    const pkg = new URL('../packages/web-ui/package.json', import.meta.url).href
    const nsis = { ...previewNsisPolicy }
    delete nsis.appId
    await writeFile(
      config,
      `import { readFileSync } from 'node:fs'\nimport { previewBuilderConfiguration } from ${JSON.stringify(verify)}\nconst base=JSON.parse(readFileSync(new URL(${JSON.stringify(pkg)}),'utf8')).build\nexport default { ...base, ...previewBuilderConfiguration(${JSON.stringify(prepared.inputs)}), directories:{output:${JSON.stringify(output)}}, artifactName:'Arcadia-Eternity-Preview-\${version}-\${os}-\${arch}.\${ext}', nsis:${JSON.stringify(nsis)}, linux:{...base.linux,category:'Game',target:['AppImage']} }\n`,
      { flag: 'wx' },
    )
    const paths = await build({
      projectDir: fileURLToPath(new URL('../packages/web-ui/', import.meta.url)),
      config,
      targets: targets[0].createTarget(targets[1], Arch[process.arch]),
      publish: 'never',
    })
    const artifacts = []
    for (const path of paths) {
      const format = path.endsWith('.AppImage')
        ? 'appimage'
        : path.endsWith('.exe')
          ? 'nsis'
          : path.endsWith('.zip')
            ? process.platform === 'darwin'
              ? 'mac-zip'
              : 'win-zip'
            : undefined
      if (!format) continue
      const digest = createHash('sha256')
      for await (const chunk of createReadStream(path)) digest.update(chunk)
      const artifact = {
        artifact: resolve(path),
        sha256: digest.digest('hex'),
        format,
        sourceProof,
        ...(format === 'appimage'
          ? {}
          : {
              executableRelativePath:
                process.platform === 'darwin'
                  ? 'Arcadia Eternity Preview.app/Contents/MacOS/Arcadia Eternity Preview'
                  : 'Arcadia Eternity Preview.exe',
            }),
        ...(format === 'nsis' ? { nsisPolicy: previewNsisPolicy } : {}),
      }
      await writeFile(join(output, `${format}.json`), JSON.stringify(artifact, null, 2) + '\n')
      artifacts.push(artifact)
    }
    const expected = { darwin: ['mac-zip'], linux: ['appimage'], win32: ['nsis', 'win-zip'] }[process.platform]
    if (expected.some(format => !artifacts.some(artifact => artifact.format === format)))
      throw new Error(`Missing native installer artifact: ${paths.map(path => basename(path)).join(', ')}`)
    await writeFile(join(output, 'artifacts.json'), JSON.stringify(artifacts, null, 2) + '\n')
    return artifacts
  } finally {
    await prepared.cleanup()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = {}
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = { '--web-dist': 'webDist', '--runtime': 'runtime', '--output': 'output' }[process.argv[i]]
    if (!key || !process.argv[i + 1])
      throw new Error(
        'Usage: package-desktop-installers.mjs --output <directory> [--runtime <staged-directory>] [--web-dist <renderer-directory>]',
      )
    options[key] = process.argv[i + 1]
  }
  if (!options.output) throw new Error('--output is required')
  await packageDesktopInstallers(options)
}
