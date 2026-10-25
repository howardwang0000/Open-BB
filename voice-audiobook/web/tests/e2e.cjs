// End-to-end test of the page in a real browser (Chromium via Playwright).
// The CDN libraries are served from node_modules (same pinned versions) and the voice
// model is replaced by tests/fake-transformers.js, so this runs offline in ~1 minute.
//
//   npm install && npx playwright install chromium   (once)
//   PYTHON=python3-with-reportlab node tests/e2e.cjs [screenshot-dir]

const { chromium } = require('playwright')
const { execFileSync, spawn } = require('node:child_process')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const WEB = path.resolve(__dirname, '..')
const NM = path.join(WEB, 'node_modules')
const PORT = 8765
const shots = process.argv[2]

const CDN = {
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.min.mjs': path.join(NM, 'pdfjs-dist/build/pdf.min.mjs'),
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs': path.join(NM, 'pdfjs-dist/build/pdf.worker.min.mjs'),
  'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js': path.join(NM, 'lamejs/lame.min.js'),
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js': path.join(__dirname, 'fake-transformers.js'),
}

function speechWav(file, seconds) {
  const sr = 24000
  const n = Math.round(seconds * sr)
  const lead = Math.round(0.5 * sr)
  const buf = Buffer.alloc(44 + (n + 2 * lead) * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + (n + 2 * lead) * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24)
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36)
  buf.writeUInt32LE((n + 2 * lead) * 2, 40)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const v = 0.3 * (0.35 + 0.65 * Math.abs(Math.sin(2 * Math.PI * 4 * t))) * Math.sin(2 * Math.PI * 150 * t)
    buf.writeInt16LE(Math.round(v * 32767), 44 + (lead + i) * 2)
  }
  fs.writeFileSync(file, buf)
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'va-e2e-'))
  execFileSync(process.env.PYTHON || 'python3', [path.join(WEB, '../tests/make_sample_pdfs.py'), tmp])
  speechWav(path.join(tmp, 'me.wav'), 9)
  const expectedBook = JSON.parse(fs.readFileSync(path.join(tmp, 'book.expected.json'), 'utf8'))

  const server = spawn(process.env.PYTHON || 'python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', WEB], { stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 800))
  const browser = await chromium.launch()
  const problems = []
  try {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1100, height: 900 } })
    await context.route('https://cdn.jsdelivr.net/**', (route) => {
      const file = CDN[route.request().url()]
      if (!file) return route.abort()
      route.fulfill({ path: file, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } })
    })
    await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ body: '', contentType: 'text/css' }))
    const page = await context.newPage()
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`) })
    const url = `http://127.0.0.1:${PORT}/index.html`
    await page.goto(url)
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true')

    // Opens in a working state with example text.
    assert.match(await page.inputValue('#doc-text'), /^# Example/)
    assert.match(await page.textContent('#doc-meta'), /words/)

    // 1. Voice
    await page.setInputFiles('#voice-file', path.join(tmp, 'me.wav'))
    await page.waitForFunction(() => document.querySelector('#voice-pill').textContent === 'Ready')
    const seconds = parseFloat(await page.textContent('#voice-seconds'))
    assert.ok(seconds > 8.5 && seconds < 10, `voice trimmed to the speech: ${seconds}`)

    // 2. Document
    await page.setInputFiles('#doc-file', path.join(tmp, 'book.pdf'))
    await page.waitForFunction(() => document.querySelector('#doc-pill').textContent === 'book')
    const text = await page.inputValue('#doc-text')
    const want = expectedBook.map((t) => (/^Chapter (One|Two)$/.test(t) ? `# ${t}` : t)).join('\n\n') + '\n'
    assert.equal(text, want)
    const chips = await page.textContent('#doc-chips')
    assert.match(chips, /3 page numbers removed/)
    assert.match(chips, /2 footnotes removed/)
    if (shots) await page.screenshot({ path: path.join(shots, 'desktop-light.png'), fullPage: true })

    // Things that belong to later steps stay out of sight until they apply.
    for (const id of ['#stop-btn', '#job', '#listen-btn', '#download-link', '#load-progress', '#doc-progress']) {
      assert.equal(await page.isVisible(id), false, `${id} should be hidden`)
    }

    // 3. Engine
    await page.click('#load-btn')
    await page.waitForFunction(() => /Ready/.test(document.querySelector('#engine-pill').textContent))

    // 4a. Sample
    await page.click('#sample-btn')
    await page.waitForFunction(() => document.querySelector('#player').src.startsWith('blob:') && !document.querySelector('#sample-btn').disabled)

    // 4b. Make, pause part-way, reload, resume
    await page.click('#make-btn')
    await page.waitForFunction(() => parseInt(document.querySelector('#stat-chunks').textContent) >= 4)
    await page.click('#stop-btn')
    await page.waitForFunction(() => document.querySelector('#onair-label').textContent === 'Paused')
    const pausedAt = parseInt(await page.textContent('#stat-chunks'))
    assert.ok(await page.isVisible('#listen-btn'))
    await page.reload()
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true')
    await page.waitForFunction(() => /Continue the audiobook/.test(document.querySelector('#make-btn').textContent))
    const label = await page.textContent('#make-btn')
    assert.match(label, new RegExp(`\\(${pausedAt} of \\d+ done\\)`))
    const total = parseInt(label.match(/of (\d+) done/)[1])
    await page.click('#make-btn')
    await page.waitForFunction(() => document.querySelector('#onair-label').textContent === 'Done', null, { timeout: 120000 })
    assert.equal(await page.textContent('#stat-chunks'), `${total} / ${total}`)
    if (shots) await page.screenshot({ path: path.join(shots, 'desktop-done.png'), fullPage: true })

    // The MP3 decodes, and is as long as the speech plus the designed pauses.
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download-link')])
    const mp3 = path.join(tmp, 'book.mp3')
    await download.saveAs(mp3)
    assert.match(download.suggestedFilename(), /^book \(my voice\)\.mp3$/)
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=sample_rate,channels,codec_name', '-of', 'json', mp3]))
    const duration = parseFloat(info.format.duration)
    const stream = info.streams[0]
    assert.equal(stream.codec_name, 'mp3')
    assert.equal(stream.sample_rate, '24000')
    const chars = expectedBook.join(' ').length
    console.log(`MP3: ${duration.toFixed(1)} s for ${total} sentences (${chars} characters), paused at ${pausedAt} and resumed`)
    assert.ok(duration > chars * 0.065 * 0.9 && duration < chars * 0.065 + total * 1.3, `duration ${duration}`)

    // Phone width, dark theme.
    if (shots) {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.waitForTimeout(200)
      await page.screenshot({ path: path.join(shots, 'phone-dark.png'), fullPage: true })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      assert.equal(overflow, 0, 'no sideways scrolling at phone width')
    }
    assert.deepEqual(problems.filter((p) => !/standardFontDataUrl|Failed to load resource/.test(p)), [])
    console.log('e2e: all checks passed')
  } finally {
    await browser.close()
    server.kill()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
