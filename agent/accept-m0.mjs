/**
 * M0 acceptance — assert the dual-face skeleton. Read-only: writes nothing,
 * so re-running in a row gives the same result.
 *
 * Checks (PASS/FAIL printed per check; exit 0 iff all pass):
 *  1. lib/index.js and lib/client.js both exist and are non-empty.
 *  2. package.json has `main`, `dsh.bundle.patch`, and `dsh.client`.
 *  3. cordis.patch.yml `name` === package.json `name`.
 *  4. GET http://127.0.0.1:3090/api/dsh-memento/health → JSON with
 *     ok === true and milestone ≥ M1 (M0's floor; later builds report M5+).
 *  5. No side effects: two consecutive health requests return identical
 *     payloads, and this script performs no writes (read-only by construction).
 *
 * Run: node agent/accept-m0.mjs   (acceptance server must be up on :3090)
 */
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = 'http://127.0.0.1:3090'
const ROUTE = '/api/dsh-memento/health'

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        let body = null
        try { body = JSON.parse(data) } catch { /* raw */ }
        resolve({ status: res.statusCode, body, raw: data })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

async function nonEmpty(rel) {
  const s = await stat(join(root, rel))
  return s.isFile() && s.size > 0
}

/** Minimal parse of our fixed-format patch file: the row's `name` value. */
function patchName(yaml) {
  const m = yaml.match(/^\s*name:\s*(\S+)\s*$/m)
  return m?.[1]
}

const results = []
async function check(label, fn) {
  try {
    await fn()
    results.push(true)
    console.log(`PASS  ${label}`)
  } catch (err) {
    results.push(false)
    console.log(`FAIL  ${label}\n      ${err.message}`)
  }
}

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

await check('1. lib/index.js and lib/client.js exist, non-empty', async () => {
  assert.equal(await nonEmpty('lib/index.js'), true, 'lib/index.js missing or empty')
  assert.equal(await nonEmpty('lib/client.js'), true, 'lib/client.js missing or empty')
})

await check('2. package.json has main, dsh.bundle.patch, dsh.client', async () => {
  assert.equal(pkg.main, 'lib/index.js', `main is ${JSON.stringify(pkg.main)}`)
  assert.equal(typeof pkg.dsh?.bundle?.patch, 'string', 'dsh.bundle.patch missing')
  assert.ok(pkg.dsh?.client, 'dsh.client missing')
  assert.equal(pkg.dsh.client.platform, 'web', 'dsh.client.platform is not "web"')
})

await check('3. cordis.patch.yml name === package.json name', async () => {
  const yml = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
  assert.equal(patchName(yml), pkg.name, `patch name ${JSON.stringify(patchName(yml))} ≠ ${JSON.stringify(pkg.name)}`)
})

const milestoneNum = (m) => Number(String(m ?? '').replace(/\D/g, ''))
const first = await httpGet(BASE + ROUTE).catch((err) => ({ status: 0, body: null, raw: String(err) }))
await check('4. GET :3090 health → ok=true, milestone≥M1', async () => {
  assert.equal(first.status, 200, `status ${first.status} (raw: ${first.raw.slice(0, 200)})`)
  assert.equal(first.body?.ok, true, `ok=${JSON.stringify(first.body?.ok)} (raw: ${first.raw.slice(0, 200)})`)
  assert.ok(milestoneNum(first.body?.milestone) >= 1,
    `milestone=${JSON.stringify(first.body?.milestone)} (want ≥ M1)`)
})

const second = await httpGet(BASE + ROUTE).catch((err) => ({ status: 0, body: null, raw: String(err) }))
await check('5. idempotent: repeat GET identical (no side effects)', async () => {
  assert.deepEqual(second.body, first.body, 'second response differs from first')
})

if (results.every(Boolean)) {
  console.log('\nM0 ACCEPTANCE PASS')
  process.exit(0)
} else {
  console.log(`\nM0 ACCEPTANCE FAIL (${results.filter((r) => !r).length} check(s) failed)`)
  process.exit(1)
}
