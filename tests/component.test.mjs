import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { platforms } from '../src/protocol.js'
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = process.env.NONS_ROOT ? resolve(process.env.NONS_ROOT) : resolve(project, '../..')
const tools = resolve(root, 'packages/wasm-crypto/node_modules/@bytecodealliance')
const output = resolve(root, '.local/gdstudio-component-tests')
await mkdir(output, { recursive: true })
const result = spawnSync(
  process.execPath,
  [
    resolve(tools, 'jco/dist/jco.js'),
    'transpile',
    resolve(project, 'dist/adapter.component.wasm'),
    '-o',
    output,
    '--instantiation',
    'async'
  ],
  { encoding: 'utf8' }
)
assert.equal(result.status, 0, result.stderr)
const { instantiate } = await import(pathToFileURL(resolve(output, 'adapter.component.js')).href)
const { WASIShim } = await import(
  pathToFileURL(resolve(tools, 'preview2-shim/dist/common/instantiation.js')).href
)
const sample = new Uint8Array(65536)
for (let i = 0; i + 1044 < sample.length; i += 1044) sample.set([255, 251, 224, 0], i)
const size = Math.floor((180 * 44100) / 1152) * 1044
const request = {
  track: { reference: { source: 'netease', kind: 'track', id: '347230' }, durationMs: 180000 },
  preferredQuality: 'exhigh',
  allowDowngrade: false
}
let mode = 'full'
const origin = 'https://cover.example:9443/sample.mp3?token=public'
const redirected = 'https://cdn.example:9555/final.mp3?token=final#fragment'
const large = `https://cover.example:9443/${'a'.repeat(70000)}.mp3?token=public#fragment`
const requests = []
const diagnostics = []
let apiBytes = 0
const reply = (value, status, headers, body, url = value.url) => ({
  status,
  headers,
  body,
  url
})
const transport = new Proxy(
  {
    httpRequest(value) {
      requests.push(value)
      assert.equal(value.followRedirects, true)
      assert.equal(Object.hasOwn(value, 'concurrency'), false)
      assert.equal(value.method, 'GET')
      assert.equal(value.body.length, 0)
      assert.equal(value.timeoutMs, 0)
      if (value.url.endsWith('/time'))
        return reply(value, 200, [], Buffer.from('1792158848'.padEnd(2048)))
      if (value.url.includes('music.gdstudio.org/api.php')) {
        const body = Buffer.from(
          JSON.stringify({
            code: 0,
            url:
              mode === 'private'
                ? 'https://user:pass@127.0.0.1:8443/secret#fragment'
                : mode === 'ip'
                  ? 'http://[::1]:8080/ip.mp3#fragment'
                  : mode === 'ftp'
                    ? 'ftp://files.example/song.mp3'
                    : mode === 'large'
                      ? large
                      : origin,
            ...(mode === 'large' ? { padding: 'x'.repeat(70000) } : {})
          })
        )
        if (mode === 'large') apiBytes = body.length
        return reply(
          value,
          mode === 'offline' ? 503 : mode === 'unauthorized' ? 401 : 200,
          [],
          body
        )
      }
      assert(
        !value.headers.some((h) =>
          ['referer', 'origin', 'cookie', 'x-requested-with'].includes(h.name.toLowerCase())
        ),
        'Website headers never reach the audio CDN'
      )
      if (mode === 'redirect' && value.url === origin)
        return reply(
          value,
          206,
          [{ name: 'content-range', value: `bytes 0-65535/${size}` }],
          sample,
          redirected
        )
      if (mode === 'badFinal')
        return reply(
          value,
          206,
          [{ name: 'content-range', value: `bytes 0-65535/${size}` }],
          sample,
          'ftp://cdn.example/final.mp3'
        )
      const rangeHeader = value.headers.find((h) => h.name.toLowerCase() === 'range')?.value
      if (rangeHeader && rangeHeader !== 'bytes=0-65535') {
        const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader)
        const start = Number(match[1])
        const end = Math.min(Number(match[2]), size - 1)
        return reply(
          value,
          206,
          [{ name: 'content-range', value: `bytes ${start}-${end}/${size}` }],
          new Uint8Array(end - start + 1)
        )
      }
      if (value.headers.some((h) => h.value === 'bytes=-512'))
        return reply(
          value,
          206,
          [{ name: 'content-range', value: `bytes ${size - 512}-${size - 1}/${size}` }],
          new Uint8Array(512)
        )
      return reply(
        value,
        206,
        [
          {
            name: 'content-range',
            value: `bytes 0-65535/${mode === 'preview' ? Math.floor(size / 6) : size}`
          }
        ],
        sample
      )
    }
  },
  {
    get(target, key) {
      return (
        target[key] ??
        (() => {
          throw new Error(`Unexpected Host capability: ${String(key)}`)
        })
      )
    }
  }
)
const instance = await instantiate(
  async (path) => WebAssembly.compile(await readFile(resolve(output, path))),
  {
    ...new WASIShim().getImportObject(),
    'nons:host/transport': transport,
    'nons:plugin/host': {
      call(_operation, args) {
        diagnostics.push(JSON.parse(args))
        return 'null'
      }
    }
  }
)
instance.initialize()
const call = (method, args = 'null') =>
  JSON.parse(instance.call(method, typeof args === 'string' ? args : JSON.stringify(args)))
test('manifest and package use contract 2 without legacy network fields', async () => {
  const manifest = JSON.parse(await readFile(resolve(project, 'manifest.json'), 'utf8'))
  const packageJson = JSON.parse(await readFile(resolve(project, 'package.json'), 'utf8'))
  assert.equal(manifest.version, '1.0.0')
  assert.equal(packageJson.version, '1.0.0')
  assert.equal(manifest.resourceProvider.contractVersion, 2)
  assert.equal(manifest.permissions.http, true)
  assert.equal(Object.hasOwn(manifest.resourceProvider, 'coverHosts'), false)
  assert.equal(Object.hasOwn(manifest.permissions, 'httpHosts'), false)
  assert.equal(Object.hasOwn(manifest.permissions, 'websocketHosts'), false)
})
test('resource-only Component declares ten playback platforms and rejects search without HTTP', () => {
  const descriptor = call('music.resource-descriptor')
  assert.equal(descriptor.status, 'ok')
  assert.equal(descriptor.data.contractVersion, 2)
  assert.deepEqual(descriptor.data.platforms, Object.keys(platforms))
  assert.deepEqual(descriptor.data.searchPlatforms, [])
  assert.equal(Object.hasOwn(descriptor.data, 'coverHosts'), false)
  requests.length = 0
  for (const platform of Object.keys(platforms)) {
    const result = call('music.search-resources', {
      request: { platform, keyword: 'Song', page: { cursor: null, limit: 50 } }
    })
    assert.equal(result.status, 'error')
    assert.equal(result.data.code, 'unsupported')
  }
  assert.equal(requests.length, 0)
})
test('real Component resolves normally and isolates API headers', () => {
  mode = 'full'
  requests.length = 0
  const response = call('music.resolve-resource', { request })
  assert.equal(
    response.status,
    'ok',
    JSON.stringify({ response, diagnostics, requests: requests.length })
  )
  assert.equal(response.data.metadata.actualQuality, '320k')
  assert.equal(response.data.metadata.extent.kind, 'full')
  assert(requests.length >= 3)
  assert.equal(requests.filter((value) => value.url.endsWith('/time')).length, 1)
  assert(requests.every((value) => value.timeoutMs === 0))
  assert.deepEqual(response.data.headers, [])
  assert.match(response.data.url, /^https:\/\/cover\.example:9443\/sample\.mp3\?token=public$/)
  const api = requests.find((value) => value.url.includes('api.php'))
  assert.ok(api.headers.some((header) => header.name === 'X-Requested-With'))
  assert.ok(api.headers.some((header) => header.name === 'Accept'))
})
test('Host follows redirects once and the final URL is used and returned', () => {
  mode = 'redirect'
  requests.length = 0
  const response = call('music.resolve-resource', { request })
  assert.equal(response.status, 'ok', JSON.stringify(response))
  assert.equal(response.data.url, redirected)
  assert.equal(requests.filter((value) => value.url === origin).length, 1)
  assert.ok(requests.some((value) => value.url === redirected))
})
test('API response and returned URL may exceed 8KiB and 64KiB', () => {
  mode = 'large'
  requests.length = 0
  const response = call('music.resolve-resource', { request })
  assert.equal(response.status, 'ok', JSON.stringify(response))
  assert(apiBytes > 65536)
  assert(response.data.url.length > 65536)
  assert.equal(response.data.url, large)
})
test('a final URL outside HTTP(S) is rejected', () => {
  mode = 'badFinal'
  requests.length = 0
  assert.equal(call('music.resolve-resource', { request }).data.code, 'permissionDenied')
})
test('local Host entry reports an upstream 401 before audio probing', () => {
  mode = 'unauthorized'
  requests.length = 0
  diagnostics.length = 0
  assert.equal(call('music.resolve-resource', { request }).data.code, 'permissionDenied')
  assert.equal(requests.length, 2)
  assert.match(requests[0].url, /\/time$/)
  assert.match(requests[1].url, /\/api\.php\?/)
  assert.deepEqual(diagnostics.at(-1), {
    stage: 'resource.resolve',
    class: 'upstream-auth',
    code: 'permissionDenied'
  })
})
test('private, IP, port, credentials and fragment URLs are accepted', () => {
  mode = 'private'
  const start = requests.length
  const privateResponse = call('music.resolve-resource', { request })
  assert.equal(privateResponse.status, 'ok', JSON.stringify(privateResponse))
  assert.match(privateResponse.data.url, /^https:\/\/user:pass@127\.0\.0\.1:8443\/secret#fragment$/)
  assert.ok(
    requests
      .slice(start)
      .some((value) => value.url === 'https://user:pass@127.0.0.1:8443/secret#fragment')
  )
  mode = 'ip'
  const ipResponse = call('music.resolve-resource', { request })
  assert.equal(ipResponse.status, 'ok', JSON.stringify(ipResponse))
  assert.match(ipResponse.data.url, /^http:\/\/\[::1\]:8080\/ip\.mp3#fragment$/)
  mode = 'ftp'
  assert.equal(call('music.resolve-resource', { request }).data.code, 'permissionDenied')
  mode = 'offline'
  assert.equal(call('music.resolve-resource', { request }).data.code, 'network')
})
