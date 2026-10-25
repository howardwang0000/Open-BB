// pdf-clean.js: turn a messy PDF into clean, read-aloud-ready paragraphs.
// JavaScript port of ../pdf_cleaner.py, working from pdf.js text content.
//
// Removes running headers/footers, page numbers, footnotes and their superscript
// markers, and sideways margin text. Re-joins words hyphenated across lines,
// reads multi-column pages column by column, keeps paragraphs whole across page
// and column breaks, and holds back a full-width caption that interrupts a sentence.
//
// Works with any pdf.js build: pass in a loaded PDFDocumentProxy.

const LIGATURES = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' }
const INVISIBLE_RE = /[­​‌‍⁠﻿]/g
const ODD_SPACES_RE = /[  -   　]/g
const SPACING_ACCENTS = { '¨': '̈', '´': '́', 'ˆ': '̂', '˜': '̃', '¸': '̧', 'ˇ': '̌', '˘': '̆', '˚': '̊' }
const SPACING_ACCENT_RE = new RegExp(`([${Object.keys(SPACING_ACCENTS).join('')}])([A-Za-z\\u0131])`, 'g')

const LINE_END_HYPHENS = ['-', '‐', '‑']
const MARKER_RE = /^[\s\d,\-–*†‡§¶¹²³⁰-⁹]+$/
const FOOTNOTE_START_RE = /^\s*(?:\d{1,3}[.)]?\s|[*†‡§¶]+\s?|[¹²³⁰-⁹]+)/
const PAGE_NUMBER_RE = /^\s*(?:[-–—]?\s*\d{1,4}\s*[-–—]?|(?:page|p\.|pg\.?)\s*\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?|\d{1,4}\s*(?:of|\/)\s*\d{1,4}|[ivxlcdm]{1,7})\s*$/i
const SENTENCE_END_RE = /[.!?…:;]["'”’)\]]*$/
const WORD_RE = /\p{L}+(?:[-‐‑]\p{L}+)*/gu
// Prefixes written with a hyphen that are never just a syllable break (see pdf_cleaner.py).
const COMPOUND_PREFIXES = new Set(['self', 'well', 'half', 'quasi', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'])

const MARGIN_ZONE = 0.12 // top/bottom slice of the page where headers/footers live
const HEADING_RATIO = 1.18 // font this much bigger than body text = heading
const SMALL_RATIO = 0.88 // font this much smaller than body text = footnote-sized

export function newReport(pages = 0) {
  return {
    pages,
    multiColumnPages: 0,
    scannedPages: [],
    hyphensJoined: 0,
    removed: { 'header/footer': [], 'page number': [], footnote: [], 'footnote marker': [], 'sideways text': [], 'figure label': [] },
  }
}

export function summarize(report) {
  const parts = [`${report.pages} page${report.pages === 1 ? '' : 's'}`]
  if (report.multiColumnPages) parts.push(`${report.multiColumnPages} in columns`)
  for (const [kind, items] of Object.entries(report.removed)) {
    if (items.length) parts.push(`${items.length} ${kind}${items.length === 1 ? '' : 's'} removed`)
  }
  if (report.hyphensJoined) parts.push(`${report.hyphensJoined} split word${report.hyphensJoined === 1 ? '' : 's'} re-joined`)
  if (report.scannedPages.length) parts.push(`${report.scannedPages.length} scanned page${report.scannedPages.length === 1 ? '' : 's'} skipped (no text)`)
  return parts.join(', ')
}

export function normalizeChars(text) {
  // A soft hyphen ending a line is a visible hyphenation break; elsewhere it is invisible.
  text = text.replace(/­\s*$/, '-')
  for (const [lig, rep] of Object.entries(LIGATURES)) text = text.split(lig).join(rep)
  if (SPACING_ACCENT_RE.test(text)) {
    text = text.replace(SPACING_ACCENT_RE, (_, acc, ch) => ch.replace('ı', 'i') + SPACING_ACCENTS[acc]).normalize('NFC')
  }
  SPACING_ACCENT_RE.lastIndex = 0
  text = text.replace(/c⃝/g, '©')
  text = text.replace(/(?<=\p{L})[∗*†‡]+/gu, '') // "Gal∗", "Smith†"
  return text.replace(INVISIBLE_RE, '').replace(ODD_SPACES_RE, ' ')
}

function weightedMode(pairs, fallback = 10) {
  const counts = new Map()
  for (const [value, weight] of pairs) {
    const key = Math.round(value * 2) / 2
    counts.set(key, (counts.get(key) || 0) + weight)
  }
  let best = fallback
  let bestCount = -1
  for (const [k, c] of counts) if (c > bestCount) { best = k; bestCount = c }
  return best
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return !s.length ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ---------------------------------------------------------------- extraction

async function extractPage(page, pno, report) {
  const [vx0, , , vy1] = page.view
  const pageW = page.view[2] - page.view[0]
  const pageH = page.view[3] - page.view[1]
  const content = await page.getTextContent()
  const rotated = []
  const items = []
  for (const it of content.items) {
    if (typeof it.str !== 'string') continue
    const [a, b, c, d, e, f] = it.transform
    const horizontal = a > 0 && Math.abs(b) < 0.05 * Math.abs(a) && Math.abs(c) < 0.05 * Math.abs(d)
    if (!horizontal) {
      if (it.str.trim()) rotated.push(it.str.trim())
      continue
    }
    const size = Math.abs(d) || it.height || 10
    items.push({ str: it.str, x0: e - vx0, x1: e - vx0 + it.width, base: vy1 - f, size, eol: it.hasEOL })
  }

  // Split the content stream into visual line fragments: a new fragment starts at an
  // end-of-line, a jump in baseline, a step backwards, or a gap wide enough to be a gutter.
  const fragments = []
  let cur = []
  const flush = () => { if (cur.length) fragments.push(cur); cur = [] }
  for (const it of items) {
    // Space-only items are skipped: pdf.js stretches them across gaps of any width,
    // and spacing is rebuilt from positions below.
    if (it.str.trim()) {
      if (cur.length) {
        const main = cur[0]
        const last = cur[cur.length - 1]
        const dy = it.base - main.base
        const span = Math.max(main.size, it.size) // room for superscripts and subscripts
        const sameLine = Math.abs(dy) < 0.6 * span
        const gap = it.x0 - last.x1
        if (!sameLine || gap < -main.size || gap > 1.2 * main.size) flush()
      }
      cur.push(it)
    }
    if (it.eol) flush()
  }
  flush()

  const lines = []
  for (const frag of fragments) {
    const visible = frag.filter((x) => x.str.trim())
    if (!visible.length) continue
    const size = weightedMode(visible.map((x) => [x.size, x.str.length]))
    const base = Math.max(...visible.filter((x) => x.size >= size * 0.92).map((x) => x.base))
    let text = ''
    let prevX1 = null
    visible.forEach((x, i) => {
      // Footnote reference markers: small raised digits/symbols after a word.
      const raised = base - x.base > 0.15 * size
      if (i > 0 && x.size < size * 0.92 && raised && MARKER_RE.test(x.str)) {
        report.removed['footnote marker'].push(x.str.trim())
        prevX1 = x.x1
        return
      }
      if (prevX1 !== null && x.x0 - prevX1 > 0.15 * size && !/\s$/.test(text) && !/^\s/.test(x.str)) text += ' '
      text += x.str
      prevX1 = x.x1
    })
    text = normalizeChars(text).replace(/\s+/g, ' ').trim()
    if (!text) continue
    const x0 = Math.min(...visible.map((x) => x.x0))
    const x1 = Math.max(...visible.map((x) => x.x1))
    lines.push({ text, x0, x1, y0: base - size * 0.8, y1: base + size * 0.2, base, size, page: pno, pageW, pageH, column: 0 })
  }
  return { lines, rotated, hasText: items.some((x) => x.str.trim()) || rotated.length > 0 }
}

// Glue consecutive pieces that sit on the same baseline in the same column back together.
function mergeSameBaseline(lines) {
  const merged = []
  let group = []
  const flush = () => {
    if (!group.length) return
    group.sort((a, b) => a.x0 - b.x0)
    const first = group[0]
    for (const ln of group.slice(1)) {
      first.text = `${first.text} ${ln.text}`
      first.x1 = Math.max(first.x1, ln.x1)
      first.y0 = Math.min(first.y0, ln.y0)
      first.y1 = Math.max(first.y1, ln.y1)
    }
    merged.push(first)
    group = []
  }
  for (const ln of lines) {
    if (group.length && (ln.column !== group[0].column || ln.page !== group[0].page || Math.abs(ln.base - group[0].base) >= 0.35 * ln.size)) flush()
    group.push(ln)
  }
  flush()
  return merged
}

// ------------------------------------------------------- headers and footers

const marginKey = (text) => text.toLowerCase().replace(/\s+/g, ' ').replace(/\d+/g, '#').trim()

function removeHeadersFooters(pages, bodySize, report) {
  const minRepeats = pages.length <= 4 ? 2 : 3
  const candidatesOf = (pageLines) => {
    const byY = [...pageLines].sort((a, b) => a.y0 - b.y0)
    const out = []
    for (const ln of [...byY.slice(0, 3), ...byY.slice(-3)]) {
      const inTop = ln.y1 <= ln.pageH * MARGIN_ZONE
      const inBottom = ln.y0 >= ln.pageH * (1 - MARGIN_ZONE)
      if ((inTop || inBottom) && ln.size < bodySize * HEADING_RATIO && !out.includes(ln)) out.push(ln)
    }
    return out
  }
  // A small line standing alone in the margin, far from the body text (a running header).
  const isolated = (ln, pageLines) => {
    if (ln.size > bodySize * 1.05) return false
    const others = pageLines.filter((o) => o !== ln)
    if (!others.length) return false
    if (ln.y1 <= ln.pageH * MARGIN_ZONE) {
      const below = others.filter((o) => o.y0 >= ln.y1 - 1).map((o) => o.y0)
      if (!below.length || others.some((o) => o.y1 <= ln.y0)) return false
      return Math.min(...below) - ln.y1 > 2.2 * bodySize
    }
    const above = others.filter((o) => o.y1 <= ln.y0 + 1).map((o) => o.y1)
    if (!above.length || others.some((o) => o.y0 >= ln.y1 && o.size >= bodySize * 0.93)) return false
    return ln.y0 - Math.max(...above) > 2.2 * bodySize
  }

  const candidates = pages.map(candidatesOf)
  const seen = new Map()
  for (const cands of candidates) {
    for (const key of new Set(cands.map((l) => marginKey(l.text)))) seen.set(key, (seen.get(key) || 0) + 1)
  }
  pages.forEach((pageLines, i) => {
    for (const ln of candidates[i]) {
      let kind = null
      if (PAGE_NUMBER_RE.test(ln.text)) kind = 'page number'
      else if ((pages.length > 1 && seen.get(marginKey(ln.text)) >= minRepeats) || isolated(ln, pageLines)) kind = 'header/footer'
      if (kind) {
        report.removed[kind].push(ln.text)
        pageLines.splice(pageLines.indexOf(ln), 1)
      }
    }
  })
}

// ------------------------------------------------------------------ columns

function isGutter(narrow, gapX0, gapX1, area) {
  const onLeft = narrow.filter((l) => l.x1 <= gapX0 + 1)
  const onRight = narrow.filter((l) => l.x0 >= gapX1 - 1)
  const need = Math.max(3, 0.2 * narrow.length)
  if (onLeft.length >= need && onRight.length >= need) return true
  // A short last column: the left column's lines run up to the gap, and the few
  // lines on the right share a common left edge.
  if (onLeft.length < 3 || onRight.length < 2) return false
  const filled = onLeft.filter((l) => l.x1 >= gapX0 - 0.12 * area).length
  const rightEdge = Math.min(...onRight.map((l) => l.x0))
  const aligned = onRight.filter((l) => l.x0 - rightEdge < 3).length
  return filled >= 0.6 * onLeft.length && aligned >= 2
}

function findGutters(lines) {
  if (lines.length < 8) return []
  const left = Math.min(...lines.map((l) => l.x0))
  const right = Math.max(...lines.map((l) => l.x1))
  const area = right - left
  if (area <= 0) return []
  let narrow = lines.filter((l) => l.x1 - l.x0 <= area * 0.6)
  if (narrow.length < 6 || narrow.length < 0.4 * lines.length) return []
  // A handful of centred lines (title block, affiliations) straddle the gutter: leave
  // them out. Many of them would be a real middle column, so keep those.
  const middle = (left + right) / 2
  const centred = narrow.filter((l) => l.x0 < middle && middle < l.x1 && Math.abs((l.x0 + l.x1) / 2 - middle) < 0.08 * area)
  if (centred.length <= 0.15 * narrow.length) narrow = narrow.filter((l) => !centred.includes(l))
  const bins = Math.floor(area) + 1
  const coverage = new Int32Array(bins)
  for (const l of narrow) {
    for (let x = Math.max(0, Math.floor(l.x0 - left)); x < Math.min(bins, Math.floor(l.x1 - left) + 1); x++) coverage[x]++
  }
  const tolerance = Math.max(1, Math.floor(narrow.length / 50))
  const gutters = []
  let x = Math.floor(area * 0.2)
  while (x < Math.floor(area * 0.8)) {
    if (coverage[x] <= tolerance) {
      const start = x
      while (x < bins && coverage[x] <= tolerance) x++
      if (x - start >= 5 && isGutter(narrow, left + start, left + x, area)) gutters.push(left + (start + x) / 2)
    }
    x++
  }
  return gutters
}

function readingOrder(pageLines, gutters) {
  const byY = [...pageLines].sort((a, b) => Math.round(a.base / 2) - Math.round(b.base / 2) || a.x0 - b.x0)
  if (!gutters.length) return byY
  const columnOf = (l) => gutters.filter((g) => (l.x0 + l.x1) / 2 > g).length
  const spansGutter = (l) => gutters.some((g) => l.x0 < g - 2 && l.x1 > g + 2)
  const ordered = []
  let band = []
  const flushBand = () => {
    for (let col = 0; col <= gutters.length; col++) {
      for (const l of band.filter((b) => columnOf(b) === col)) {
        l.column = col
        ordered.push(l)
      }
    }
    band = []
  }
  for (const l of byY) {
    if (spansGutter(l)) {
      flushBand()
      l.column = -1
      ordered.push(l)
    } else band.push(l)
  }
  flushBand()
  return ordered
}

// ------------------------------------------------------------------ figures

const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
]

// Areas covered by drawings and pictures, in top-down page coordinates. Shapes closer
// than 3pt are merged, the way a diagram's boxes, arrows and labels belong together.
async function figureRegions(page, OPS) {
  const ops = await page.getOperatorList()
  const [vx0, , , vy1] = page.view
  const boxes = []
  let ctm = [1, 0, 0, 1, 0, 0]
  const stack = []
  const addBox = (x0, y0, x1, y1) => {
    const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]])
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    boxes.push({ x0: Math.min(...xs) - vx0, x1: Math.max(...xs) - vx0, y0: vy1 - Math.max(...ys), y1: vy1 - Math.min(...ys) })
  }
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const args = ops.argsArray[i]
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0]
    else if (fn === OPS.transform) ctm = mul(args, ctm)
    else if (fn === OPS.paintFormXObjectBegin) {
      // An embedded drawing (a figure made in another program) has its own transform
      // and bounding box; the box itself marks the figure.
      stack.push(ctm)
      if (args?.[0]) ctm = mul(args[0], ctm)
      const bb = args?.[1]
      if (bb && bb.length === 4) addBox(bb[0], bb[1], bb[2], bb[3])
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0]
    else if (fn === OPS.constructPath) {
      const mm = args?.[2]
      if (mm && mm.length === 4 && Number.isFinite(mm[0])) addBox(mm[0], mm[1], mm[2], mm[3])
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
      addBox(0, 0, 1, 1)
    }
  }
  // Ignore anything covering most of the page (a border, a background, a clipping
  // area, or the scan behind an OCR text layer) before merging, so it cannot swallow
  // the real figures; then merge overlapping boxes (3pt tolerance) into clusters.
  const pageArea = (page.view[2] - page.view[0]) * (page.view[3] - page.view[1])
  const small = (r) => (r.x1 - r.x0) * (r.y1 - r.y0) < 0.5 * pageArea
  const clusters = []
  for (const b of boxes.filter(small)) {
    let merged = { ...b }
    for (let j = clusters.length - 1; j >= 0; j--) {
      const c = clusters[j]
      if (merged.x0 - 3 <= c.x1 && c.x0 <= merged.x1 + 3 && merged.y0 - 3 <= c.y1 && c.y0 <= merged.y1 + 3) {
        merged = { x0: Math.min(c.x0, merged.x0), x1: Math.max(c.x1, merged.x1), y0: Math.min(c.y0, merged.y0), y1: Math.max(c.y1, merged.y1) }
        clusters.splice(j, 1)
        j = clusters.length // re-scan: the grown box may now touch earlier clusters
      }
    }
    clusters.push(merged)
  }
  return clusters.filter((r) => r.x1 - r.x0 >= 20 && r.y1 - r.y0 >= 20 && small(r))
}

// Drop labels inside diagrams and pictures. Text inside a drawing is only dropped when
// it reads like labels (short fragments); a box drawn around real paragraphs is kept.
function removeFigureText(regions, pageLines, report) {
  const drop = new Set()
  for (const r of regions) {
    const inside = pageLines.filter((l) => {
      const cx = (l.x0 + l.x1) / 2
      const cy = (l.y0 + l.y1) / 2
      return r.x0 - 2 <= cx && cx <= r.x1 + 2 && r.y0 - 2 <= cy && cy <= r.y1 + 2
    })
    if (!inside.length) continue
    const lengths = inside.map((l) => l.text.length).sort((a, b) => a - b)
    const sentences = inside.filter((l) => SENTENCE_END_RE.test(l.text) && l.text.length > 40).length
    if (lengths[lengths.length >> 1] < 40 && sentences <= Math.floor(inside.length / 4)) inside.forEach((l) => drop.add(l))
  }
  for (const l of drop) report.removed['figure label'].push(l.text)
  return pageLines.filter((l) => !drop.has(l))
}

// ---------------------------------------------------------------- footnotes

function removeFootnotes(pageLines, bodySize, report) {
  const keep = [...pageLines]
  for (const col of new Set(pageLines.map((l) => l.column))) {
    const colLines = pageLines.filter((l) => l.column === col)
    const body = colLines.filter((l) => l.size >= bodySize * 0.93)
    if (!body.length) continue
    const bodyBottom = Math.max(...body.map((l) => l.y1))
    const tail = colLines
      .filter((l) => l.y0 >= bodyBottom - 1 && l.size <= bodySize * SMALL_RATIO && l.y0 > l.pageH * 0.45)
      .sort((a, b) => a.y0 - b.y0)
    // A numbered footnote, or clearly smaller print set apart at the foot of the column.
    if (tail.length && (FOOTNOTE_START_RE.test(tail[0].text) || (tail[0].size <= bodySize * 0.85 && tail[0].y0 - bodyBottom > 0.8 * bodySize))) {
      for (const l of tail) {
        report.removed.footnote.push(l.text)
        keep.splice(keep.indexOf(l), 1)
      }
    }
  }
  return keep
}

// --------------------------------------------------------------- paragraphs

function hyphenVocabulary(pages) {
  const whole = new Map()
  const hyphenated = new Map()
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1)
  for (const page of pages) {
    for (const l of page) {
      const text = l.text.replace(/[-‐‑ ]+$/, '')
      for (const w of text.match(WORD_RE) || []) {
        const word = w.toLowerCase().replace(/[‐‑]/g, '-')
        bump(word.includes('-') ? hyphenated : whole, word)
      }
    }
  }
  return { whole, hyphenated }
}

// If prev ends with a word broken by a hyphen, return the joined text; else null.
export function joinHyphenated(prev, next, vocab, report) {
  if (!LINE_END_HYPHENS.includes(prev.slice(-1)) || prev.length < 2 || !/\p{L}/u.test(prev[prev.length - 2])) return null
  const left = prev.match(/(\p{L}+)[-‐‑]$/u)
  const right = next.match(/^(\p{L}+)/u)
  if (!left || !right) return null
  if (right[1][0] !== right[1][0].toLowerCase()) return prev + next // "anti-\nAmerican"
  const joined = (left[1] + right[1]).toLowerCase()
  const compound = `${left[1]}-${right[1]}`.toLowerCase()
  const inWhole = vocab.whole.get(joined) || 0
  const keepHyphen = ((vocab.hyphenated.get(compound) || 0) > 0 && !inWhole) || (!inWhole && COMPOUND_PREFIXES.has(left[1].toLowerCase()))
  if (keepHyphen) return prev.slice(0, -1) + '-' + next
  if (report) report.hyphensJoined++
  return prev.slice(0, -1) + next
}

function buildParagraphs(ordered, bodySize, vocab, report) {
  const bodyLines = ordered.filter((l) => !l.kind && Math.abs(l.size - bodySize) < 0.6)
  const deltas = []
  for (let i = 1; i < bodyLines.length; i++) {
    const a = bodyLines[i - 1]
    const b = bodyLines[i]
    const d = b.base - a.base
    if (a.page === b.page && a.column === b.column && d > 0 && d < bodySize * 3) deltas.push(d)
  }
  const leading = deltas.length ? median(deltas) : bodySize * 1.2

  const colLeft = new Map()
  const colRight = new Map()
  for (const l of bodyLines) {
    const k = `${l.page}:${l.column}`
    colLeft.set(k, Math.min(colLeft.get(k) ?? l.x0, l.x0))
    colRight.set(k, Math.max(colRight.get(k) ?? l.x1, l.x1))
  }

  const paras = []
  let cur = []
  let curSize = 0
  let prev = null
  // Full-width captions at the top of a page that interrupt a sentence are held back
  // and read after the paragraph they interrupted.
  const floats = []
  const emit = (texts, size) => {
    const text = texts.join(' ').replace(/\s+/g, ' ').trim()
    if (/\p{L}/u.test(text)) paras.push({ kind: 'p', text, size })
  }
  const flush = () => {
    if (cur.length) emit(cur, curSize)
    cur = []
    if (floats.length) {
      emit(floats.map((f) => f.text), floats[0].size)
      floats.length = 0
    }
  }
  const isHeading = (l) => l.size >= bodySize * HEADING_RATIO

  for (const l of ordered) {
    if (l.kind === 'raw') {
      flush()
      paras.push({ kind: 'p', text: l.text, size: bodySize })
      prev = null
      continue
    }
    const interrupts = cur.length && prev && l.column === -1 && !isHeading(l) && !SENTENCE_END_RE.test(cur[cur.length - 1])
    if (interrupts && floats.length < 4 && (floats.length || l.page !== prev.page || l.base < prev.base)) {
      floats.push(l)
      continue
    }
    if (isHeading(l)) {
      flush()
      const last = paras[paras.length - 1]
      if (last && last.kind === 'heading' && prev && isHeading(prev) && Math.abs(last.size - l.size) < 1 && l.page === prev.page) {
        last.text += ' ' + l.text
      } else {
        paras.push({ kind: 'heading', text: l.text, size: l.size })
      }
      prev = l
      continue
    }

    let newPara = !prev || isHeading(prev)
    const tail = cur[cur.length - 1] || ''
    const midWord = prev && cur.length && LINE_END_HYPHENS.includes(tail.slice(-1)) && /\p{L}/u.test(tail[tail.length - 2] || '') && /^\p{Ll}/u.test(l.text)
    if (!newPara && !midWord) {
      // "Wrapped" = jumped to the top of the next column or page.
      const wrapped = l.page !== prev.page || l.base < prev.base - 0.5 * l.size
      const left = colLeft.get(`${l.page}:${l.column}`) ?? l.x0
      const width = (colRight.get(`${l.page}:${l.column}`) ?? l.x1) - left
      const prevEnded = SENTENCE_END_RE.test(prev.text)
      if (!wrapped) {
        const gap = l.base - prev.base
        const indented = l.x0 - left > 0.8 * l.size && prev.x0 - left < 0.5 * l.size
        const prevWidth = prev.x1 - prev.x0
        const shortPrev = prevEnded && prevWidth < 0.8 * width
        const sizeJump = Math.abs(l.size - prev.size) > 0.15 * bodySize
        // A short line with no full stop is a sub-heading, label or list item ("6 Future
        // Work"): it stands apart from the sentence before it and the one after it.
        const isLabel = (x) => x.x1 - x.x0 < 0.6 * width && !SENTENCE_END_RE.test(x.text)
        const labelAfter = isLabel(prev) && /^[\p{Lu}\d]/u.test(l.text)
        const labelBefore = prevEnded && isLabel(l) && /^[\p{Lu}\d]/u.test(l.text)
        newPara = gap > leading * 1.45 || gap < 0 || indented || shortPrev || sizeJump || labelAfter || labelBefore
      } else {
        // Column or page break: keep going if the sentence clearly continues, or if the
        // previous line ran the full width and the next one is not indented.
        const indented = l.x0 - left > 0.8 * l.size
        const prevLeft = colLeft.get(`${prev.page}:${prev.column}`) ?? prev.x0
        const prevRight = colRight.get(`${prev.page}:${prev.column}`) ?? prev.x1
        const prevFull = prev.x1 - prevLeft >= 0.92 * (prevRight - prevLeft)
        const continues = !prevEnded || /^\p{Ll}/u.test(l.text) || (prevFull && !indented)
        newPara = !continues || (indented && prevEnded)
      }
    }
    if (newPara) {
      flush()
      cur = [l.text]
      curSize = l.size
    } else {
      const joined = joinHyphenated(cur[cur.length - 1], l.text, vocab, report)
      if (joined !== null) cur[cur.length - 1] = joined
      else cur.push(l.text)
    }
    prev = l
  }
  flush()

  // Biggest heading size -> h1, everything else -> h2. Paragraphs that end without
  // punctuation (labels, list items) get a full stop so the voice pauses there.
  const headSizes = [...new Set(paras.filter((p) => p.kind === 'heading').map((p) => Math.round(p.size)))].sort((a, b) => b - a)
  for (const p of paras) {
    if (p.kind === 'heading') {
      p.kind = Math.round(p.size) === headSizes[0] ? 'h1' : 'h2'
      p.text = p.text.replace(/\s+/g, ' ').trim()
    } else if (!SENTENCE_END_RE.test(p.text) && /[\p{L}\p{N})\]"'”’]$/u.test(p.text)) {
      p.text += '.'
    }
  }
  return paras.map(({ kind, text }) => ({ kind, text }))
}

// ---------------------------------------------------------------- public API

// OPS: pdfjsLib.OPS, needed to find diagrams (without it, figure labels are kept).
export async function cleanPdf(doc, { OPS = null, keepFootnotes = false, keepHeaders = false, onProgress } = {}) {
  const report = newReport(doc.numPages)
  const pages = []
  const sideways = new Map()
  const figures = []
  for (let i = 0; i < doc.numPages; i++) {
    const page = await doc.getPage(i + 1)
    const { lines, rotated, hasText } = await extractPage(page, i, report)
    figures.push(OPS && lines.length ? await figureRegions(page, OPS) : [])
    if (!lines.length && rotated.join('').length >= 40) {
      sideways.set(i, rotated.join(' ')) // a sideways page (e.g. a landscape table): read it rather than lose it
    } else {
      report.removed['sideways text'].push(...rotated)
    }
    if (!hasText) report.scannedPages.push(i + 1)
    pages.push(lines)
    page.cleanup?.()
    onProgress?.((i + 1) / doc.numPages)
  }
  const allLines = pages.flat()
  const bodySize = weightedMode(allLines.map((l) => [l.size, l.text.length]), 10)
  if (!keepHeaders) removeHeadersFooters(pages, bodySize, report)

  const vocab = hyphenVocabulary(pages)
  const ordered = []
  pages.forEach((pageLines, i) => {
    if (sideways.has(i)) {
      ordered.push({ kind: 'raw', text: normalizeChars(sideways.get(i)).replace(/\s+/g, ' ').trim() })
      return
    }
    if (!pageLines.length) return
    pageLines = removeFigureText(figures[i], pageLines, report)
    const gutters = findGutters(pageLines)
    if (gutters.length) report.multiColumnPages++
    let pageOrdered = mergeSameBaseline(readingOrder(pageLines, gutters))
    if (!keepFootnotes) pageOrdered = removeFootnotes(pageOrdered, bodySize, report)
    ordered.push(...pageOrdered)
  })
  return { paragraphs: buildParagraphs(ordered, bodySize, vocab, report), report }
}

// Editable plain-text form: headings start with "# ", paragraphs are separated by a blank line.
export function toEditableText(paragraphs) {
  return paragraphs.map((p) => (p.kind === 'p' ? p.text : `# ${p.text}`)).join('\n\n') + '\n'
}

export function fromEditableText(text) {
  text = text.replace(/\r\n?/g, '\n')
  // Pasted text often has one paragraph per line and no blank lines at all.
  const separator = /\n\s*\n/.test(text.trim()) ? /\n\s*\n/ : /\n/
  return text
    .split(separator)
    .map((block) => block.replace(/\s*\n\s*/g, ' ').trim())
    .filter((block) => /\p{L}|\p{N}/u.test(block))
    .map((block) => (block.startsWith('#') ? { kind: 'h1', text: block.replace(/^#+\s*/, '') } : { kind: 'p', text: block }))
}
