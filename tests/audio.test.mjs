import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diagnosticId, inspectRemoteAudio } from '../src/audio.js'

function flac(bits = 16, seconds = 180) {
  const bytes = new Uint8Array(131072)
  bytes.set([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34])
  const info = new DataView(bytes.buffer, 8, 34)
  info.setUint16(0, 4096)
  info.setUint16(2, 4096)
  const packed = (BigInt(44100) << 44n) | (1n << 41n) | (BigInt(bits - 1) << 36n) | BigInt(44100 * seconds)
  info.setBigUint64(10, packed)
  return bytes
}
function reader(bytes, size = bytes.length) {
  return async (start, end) => ({
    start,
    end,
    bytes: bytes.slice(start, Math.min(end + 1, bytes.length)),
    size
  })
}
function virtualReader(prefix, size) {
  return async (start, end) => {
    const bytes = new Uint8Array(end - start + 1)
    if (start < prefix.length) bytes.set(prefix.subarray(start, Math.min(end + 1, prefix.length)))
    return { start, end, bytes, size }
  }
}
function mp3WithId3Tags(tagCount = 10) {
  const tagHeader = [0x49, 0x44, 0x33, 3, 0, 0, 0, 4, 0, 0]
  const bytes = new Uint8Array(tagCount * (tagHeader.length + 65536) + 1044 * 8)
  for (let tag = 0; tag < tagCount; tag++) bytes.set(tagHeader, tag * (tagHeader.length + 65536))
  const audioStart = tagCount * (tagHeader.length + 65536)
  for (let frame = 0; frame < 8; frame++) bytes.set([255, 251, 224, 0], audioStart + frame * 1044)
  return { audioStart, bytes }
}
test('FLAC reads distinguish lossless and high resolution and reject previews and forbidden downgrades', async () => {
  const standard = await inspectRemoteAudio(reader(flac()), 180000, 'lossless', false)
  assert.equal(standard.metadata.actualQuality, 'lossless')
  assert(standard.bytesRead > 0)
  assert.equal((await inspectRemoteAudio(reader(flac(24)), 180000, 'hires', false)).metadata.actualQuality, 'hires')
  await assert.rejects(inspectRemoteAudio(reader(flac()), 180000, 'hires', false), {
    code: 'permissionDenied'
  })
  await assert.rejects(inspectRemoteAudio(reader(flac(16, 30)), 180000, 'lossless', true), {
    code: 'permissionDenied'
  })
  await assert.rejects(inspectRemoteAudio(reader(flac()), 0, 'lossless', true), {
    code: 'permissionDenied'
  })
})
test('probe accepts resources larger than 512 MiB without allocating their full length', async () => {
  const result = await inspectRemoteAudio(virtualReader(flac(), 513 * 1024 * 1024), 180000, 'lossless', true)
  assert.equal(result.metadata.actualQuality, 'lossless')
})
test('oversized initial ranges are accepted and evicted cache is refetched on revisit', async () => {
  const size = 1024 * 1024
  const firstLength = 256 * 1024
  const prefix = flac()
  const first = new Uint8Array(firstLength)
  first.set(prefix)
  const starts = []
  const result = await inspectRemoteAudio(
    async (start, end) => {
      starts.push(start)
      const responseEnd = start === 0 ? Math.max(end, firstLength - 1) : end
      const bytes = new Uint8Array(responseEnd - start + 1)
      const sourceLength = start === 0 ? first.length : prefix.length
      const source = start === 0 ? first : prefix
      if (start < sourceLength) bytes.set(source.subarray(start, Math.min(responseEnd + 1, sourceLength)))
      return { start, end: responseEnd, bytes, size }
    },
    180000,
    'lossless',
    true
  )
  assert.equal(result.metadata.actualQuality, 'lossless')
  assert.equal(starts[0], 0)
  assert(starts.slice(1).includes(0))
})
test('audio probe accepts more than eight ranges and 256 KiB transferred', async () => {
  const track = mp3WithId3Tags()
  const size = track.audioStart + Math.floor((180 * 44100) / 1152) * 1044
  let requests = 0
  const result = await inspectRemoteAudio(
    async (start, end) => {
      requests++
      const rangeBytes = new Uint8Array(end - start + 1)
      if (start < track.bytes.length) rangeBytes.set(track.bytes.subarray(start, Math.min(end + 1, track.bytes.length)))
      return { start, end, bytes: rangeBytes, size }
    },
    180000,
    '320k',
    false
  )
  assert(requests > 8)
  assert(result.bytesRead > 256 * 1024)
  assert.equal(result.metadata.actualQuality, '320k')
})
test('probe rejects inconsistent range totals', async () => {
  let count = 0
  const bytes = flac()
  await assert.rejects(
    inspectRemoteAudio(
      async (start, end) => ({
        start,
        end,
        bytes: bytes.slice(start, end + 1),
        size: bytes.length + count++
      }),
      180000,
      'lossless',
      true
    ),
    { code: 'invalidData' }
  )
})
test('diagnostic ids fit the Host class syntax and length', () => {
  assert.equal(diagnosticId('audio-M4A/isom-ALAC-duration'), 'audio-M4A-isom-ALAC-duration')
  assert.equal(diagnosticId('  parser error / 123  '), 'parser-error-123')
  assert.equal(diagnosticId('x'.repeat(100)).length, 64)
})
