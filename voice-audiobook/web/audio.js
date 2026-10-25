// audio.js: decoding, voice-sample preparation, WAV previews and MP3 encoding.

import { frameDb, voicedFrames, matchLoudness } from './smooth-joins.js'

export const SAMPLE_RATE = 24000 // what Chatterbox listens to and speaks at
const MAX_VOICE_SECONDS = 12

/** Any audio file the browser can play -> mono Float32Array at 24 kHz. */
export async function decodeToMono(arrayBuffer) {
  const probe = new OfflineAudioContext(1, 1, SAMPLE_RATE)
  const decoded = await probe.decodeAudioData(arrayBuffer)
  const length = Math.max(1, Math.round(decoded.duration * SAMPLE_RATE))
  const ctx = new OfflineAudioContext(1, length, SAMPLE_RATE)
  const source = ctx.createBufferSource()
  source.buffer = decoded
  source.connect(ctx.destination)
  source.start()
  const rendered = await ctx.startRendering()
  return rendered.getChannelData(0)
}

/**
 * Get a recording ready to clone from: cut the silence at both ends, keep the first
 * 12 seconds of speech, and bring it to a normal speaking level.
 * Returns { samples, seconds } or throws with a message for the person.
 */
export function prepareVoice(samples) {
  const { db, hop } = frameDb(samples, SAMPLE_RATE)
  const voiced = voicedFrames(db)
  const first = voiced.indexOf(1)
  const last = voiced.lastIndexOf(1)
  if (first < 0) throw new Error('That recording is silent. Check the microphone and try again.')
  const start = Math.max(0, first * hop - Math.round(0.1 * SAMPLE_RATE))
  const end = Math.min(samples.length, (last + 1) * hop + Math.round(0.2 * SAMPLE_RATE), start + MAX_VOICE_SECONDS * SAMPLE_RATE)
  const seconds = (end - start) / SAMPLE_RATE
  if (seconds < 3) throw new Error(`That recording has only ${seconds.toFixed(1)} seconds of speech. Record at least 5 seconds.`)
  return { samples: matchLoudness(samples.subarray(start, end), SAMPLE_RATE), seconds }
}

export function toInt16(samples) {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

export function wavBlob(samples, sampleRate = SAMPLE_RATE) {
  const pcm = toInt16(samples)
  const buffer = new ArrayBuffer(44 + pcm.length * 2)
  const v = new DataView(buffer)
  const text = (offset, s) => [...s].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  v.setUint32(4, 36 + pcm.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  text(36, 'data')
  v.setUint32(40, pcm.length * 2, true)
  new Int16Array(buffer, 44).set(pcm)
  return new Blob([buffer], { type: 'audio/wav' })
}

/** Streaming MP3 encoder (lamejs, loaded as a global script). */
export class Mp3Writer {
  constructor(sampleRate = SAMPLE_RATE, kbps = 64) {
    if (!globalThis.lamejs?.Mp3Encoder) throw new Error('The MP3 encoder did not load. Check your internet connection and reload the page.')
    this.encoder = new globalThis.lamejs.Mp3Encoder(1, sampleRate, kbps)
  }

  static #bytes(chunk) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length).slice()
  }

  encode(samples) {
    const pcm = toInt16(samples)
    const parts = []
    for (let i = 0; i < pcm.length; i += 11520) parts.push(Mp3Writer.#bytes(this.encoder.encodeBuffer(pcm.subarray(i, i + 11520))))
    return concatBytes(parts)
  }

  flush() {
    return Mp3Writer.#bytes(this.encoder.flush())
  }
}

export function concatBytes(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

export function formatDuration(seconds) {
  seconds = Math.max(0, Math.round(seconds))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h) return `${h} h ${m} min`
  if (m) return `${m} min ${s.toString().padStart(2, '0')} s`
  return `${s} s`
}
