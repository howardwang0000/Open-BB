// chunker.js: split cleaned paragraphs into pieces the voice model can speak in one go.
//
// Whole sentences are packed together up to MAX_CHARS (the model sounds most natural
// on one or two sentences at a time). A longer sentence is split at a comma, semicolon
// or dash, and only as a last resort between words. Each piece knows the pause that
// follows it: its own punctuation decides, and the end of a paragraph or heading
// lengthens it.

import { PAUSE, pauseAfter } from './smooth-joins.js'

export const MAX_CHARS = 200

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'ave', 'gen', 'gov', 'sgt', 'capt', 'lt', 'col',
  'etc', 'vs', 'vol', 'dept', 'approx', 'inc', 'ltd', 'co', 'no', 'fig', 'figs', 'eq', 'ed', 'eds', 'rev',
  'e.g', 'i.e', 'cf', 'al', 'pp', 'p', 'ch', 'sec', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep',
  'sept', 'oct', 'nov', 'dec',
])

export function splitSentences(text) {
  const parts = text.split(/(?<=[.!?…]["'”’)\]]*)\s+(?=["'“‘(\[]?[\p{Lu}\p{N}])/u)
  const sentences = []
  for (const part of parts) {
    const prev = sentences[sentences.length - 1]
    const lastWord = prev ? (prev.match(/(\S+)\.$/) || [])[1] : null
    // "Dr. Smith", "e.g. This", "J. R. R. Tolkien": not a sentence end.
    if (prev && lastWord && (ABBREVIATIONS.has(lastWord.toLowerCase()) || /^\p{L}$/u.test(lastWord))) {
      sentences[sentences.length - 1] = `${prev} ${part}`
    } else {
      sentences.push(part)
    }
  }
  return sentences.map((s) => s.trim()).filter(Boolean)
}

function splitLong(sentence, maxChars) {
  const out = []
  let rest = sentence
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 1)
    let cut = -1
    for (const re of [/[;:—–]\s/g, /,\s/g]) {
      let m
      while ((m = re.exec(window)) !== null) if (m.index > maxChars * 0.3) cut = m.index + 1
      if (cut > 0) break
    }
    if (cut <= 0) cut = window.lastIndexOf(' ')
    if (cut <= 0) cut = maxChars
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out
}

/**
 * paragraphs: [{ kind: 'h1' | 'h2' | 'p', text }]
 * returns [{ text, pause (seconds after it), para (paragraph index), heading (bool) }]
 */
export function makeChunks(paragraphs, maxChars = MAX_CHARS) {
  const chunks = []
  paragraphs.forEach((p, para) => {
    const heading = p.kind !== 'p'
    let text = p.text.replace(/\s+/g, ' ').trim()
    if (!text) return
    // A heading is spoken as a short sentence of its own.
    if (heading && !/[.!?…:]["'”’)\]]*$/.test(text)) text += '.'
    const pieces = []
    let current = ''
    for (const sentence of splitSentences(text)) {
      for (const piece of sentence.length > maxChars ? splitLong(sentence, maxChars) : [sentence]) {
        if (current && current.length + 1 + piece.length > maxChars) {
          pieces.push(current)
          current = piece
        } else {
          current = current ? `${current} ${piece}` : piece
        }
      }
    }
    if (current) pieces.push(current)
    pieces.forEach((piece, i) => {
      let pause = pauseAfter(piece)
      if (i === pieces.length - 1) pause = Math.max(pause, heading ? PAUSE.section : PAUSE.paragraph)
      chunks.push({ text: piece, pause, para, heading })
    })
  })
  return chunks
}

/** Rough speaking time, for estimates before anything is generated (about 15 characters a second). */
export function estimateSeconds(chunks) {
  return chunks.reduce((s, c) => s + c.text.length / 15 + c.pause, 0)
}
