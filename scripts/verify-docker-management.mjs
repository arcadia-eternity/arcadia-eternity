import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

// Requires an already-built local image. All resources belong to this invocation;
// no image publication, production credentials or external listeners are used.
const execute = promisify(execFile)
const image = process.argv[2] ?? 'arcadia-management-validation:local'
const output = resolve(process.argv[3] ?? '.omo/evidence/docker-management.json')
const prefix = `arcadia-validation-${randomUUID().slice(0, 12)}`
const resources = { containers: [], volumes: [], networks: [] }
const evidence = { image, platform: process.platform, startedAt: new Date().toISOString(), cases: [], passed: false }

async function docker(args, options = {}) {
  try {
    return (await execute('docker', args, { timeout: 60_000, maxBuffer: 8 * 1024 * 1024, ...options })).stdout.trim()
  } catch (error) {
    // Avoid including command arguments: an isolated database password is among them.
    throw new Error(`docker ${args[0]} failed: ${error.stderr || error.code || 'unknown error'}`)
  }
}
async function until(check, description, timeout = 90_000) {
  const deadline = Date.now() + timeout
  let lastError
  do {
    try {
      const result = await check()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  } while (Date.now() < deadline)
  throw new Error(`Timed out waiting for ${description}`, { cause: lastError })
}
async function volume(suffix) {
  const name = `${prefix}-${suffix}`
  await docker(['volume', 'create', name])
  resources.volumes.push(name)
  return name
}
async function inside(name, source) {
  return JSON.parse(await docker(['exec', name, 'node', '--input-type=module', '-e', source]))
}
async function authenticateAndCheck(name, serverId, phase) {
  const issued = JSON.parse(await docker(['exec', name, 'node', 'dist/cli.js', 'server', 'admin', 'login-code']))
  assert.equal(issued.serverId, serverId)
  const result = await inside(
    name,
    `
    import assert from 'node:assert/strict';
    const origin = 'http://127.0.0.1:8102';
    const base = origin + '/api/management/v1';
    const code = ${JSON.stringify(issued.code)};
    const id = ${JSON.stringify(serverId)};
    const phase = ${JSON.stringify(phase)};
    assert.equal((await fetch(base + '/servers')).status, 401);
    const exchange = () => fetch(base + '/session/bootstrap', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code})
    });
    const login = await exchange();
    assert.equal(login.status, 200);
    const session = await login.json();
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal((await exchange()).status, 401);
    const headers = {'Content-Type':'application/json', Origin:'http://localhost',
      Cookie:cookie.split(';')[0], 'X-CSRF-Token':session.csrfToken};
    const response = await fetch(base + '/servers', {headers});
    assert.equal(response.status, 200);
    let server = (await response.json()).servers[0];
    assert.equal(server.id, id);
    assert.equal(typeof server.defaultBindingId,'string');
    assert.ok(server.defaultBindingId.length > 0,'Fresh servers must publish a default environment');
    const bindingsResponse = await fetch(base + '/servers/' + encodeURIComponent(id) + '/bindings',{headers});
    assert.equal(bindingsResponse.status,200);
    const bindings = (await bindingsResponse.json()).bindings;
    assert.equal(bindings.length,1,'Fresh initialization must create exactly one binding');
    const binding = bindings.find(item => item.id === server.defaultBindingId);
    assert.ok(binding,'The default must reference the durable builtin binding');
    assert.equal(binding.environmentId,'builtin-server');
    assert.equal(binding.enabled,true);
    assert.equal(binding.visibility,'public');
    assert.equal(binding.matchmakingEnabled,true);
    assert.equal(binding.condition,'available');
    assert.equal(typeof binding.effectiveVersionId,'string');
    assert.equal(binding.desiredVersionId,binding.effectiveVersionId);
    const catalogResponse = await fetch(origin + '/api/v1/environments');
    assert.equal(catalogResponse.status,200);
    const catalog = await catalogResponse.json();
    assert.equal(catalog.protocolVersion,1);
    assert.equal(catalog.environments.length,1,'Fresh public catalog must contain the builtin environment');
    const builtin = catalog.environments[0];
    assert.deepEqual(builtin.packages,[]);
    assert.equal(builtin.runtime.kind,'native-v4');
    const contentResponse = await fetch(origin + '/api/v1/environments/' + encodeURIComponent(builtin.id) + '/content');
    assert.equal(contentResponse.status,200);
    const content = await contentResponse.json();
    assert.ok(content.species.length > 0,'The published builtin must expose actual playable content');
    if (phase === 'initial') {
      const withoutCsrf = {...headers}; delete withoutCsrf['X-CSRF-Token'];
      assert.equal((await fetch(base + '/servers/' + encodeURIComponent(id), {
        method:'PATCH', headers:{...withoutCsrf, 'If-Match':String(server.revision)},
        body:JSON.stringify({name:'should-not-save'})
      })).status, 403);
      const saved = await fetch(base + '/servers/' + encodeURIComponent(id), {
        method:'PATCH', headers:{...headers, 'If-Match':String(server.revision)},
        body:JSON.stringify({name:'Container persistence proof',
          settings:{battleCapacity:{maxConcurrentBattles:8,maxIdleWorkers:2}}})
      });
      assert.equal(saved.status,200);
      server = await saved.json();
      assert.equal(server.requiresRestart,true);
    } else {
      assert.equal(server.name,'Container persistence proof');
      assert.equal(server.runtimeSettings.battleCapacity.maxConcurrentBattles,8);
      assert.equal(server.runtimeSettings.battleCapacity.maxIdleWorkers,2);
      assert.equal(server.requiresRestart,false);
    }
    const workspaces = await fetch(base + '/workspaces', {headers});
    assert.equal(workspaces.status,200);
    const workspaceId = (await workspaces.json()).workspaces[0].id;
    assert.equal(binding.workspaceId,workspaceId);
    const environmentsResponse = await fetch(base + '/workspaces/' + encodeURIComponent(workspaceId) + '/environments',{headers});
    assert.equal(environmentsResponse.status,200);
    const environments = await environmentsResponse.json();
    const version = environments.versions.find(item => item.versionId === binding.effectiveVersionId);
    assert.ok(version,'The effective builtin version must remain in the shared workspace');
    assert.equal(version.status,'ready');
    assert.equal(version.environmentId,binding.environmentId);
    assert.deepEqual(version.document.packages,{});
    console.log(JSON.stringify({serverId:id,workspaceId,revision:server.revision,
      requiresRestart:server.requiresRestart,defaultBindingId:server.defaultBindingId,
      environmentId:binding.environmentId,versionId:binding.effectiveVersionId,
      catalogEnvironmentId:builtin.id,runtime:builtin.runtime,
      resourceRevision:builtin.resourceRevision,builtinSpeciesCount:content.species.length}));
  `,
  )
  return result
}
async function runCase(driver, postgresHost) {
  const name = `${prefix}-${driver}`
  const state = await volume(`${driver}-state`)
  const serverId = `${prefix}-${driver}`
  const args = [
    'run',
    '-d',
    '--name',
    name,
    '--network',
    prefix,
    '-p',
    '127.0.0.1::8102',
    '-v',
    `${state}:/app/state`,
    '-e',
    'ACCOUNT_MODE=guest',
    '-e',
    `STORAGE_DRIVER=${driver}`,
    '-e',
    `SERVER_ID=${serverId}`,
    '-e',
    'CORS_ORIGIN=http://localhost',
  ]
  if (postgresHost) args.push('-e', `DATABASE_URL=${postgresHost}`)
  args.push(image)
  const start = async () => {
    if (!resources.containers.includes(name)) resources.containers.push(name)
    await docker(args)
    const mapped = await docker(['port', name, '8102/tcp'])
    assert.match(mapped, /^127\.0\.0\.1:\d+$/)
    const origin = `http://${mapped}`
    await until(async () => (await fetch(origin + '/health')).ok, `${driver} server`)
    return origin
  }
  const origin = await start()
  if (driver === 'sqlite') {
    evidence.runtime = await inside(
      name,
      `
      import {createRequire} from 'node:module';
      import {execFileSync} from 'node:child_process';
      const require = createRequire('/app/packages/database/package.json');
      const Database = require('better-sqlite3');
      const database = new Database(':memory:');
      const sqliteVersion = database.prepare('select sqlite_version() as version').get().version;
      database.close();
      console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,
        sqliteVersion,git:execFileSync('git',['--version'],{encoding:'utf8'}).trim(),
        npm:execFileSync('npm',['--version'],{encoding:'utf8'}).trim()}));
    `,
    )
  }
  const page = await fetch(origin + '/management')
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-type'), /text\/html/)
  const html = await page.text()
  const assets = [...html.matchAll(/(?:src|href)="([^"\s]+\.(?:js|css))"/g)].map(match => match[1])
  assert.ok(assets.length > 0, 'The paired site must contain built script/style assets')
  for (const asset of assets) {
    const response = await fetch(new URL(asset, origin))
    assert.equal(response.status, 200, `Missing paired asset ${asset}`)
    assert.doesNotMatch(response.headers.get('content-type') ?? '', /text\/html/)
  }
  const manifest = await (await fetch(origin + '/arcadia-web-manifest.json')).json()
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.protocolVersion, 1)
  assert.equal(
    (await fetch(origin + '/api/management/v1/servers')).status,
    403,
    'Plain HTTP from the Docker bridge must not bypass the remote TLS boundary',
  )
  const before = await authenticateAndCheck(name, serverId, 'initial')
  await docker(['stop', '--time', '15', name])
  await docker(['rm', name])
  if (postgresHost) {
    await docker(['restart', `${prefix}-postgres-database`])
    await until(async () => {
      await docker([
        'exec',
        `${prefix}-postgres-database`,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'arcadia',
        '-d',
        'arcadia_validation',
      ])
      return true
    }, 'restarted PostgreSQL')
  }
  await start()
  const after = await authenticateAndCheck(name, serverId, 'recreated')
  assert.equal(after.workspaceId, before.workspaceId)
  assert.equal(after.revision, before.revision)
  assert.equal(after.defaultBindingId, before.defaultBindingId)
  assert.equal(after.environmentId, before.environmentId)
  assert.equal(after.versionId, before.versionId)
  assert.deepEqual(after.runtime, before.runtime)
  assert.equal(after.resourceRevision, before.resourceRevision)
  assert.equal(after.builtinSpeciesCount, before.builtinSpeciesCount)
  evidence.cases.push({
    driver,
    pairedAssets: assets.length,
    before,
    after,
    containerRecreated: true,
    databaseRestarted: !!postgresHost,
  })
}

try {
  evidence.dockerVersion = await docker(['info', '--format', '{{.ServerVersion}}'])
  evidence.imageIdentity = JSON.parse(await docker(['image', 'inspect', '--format', '{{json .}}', image]))
  evidence.imageIdentity = {
    id: evidence.imageIdentity.Id,
    architecture: evidence.imageIdentity.Architecture,
    os: evidence.imageIdentity.Os,
  }
  await docker(['network', 'create', prefix])
  resources.networks.push(prefix)
  await runCase('sqlite')
  const pgName = `${prefix}-postgres-database`
  const pgPassword = randomUUID()
  const pgVolume = await volume('postgres-data')
  await docker(
    [
      'run',
      '-d',
      '--name',
      pgName,
      '--network',
      prefix,
      '-v',
      `${pgVolume}:/var/lib/postgresql/data`,
      '-e',
      'POSTGRES_USER=arcadia',
      '-e',
      `POSTGRES_PASSWORD=${pgPassword}`,
      '-e',
      'POSTGRES_DB=arcadia_validation',
      'postgres:17-alpine',
    ],
    { timeout: 300_000 },
  )
  resources.containers.push(pgName)
  await until(async () => {
    await docker(['exec', pgName, 'pg_isready', '-h', '127.0.0.1', '-U', 'arcadia', '-d', 'arcadia_validation'])
    return true
  }, 'PostgreSQL')
  await runCase('postgres', `postgresql://arcadia:${pgPassword}@${pgName}:5432/arcadia_validation`)
  evidence.passed = true
  console.log('Docker SQLite and PostgreSQL persistence scenarios passed.')
} catch (error) {
  evidence.failure = error.message
  for (const name of resources.containers) {
    try {
      evidence[`${name}-logs`] = await docker(['logs', '--tail', '100', name])
    } catch {
      /* Removed container. */
    }
  }
  process.exitCode = 1
  console.error(error.message)
} finally {
  for (const name of resources.containers.reverse()) await docker(['rm', '-f', name]).catch(() => {})
  for (const name of resources.volumes.reverse()) await docker(['volume', 'rm', name]).catch(() => {})
  for (const name of resources.networks.reverse()) await docker(['network', 'rm', name]).catch(() => {})
  evidence.finishedAt = new Date().toISOString()
  await mkdir(resolve(output, '..'), { recursive: true })
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n')
}
