// smooth-joins.js: make separately generated pieces of speech join seamlessly.
// JavaScript port of ../smooth_joins.py (same constants, same behaviour).
//
// For every clip: drop a quiet artefact the model tacked on at the end, shorten long
// silences inside it, trim both ends to a constant amount of air, even out the
// loudness, fade in and out (no clicks), and follow it with a pause that matches the
// punctuation. Paragraph and heading pauses replace the sentence pause instead of
// adding to it.

const FRAME_SEC = 0.01

export const PAUSE = {
  sentence: 0.45, // . ! ? …
  clause: 0.3, // ; :
  comma: 0.22, // ,
  dash: 0.18, // — –
  mid: 0.1, // clip ended mid-sentence (long sentence split in two)
  paragraph: 0.75, // total silence at a paragraph break
  section: 1.1, // total silence after a heading
}
export const JITTER = 0.08
export const LEAD_KEEP = 0.025
export const TAIL_KEEP = 0.07
export const FADE_IN = 0.008
export const FADE_OUT = 0.025
export const MAX_INNER_GAP = 0.7
export const TARGET_LEVEL_DB = -20
export const MAX_GAIN_DB = 6
export const PEAK_LIMIT = 0.97

const SENTENCE_END = new Set('.!?…‽。！？।॥؟')
const CLAUSE_END = new Set(';:；：')
const COMMA_END = new Set(',，、،')
const DASH_END = new Set('—–-')
const CLOSERS_RE = /["'”’»)\]}」』\s]+$/

let crcTable = null
function crc32(str) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  const bytes = new TextEncoder().encode(str)
  let crc = 0xffffffff
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// +/- JITTER so the rhythm is not robotic, but always the same for the same text.
function jitter(text) {
  const h = crc32(text) % 2001
  return 1 + JITTER * (h / 1000 - 1)
}

/** Seconds of silence to put after a clip that spoke `text`. */
export function pauseAfter(text) {
  const t = (text || '').trimEnd().replace(CLOSERS_RE, '')
  const last = t.slice(-1)
  let base = PAUSE.mid
  if (SENTENCE_END.has(last)) base = PAUSE.sentence
  else if (CLAUSE_END.has(last)) base = PAUSE.clause
  else if (COMMA_END.has(last)) base = PAUSE.comma
  else if (DASH_END.has(last)) base = PAUSE.dash
  return base * jitter(t)
}

export function frameDb(audio, sr) {
  const hop = Math.max(1, Math.floor(sr * FRAME_SEC))
  const n = Math.ceil(audio.length / hop)
  const db = new Float64Array(n)
  for (let f = 0; f < n; f++) {
    let sum = 0
    const end = Math.min(audio.length, (f + 1) * hop)
    for (let i = f * hop; i < end; i++) sum += audio[i] * audio[i]
    db[f] = 20 * Math.log10(Math.sqrt(sum / hop) + 1e-10)
  }
  return { db, hop }
}

function medianOf(values) {
  const s = Float64Array.from(values).sort()
  if (!s.length) return 0
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Frames that carry speech: within 35 dB of the loudest frame and within 28 dB of the
 *  typical speech level (quieter than that is breath, hum or a mumble). */
export function voicedFrames(db) {
  const out = new Uint8Array(db.length)
  if (!db.length) return out
  let threshold = Math.max(Math.max(...db) - 35, -55)
  const loud = []
  for (const v of db) if (v > threshold) loud.push(v)
  if (loud.length) threshold = Math.max(threshold, medianOf(loud) - 28)
  for (let i = 0; i < db.length; i++) out[i] = db[i] > threshold ? 1 : 0
  return out
}

/** Runs of voiced frames as [start, end) frame pairs, bridging gaps shorter than `bridge` seconds. */
export function segments(voiced, hop, sr, bridge = 0.15) {
  const segs = []
  const maxGap = Math.floor((bridge * sr) / hop)
  for (let i = 0; i < voiced.length; i++) {
    if (!voiced[i]) continue
    const last = segs[segs.length - 1]
    if (last && i - last[1] <= maxGap) last[1] = i + 1
    else segs.push([i, i + 1])
  }
  return segs
}

/** Remove short blobs (breath, mumble) the model added after the last word. */
export function dropTailArtifact(audio, sr) {
  for (let round = 0; round < 3; round++) {
    const { db, hop } = frameDb(audio, sr)
    const voiced = voicedFrames(db)
    const segs = segments(voiced, hop, sr, 0.08)
    if (segs.length < 2) return audio
    const last = segs[segs.length - 1]
    const prev = segs[segs.length - 2]
    const gap = ((last[0] - prev[1]) * hop) / sr
    const dur = ((last[1] - last[0]) * hop) / sr
    const speechDur = ((prev[1] - segs[0][0]) * hop) / sr
    const mainVoiced = []
    for (let i = segs[0][0]; i < prev[1]; i++) if (voiced[i]) mainVoiced.push(db[i])
    const mainLevel = medianOf(mainVoiced)
    let tailSum = 0
    for (let i = last[0]; i < last[1]; i++) tailSum += db[i]
    const tailLevel = tailSum / (last[1] - last[0])
    const afterPause = gap >= 0.35 && dur <= 0.35 && tailLevel < mainLevel - 6
    const farTooQuiet = dur <= 0.6 && tailLevel < mainLevel - 20
    if (speechDur < 0.8 || !(afterPause || farTooQuiet)) return audio
    audio = audio.subarray(0, prev[1] * hop)
  }
  return audio
}

/** Shorten silences inside the clip that are longer than maxGap seconds. */
export function compressInnerGaps(audio, sr, maxGap = MAX_INNER_GAP) {
  const { db, hop } = frameDb(audio, sr)
  const segs = segments(voicedFrames(db), hop, sr)
  if (segs.length < 2) return audio
  const keep = Math.floor(maxGap * sr)
  const pieces = [audio.subarray(0, segs[0][1] * hop)]
  for (let s = 1; s < segs.length; s++) {
    let gap = audio.subarray(segs[s - 1][1] * hop, segs[s][0] * hop)
    if (gap.length > keep) {
      const half = keep >> 1
      const shortened = new Float32Array(keep)
      shortened.set(gap.subarray(0, half))
      shortened.set(gap.subarray(gap.length - (keep - half)), half)
      gap = shortened
    }
    pieces.push(gap, audio.subarray(segs[s][0] * hop, segs[s][1] * hop))
  }
  pieces.push(audio.subarray(segs[segs.length - 1][1] * hop))
  return concat(pieces)
}

export function trim(audio, sr, lead = LEAD_KEEP, tail = TAIL_KEEP) {
  const { db, hop } = frameDb(audio, sr)
  const voiced = voicedFrames(db)
  const first = voiced.indexOf(1)
  if (first < 0) return audio
  const last = voiced.lastIndexOf(1)
  const start = Math.max(0, first * hop - Math.floor(lead * sr))
  const end = Math.min(audio.length, (last + 1) * hop + Math.floor(tail * sr))
  return audio.subarray(start, end)
}

export function matchLoudness(audio, sr, targetDb = TARGET_LEVEL_DB, maxGainDb = MAX_GAIN_DB) {
  const { db } = frameDb(audio, sr)
  const voiced = voicedFrames(db)
  let power = 0
  let count = 0
  for (let i = 0; i < db.length; i++) {
    if (voiced[i]) {
      power += 10 ** (db[i] / 10)
      count++
    }
  }
  if (!count) return audio
  const level = 10 * Math.log10(power / count)
  const gainDb = Math.min(maxGainDb, Math.max(-maxGainDb, targetDb - level))
  let gain = 10 ** (gainDb / 20)
  let peak = 0
  for (const v of audio) peak = Math.max(peak, Math.abs(v * gain))
  if (peak > PEAK_LIMIT) gain *= PEAK_LIMIT / peak
  const out = new Float32Array(audio.length)
  for (let i = 0; i < audio.length; i++) out[i] = audio[i] * gain
  return out
}

export function fade(audio, sr, fadeIn = FADE_IN, fadeOut = FADE_OUT) {
  const out = Float32Array.from(audio)
  const nIn = Math.min(out.length >> 1, Math.floor(fadeIn * sr))
  const nOut = Math.min(out.length >> 1, Math.floor(fadeOut * sr))
  for (let i = 0; i < nIn; i++) out[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / Math.max(1, nIn - 1))
  for (let i = 0; i < nOut; i++) out[out.length - nOut + i] *= 0.5 + 0.5 * Math.cos((Math.PI * i) / Math.max(1, nOut - 1))
  return out
}

/** Clean one generated clip. Returns { audio, pause } where pause is in samples. */
export function smoothChunk(audio, sr, text) {
  const pause = Math.round(pauseAfter(text) * sr)
  let hasSound = false
  for (const v of audio) if (Math.abs(v) > 1e-6) { hasSound = true; break }
  if (!audio.length || !hasSound) return { audio: Float32Array.from(audio), pause }
  let out = dropTailArtifact(audio, sr)
  out = compressInnerGaps(out, sr)
  out = trim(out, sr)
  out = matchLoudness(out, sr)
  out = fade(out, sr)
  return { audio: out, pause }
}

export function concat(arrays) {
  const out = new Float32Array(arrays.reduce((n, a) => n + a.length, 0))
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}
