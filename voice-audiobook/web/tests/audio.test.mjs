// Chunking and audio-join tests. The parity test runs ../../smooth_joins.py on the same
// signals and checks the JavaScript port gives the same result (needs numpy in PYTHON).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as sj from '../smooth-joins.js'
import { makeChunks, splitSentences, MAX_CHARS } from '../chunker.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const SR = 24000

let seed = 1
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const noise = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand())

function speech(seconds, levelDb = -20) {
  const n = Math.round(seconds * SR)
  const out = new Float32Array(n)
  let sum = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const env = 0.35 + 0.65 * Math.abs(Math.sin(2 * Math.PI * 4 * t))
    out[i] = (Math.sin(2 * Math.PI * 180 * t) + 0.4 * Math.sin(2 * Math.PI * 360 * t)) * env + 0.05 * noise()
    sum += out[i] * out[i]
  }
  const gain = 10 ** (levelDb / 20) / Math.sqrt(sum / n)
  return out.map((v) => v * gain)
}
const silence = (seconds, noiseDb = -75) => Float32Array.from({ length: Math.round(seconds * SR) }, () => noise() * 10 ** (noiseDb / 20))
const levelDb = (x) => 20 * Math.log10(Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length) + 1e-12)

test('pauses follow punctuation and stay stable', () => {
  assert.ok(sj.pauseAfter('He climbed.') > sj.pauseAfter('He climbed;'))
  assert.ok(sj.pauseAfter('He climbed;') > sj.pauseAfter('He climbed,'))
  assert.ok(sj.pauseAfter('He climbed,') > sj.pauseAfter('He climbed and'))
  assert.ok(Math.abs(sj.pauseAfter('"Stop!"') - sj.PAUSE.sentence) < 0.05)
  assert.equal(sj.pauseAfter('Same words.'), sj.pauseAfter('Same words.'))
})

test('clips are trimmed, faded and levelled', () => {
  for (const [lead, tail] of [[0.05, 0.1], [0.4, 0.9]]) {
    const { audio } = sj.smoothChunk(sj.concat([silence(lead), speech(1.2), silence(tail)]), SR, 'Words.')
    const loud = audio.findIndex((v) => Math.abs(v) > 1e-3)
    const lastLoud = audio.length - 1 - [...audio].reverse().findIndex((v) => Math.abs(v) > 1e-3)
    assert.ok(loud / SR < sj.LEAD_KEEP + 0.012)
    assert.ok((audio.length - 1 - lastLoud) / SR < sj.TAIL_KEEP + 0.012)
  }
  const { audio: hard } = sj.smoothChunk(speech(1, -12), SR, 'x.')
  assert.ok(Math.abs(hard[0]) < 1e-3 && Math.abs(hard[hard.length - 1]) < 1e-3, 'no clicks at the edges')
  const quiet = sj.smoothChunk(speech(1, -25), SR, 'a.').audio
  const loud = sj.smoothChunk(speech(1, -15), SR, 'b.').audio
  assert.ok(Math.abs(levelDb(quiet) - levelDb(loud)) < 1)
})

test('mumbles go, real words stay', () => {
  const mumble = sj.smoothChunk(sj.concat([speech(1.5), speech(0.3, -52), silence(0.1)]), SR, 'w.').audio
  assert.ok(mumble.length / SR < 1.5 + sj.TAIL_KEEP + 0.05)
  const word = sj.smoothChunk(sj.concat([speech(1.5), silence(0.5), speech(0.3, -20)]), SR, 'w. Yes.').audio
  assert.ok(word.length / SR > 2.2)
})

test('JavaScript port matches smooth_joins.py', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sj-'))
  try {
    const cases = {
      plain: sj.concat([silence(0.3), speech(1.2), silence(0.7)]),
      mumble: sj.concat([speech(1.5), silence(0.5), speech(0.2, -34), silence(0.1)]),
      glued: sj.concat([speech(1.5), speech(0.3, -52), silence(0.1)]),
      gap: sj.concat([speech(0.8), silence(1.8), speech(0.8)]),
      hot: speech(1, -3),
    }
    const texts = { plain: 'A sentence.', mumble: 'A clause,', glued: 'mid', gap: 'Wait — what?', hot: 'Loud!' }
    for (const [name, x] of Object.entries(cases)) fs.writeFileSync(path.join(dir, `${name}.f32`), Buffer.from(x.buffer))
    const script = `
import json, sys, numpy as np
sys.path.insert(0, ${JSON.stringify(path.join(here, '../..'))})
import smooth_joins as sj
texts = json.loads(sys.argv[2]); out = {}
for name, text in texts.items():
    audio, pause = sj.smooth_chunk(np.fromfile(f'{sys.argv[1]}/{name}.f32', dtype=np.float32), ${SR}, text)
    out[name] = [len(audio), int(pause), float(np.sqrt(np.mean(audio.astype(np.float64)**2)))]
print(json.dumps(out))`
    const py = JSON.parse(execFileSync(process.env.PYTHON || 'python3', ['-c', script, dir, JSON.stringify(texts)]).toString())
    for (const [name, x] of Object.entries(cases)) {
      const { audio, pause } = sj.smoothChunk(x, SR, texts[name])
      const rms = Math.sqrt(audio.reduce((s, v) => s + v * v, 0) / audio.length)
      assert.equal(audio.length, py[name][0], `${name}: length`)
      assert.equal(pause, py[name][1], `${name}: pause`)
      assert.ok(Math.abs(rms - py[name][2]) < 1e-4, `${name}: level ${rms} vs ${py[name][2]}`)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('sentences split, abbreviations do not', () => {
  assert.deepEqual(splitSentences('Dr. Smith arrived. He sat down! Was it 3 p.m.? Yes.'), ['Dr. Smith arrived.', 'He sat down!', 'Was it 3 p.m.?', 'Yes.'])
  assert.deepEqual(splitSentences('See e.g. Figure 2. Then J. R. R. Tolkien wrote.'), ['See e.g. Figure 2.', 'Then J. R. R. Tolkien wrote.'])
})

test('chunks pack sentences, split long ones, and carry paragraph pauses', () => {
  const long = 'This sentence goes on and on, with clause after clause, and it keeps going; it does not stop, because it is a test of how very long sentences are split at sensible places rather than in the middle of a word, which would sound bad.'
  const chunks = makeChunks([
    { kind: 'h1', text: 'Chapter One' },
    { kind: 'p', text: 'Short one. Short two. Short three.' },
    { kind: 'p', text: long },
  ])
  assert.equal(chunks[0].text, 'Chapter One.')
  assert.equal(chunks[0].pause, sj.PAUSE.section)
  assert.equal(chunks[1].text, 'Short one. Short two. Short three.')
  assert.equal(chunks[1].pause, sj.PAUSE.paragraph)
  const parts = chunks.filter((c) => c.para === 2)
  assert.ok(parts.length >= 2)
  assert.ok(parts.every((c) => c.text.length <= MAX_CHARS))
  assert.equal(parts.map((c) => c.text).join(' '), long)
  assert.ok(parts.slice(0, -1).every((c) => /[,;]$/.test(c.text)), 'split after punctuation, not mid-phrase')
})
