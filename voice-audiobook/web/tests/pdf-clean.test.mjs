// Same sample PDFs and expected text as ../../tests/test_pdf_cleaner.py.
// Needs: npm install, and a Python with reportlab (set PYTHON=... if it is not python3).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { cleanPdf, toEditableText, fromEditableText, joinHyphenated, normalizeChars } from '../pdf-clean.js'

const here = path.dirname(fileURLToPath(import.meta.url))
let dir

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfclean-'))
  execFileSync(process.env.PYTHON || 'python3', [path.join(here, '../../tests/make_sample_pdfs.py'), dir])
})
after(() => fs.rmSync(dir, { recursive: true, force: true }))

const load = (name) => pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(dir, name))), verbosity: 0 }).promise
const expected = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.expected.json`), 'utf8'))

test('book: text is exactly the original', async () => {
  const { paragraphs, report } = await cleanPdf(await load('book.pdf'), { OPS: pdfjs.OPS })
  assert.deepEqual(paragraphs.map((p) => p.text), expected('book'))
  assert.deepEqual(paragraphs.filter((p) => p.kind === 'h1').map((p) => p.text), ['Chapter One', 'Chapter Two'])
  assert.deepEqual([...report.removed['page number']].sort(), ['1', '2', '3'])
  assert.deepEqual([...report.removed['header/footer']].sort(), ['Chapter One: The Source', 'THE QUIET RIVER'])
  assert.equal(report.removed.footnote.length, 2)
  assert.deepEqual([...report.removed['footnote marker']].sort(), ['1', '2'])
  assert.ok(report.removed['sideways text'].every((t) => t === 'REVIEW COPY'))
  assert.ok(report.hyphensJoined >= 3)
})

test('paper: two columns, caption, diagram, footnote', async () => {
  const { paragraphs, report } = await cleanPdf(await load('paper.pdf'), { OPS: pdfjs.OPS })
  assert.deepEqual(paragraphs.map((p) => p.text), expected('paper'))
  assert.equal(report.multiColumnPages, 2)
  assert.deepEqual(report.removed['header/footer'], ['Journal of Field Instruments, Vol. 3, No. 2', 'Journal of Field Instruments, Vol. 3, No. 2'])
  assert.deepEqual([...report.removed['page number']].sort(), ['Page 1', 'Page 2'])
  assert.ok(report.removed.footnote[0].startsWith('* Corresponding author'))
  assert.deepEqual([...report.removed['figure label']].sort(), ['Data logger', 'Memory card', 'Pressure sensor'])
})

test('editable text round trip', async () => {
  const { paragraphs } = await cleanPdf(await load('book.pdf'), { OPS: pdfjs.OPS })
  const back = fromEditableText(toEditableText(paragraphs))
  assert.deepEqual(back.map((p) => p.text), paragraphs.map((p) => p.text))
  assert.deepEqual(back.map((p) => p.kind === 'p'), paragraphs.map((p) => p.kind === 'p'))
})

test('pasted text with one paragraph per line', () => {
  assert.deepEqual(fromEditableText('First paragraph.\nSecond one.\n').map((p) => p.text), ['First paragraph.', 'Second one.'])
  assert.deepEqual(fromEditableText('One paragraph\nwrapped.\n\nTwo.').map((p) => p.text), ['One paragraph wrapped.', 'Two.'])
})

test('hyphen joining', () => {
  const vocab = (whole = {}, hyphenated = {}) => ({ whole: new Map(Object.entries(whole)), hyphenated: new Map(Object.entries(hyphenated)) })
  assert.equal(joinHyphenated('an algo-', 'rithm for', vocab()), 'an algorithm for')
  assert.equal(joinHyphenated('was pro-', 'fessional', vocab()), 'was professional')
  assert.equal(joinHyphenated('a well-', 'known fact', vocab()), 'a well-known fact')
  assert.equal(joinHyphenated('a first-', 'aid kit', vocab({}, { 'first-aid': 1 })), 'a first-aid kit')
  assert.equal(joinHyphenated('anti-', 'American', vocab()), 'anti-American')
  assert.equal(joinHyphenated('self-', 'ish', vocab({ selfish: 2 })), 'selfish')
  assert.equal(joinHyphenated('the year 1990-', '1995', vocab()), null)
  assert.equal(joinHyphenated(normalizeChars('an algo­'), 'rithm', vocab()), 'an algorithm')
  assert.equal(normalizeChars('na¨ıve ﬁsh in­visible'), 'naïve fish invisible')
})
