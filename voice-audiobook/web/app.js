// app.js: the page. Four steps: your voice, your document, the voice engine, the audiobook.

import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.min.mjs'
import { cleanPdf, summarize, toEditableText, fromEditableText } from './pdf-clean.js'
import { makeChunks, estimateSeconds } from './chunker.js'
import { smoothChunk, concat } from './smooth-joins.js'
import { SAMPLE_RATE, decodeToMono, prepareVoice, wavBlob, Mp3Writer, concatBytes, formatDuration } from './audio.js'
import * as store from './store.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs'

const MP3_KBPS = 64
const $ = (id) => document.getElementById(id)
const show = (id, on = true) => { $(id).hidden = !on }

const EXAMPLE_TEXT = `# Example

This is example text, so you can try the app straight away. Drop your own PDF in step 2, or replace these words with anything you like.

The river began as a thin silver thread high in the mountains, where the snow never quite melted and the air tasted of stone. Nobody in the valley could say exactly where the source was, and the old maps disagreed with one another.
`

const state = {
  voice: null, // { samples, seconds, id, name }
  engineReady: false,
  engineLoading: null,
  engineVoiceId: null,
  title: 'Example',
  busy: false,
  stopRequested: false,
  wakeLock: null,
  urls: [],
}

// ------------------------------------------------------------------ helpers

function setPill(id, text, kind = '') {
  const el = $(id)
  el.textContent = text
  el.className = `pill ${kind}`.trim()
}

function showError(id, message) {
  const el = $(id)
  el.textContent = message || ''
  el.hidden = !message
}

function setBar(containerId, fraction, label) {
  const box = $(containerId)
  box.hidden = false
  box.querySelector('.bar span').style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`
  const text = box.querySelector('small')
  if (text && label !== undefined) text.textContent = label
}

function objectUrl(blob) {
  const url = URL.createObjectURL(blob)
  state.urls.push(url)
  if (state.urls.length > 6) URL.revokeObjectURL(state.urls.shift())
  return url
}

const mb = (bytes) => `${Math.round(bytes / 1e6).toLocaleString()} MB`
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

// ------------------------------------------------------------ voice engine

const engine = (() => {
  let worker = null
  let nextId = 1
  const pending = new Map()
  const files = new Map()
  let progressHandler = () => {}

  function failAll(message) {
    const err = new Error(message)
    for (const p of pending.values()) p.reject(err)
    pending.clear()
    worker?.terminate()
    worker = null
    state.engineReady = false
    state.engineVoiceId = null
  }

  function ensure() {
    if (worker) return worker
    worker = new Worker(new URL('./tts-worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const m = e.data
      if (m.type === 'progress') {
        files.set(m.file, m)
        progressHandler(files)
        return
      }
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.ok) p.resolve(m)
      else p.reject(new Error(m.error))
    }
    worker.onerror = (e) => {
      e.preventDefault?.()
      failAll(e.message ? `The voice engine stopped: ${e.message}` : 'The voice engine could not start. Check your internet connection and reload the page.')
    }
    return worker
  }

  return {
    call(type, data = {}, transfer = []) {
      return new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        ensure().postMessage({ id, type, ...data }, transfer)
      })
    },
    onProgress(fn) { progressHandler = fn },
  }
})()

async function loadEngine() {
  if (state.engineReady) return true
  if (state.engineLoading) return state.engineLoading
  state.engineLoading = (async () => {
    showError('engine-error', '')
    setPill('engine-pill', 'Downloading', 'busy')
    $('load-btn').disabled = true
    $('engine-status').textContent = 'Downloading the voice engine. The first time takes a while; after that it loads from your browser in seconds.'
    setBar('load-progress', 0, 'Starting…')
    engine.onProgress((files) => {
      let loaded = 0
      let total = 0
      for (const f of files.values()) { loaded += f.loaded || 0; total += f.total || 0 }
      setBar('load-progress', total ? loaded / total : 0, total ? `${mb(loaded)} of ${mb(total)}` : 'Starting…')
    })
    try {
      const { device } = await engine.call('load')
      state.engineReady = true
      show('load-progress', false)
      $('load-btn').hidden = true
      const gpu = device !== 'wasm'
      setPill('engine-pill', gpu ? 'Ready' : 'Ready (slow mode)', gpu ? 'ok' : 'warn')
      $('engine-status').textContent = gpu
        ? 'Ready. It is using your computer’s graphics chip (WebGPU).'
        : 'Ready, but this browser cannot use the graphics chip, so making audio will be slow. Chrome or Safari 26+ on a Mac is much faster.'
      navigator.storage?.persist?.().catch(() => {})
      await syncVoice()
      return true
    } catch (err) {
      setPill('engine-pill', 'Not downloaded', 'warn')
      showError('engine-error', `${err.message} Press the button to try again.`)
      $('load-btn').disabled = false
      $('load-btn').textContent = 'Try again'
      return false
    } finally {
      state.engineLoading = null
    }
  })()
  return state.engineLoading
}

async function syncVoice() {
  if (!state.engineReady || !state.voice || state.engineVoiceId === state.voice.id) return
  await engine.call('voice', { samples: state.voice.samples.slice() })
  state.engineVoiceId = state.voice.id
}

// ----------------------------------------------------------------- voice

function drawWave(samples) {
  const canvas = $('voice-wave')
  const dpr = window.devicePixelRatio || 1
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')
  g.clearRect(0, 0, w, h)
  g.fillStyle = cssVar('--wave') || '#3b4a5e'
  const step = samples.length / w
  let peak = 1e-6
  for (const v of samples) peak = Math.max(peak, Math.abs(v))
  for (let x = 0; x < w; x++) {
    let lo = 0
    let hi = 0
    const end = Math.min(samples.length, Math.floor((x + 1) * step))
    for (let i = Math.floor(x * step); i < end; i++) { lo = Math.min(lo, samples[i]); hi = Math.max(hi, samples[i]) }
    const y0 = h / 2 - (hi / peak) * (h / 2)
    const y1 = h / 2 - (lo / peak) * (h / 2)
    g.fillRect(x, y0, 1, Math.max(1, y1 - y0))
  }
}

function setVoice(voice) {
  state.voice = voice
  show('voice-card')
  $('voice-seconds').textContent = `${voice.seconds.toFixed(1)} s`
  setPill('voice-pill', 'Ready', 'ok')
  requestAnimationFrame(() => drawWave(voice.samples))
  syncVoice().catch((err) => showError('voice-error', err.message))
  refreshResumeHint()
}

async function useVoiceAudio(arrayBuffer, name) {
  showError('voice-error', '')
  try {
    const raw = await decodeToMono(arrayBuffer)
    const { samples, seconds } = prepareVoice(raw)
    const voice = { samples, seconds, name, id: await store.hashOf(samples) }
    setVoice(voice)
    await store.setValue('voice', voice)
  } catch (err) {
    const unreadable = err?.name === 'EncodingError' || /decode/i.test(err?.message || '')
    showError('voice-error', unreadable ? 'That file could not be read as audio. Try a WAV, MP3 or M4A file.' : err.message)
  }
}

let recorder = null
async function toggleRecording() {
  if (recorder) {
    recorder.stop()
    return
  }
  showError('voice-error', '')
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } })
  } catch {
    showError('voice-error', 'The browser did not allow the microphone. Allow it from the icon in the address bar, or choose a recording file instead.')
    return
  }
  const pieces = []
  recorder = new MediaRecorder(stream)
  recorder.ondataavailable = (e) => { if (e.data.size) pieces.push(e.data) }
  const ctx = new AudioContext()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  ctx.createMediaStreamSource(stream).connect(analyser)
  const buf = new Float32Array(analyser.fftSize)
  const started = performance.now()
  let frame = 0
  const tick = () => {
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (const v of buf) sum += v * v
    const level = Math.min(1, Math.sqrt(sum / buf.length) * 6)
    $('record-level').querySelector('span').style.width = `${level * 100}%`
    const elapsed = (performance.now() - started) / 1000
    $('record-timer').textContent = `${elapsed.toFixed(1)} s`
    if (elapsed >= 30 && recorder?.state === 'recording') recorder.stop()
    frame = requestAnimationFrame(tick)
  }
  recorder.onstop = async () => {
    cancelAnimationFrame(frame)
    stream.getTracks().forEach((t) => t.stop())
    ctx.close()
    recorder = null
    $('record-btn').classList.remove('recording')
    $('record-label').textContent = 'Record again'
    show('record-level', false)
    show('record-timer', false)
    const blob = new Blob(pieces, { type: pieces[0]?.type || 'audio/webm' })
    await useVoiceAudio(await blob.arrayBuffer(), 'Recording')
  }
  recorder.start()
  $('record-btn').classList.add('recording')
  $('record-label').textContent = 'Stop'
  show('record-level')
  show('record-timer')
  tick()
}

// -------------------------------------------------------------- document

let saveTimer = 0
function documentChanged() {
  const paragraphs = fromEditableText($('doc-text').value)
  const chunks = makeChunks(paragraphs)
  const words = paragraphs.reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0)
  $('doc-meta').textContent = words
    ? `${words.toLocaleString()} words in ${paragraphs.length.toLocaleString()} paragraphs · about ${formatDuration(estimateSeconds(chunks))} of audio`
    : 'Nothing to read yet.'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    store.setValue('document', { text: $('doc-text').value, title: state.title })
    refreshResumeHint()
  }, 400)
}

function showReport(report) {
  const chips = $('doc-chips')
  chips.replaceChildren(...summarize(report).split(', ').map((t) => Object.assign(document.createElement('span'), { className: 'chip', textContent: t })))
  chips.hidden = false
  const items = []
  for (const [kind, texts] of Object.entries(report.removed)) {
    for (const text of texts.slice(0, 300)) {
      const li = document.createElement('li')
      li.append(Object.assign(document.createElement('span'), { textContent: kind }), text)
      items.push(li)
    }
  }
  $('removed-list').replaceChildren(...items)
  show('removed', items.length > 0)
}

async function openDocument(file) {
  showError('doc-error', '')
  show('doc-chips', false)
  show('removed', false)
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  try {
    if (isPdf) {
      setBar('doc-progress', 0, 'Opening the PDF…')
      const task = pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
      const doc = await task.promise
      const { paragraphs, report } = await cleanPdf(doc, {
        OPS: pdfjsLib.OPS,
        onProgress: (f) => setBar('doc-progress', f, `Reading page ${Math.round(f * doc.numPages)} of ${doc.numPages}`),
      })
      task.destroy()
      show('doc-progress', false)
      if (!paragraphs.length) {
        throw new Error('No text was found in this PDF. It is probably a scan (photos of pages). Copy the text into the box below instead.')
      }
      $('doc-text').value = toEditableText(paragraphs)
      showReport(report)
    } else {
      $('doc-text').value = await file.text()
    }
    state.title = file.name.replace(/\.[^.]+$/, '') || 'Audiobook'
    setPill('doc-pill', state.title, 'ok')
    documentChanged()
  } catch (err) {
    show('doc-progress', false)
    showError('doc-error', err?.name === 'PasswordException' ? 'This PDF is password-protected. Open it, save an unprotected copy, and try again.' : err.message)
  }
}

// -------------------------------------------------------------- audiobook

const speakArgs = (chunk) => ({
  text: chunk.text,
  exaggeration: Number($('expressive').value),
  maxNewTokens: Math.min(1000, Math.round(60 + chunk.text.length * 2.4)),
})

async function speakChunk(chunk) {
  const { samples } = await engine.call('speak', speakArgs(chunk))
  const { audio } = smoothChunk(samples, SAMPLE_RATE, chunk.text)
  return concat([audio, new Float32Array(Math.round(chunk.pause * SAMPLE_RATE))])
}

function setBusy(busy, label = 'Idle') {
  state.busy = busy
  $('lamp').classList.toggle('on', busy)
  $('onair-label').textContent = label
  for (const id of ['sample-btn', 'make-btn', 'record-btn', 'load-btn']) $(id).disabled = busy
  $('doc-text').readOnly = busy
}

function readyToSpeak() {
  showError('make-error', '')
  if (!state.voice) { showError('make-error', 'Record or choose your voice first (step 1).'); return false }
  if (!fromEditableText($('doc-text').value).length) { showError('make-error', 'Add a document or some text first (step 2).'); return false }
  return true
}

async function currentJob() {
  const text = $('doc-text').value
  const chunks = makeChunks(fromEditableText(text))
  const id = await store.hashOf(text, $('expressive').value, state.voice?.id || '')
  return { id, chunks }
}

async function refreshResumeHint() {
  if (state.busy || !state.voice) return
  const { id, chunks } = await currentJob()
  const done = (await store.loadParts(id)).length
  $('make-btn').textContent = done && done < chunks.length ? `Continue the audiobook (${done} of ${chunks.length} done)` : 'Make the audiobook'
  if (done === chunks.length && chunks.length) await showResult(id, chunks.length)
}

async function hearSample() {
  if (!readyToSpeak() || !(await loadEngine())) return
  setBusy(true, 'Recording sample')
  try {
    await syncVoice()
    const chunks = makeChunks(fromEditableText($('doc-text').value)).slice(0, 2)
    const pieces = []
    for (const chunk of chunks) {
      $('now-reading').textContent = chunk.text
      pieces.push(await speakChunk(chunk))
    }
    const player = $('player')
    player.src = objectUrl(wavBlob(concat(pieces)))
    player.hidden = false
    player.play().catch(() => {})
  } catch (err) {
    showError('make-error', err.message)
  } finally {
    setBusy(false)
  }
}

function partsBlob(parts) {
  const ordered = [...parts.entries()].sort((a, b) => a[0] - b[0]).map(([, bytes]) => bytes)
  return new Blob(ordered, { type: 'audio/mpeg' })
}

async function showResult(jobId, total) {
  const parts = new Map((await store.loadParts(jobId)).map((p) => [p.index, p.bytes]))
  if (!parts.size) return
  const blob = partsBlob(parts)
  const url = objectUrl(blob)
  const complete = parts.size === total
  const player = $('player')
  player.src = url
  player.hidden = false
  const link = $('download-link')
  link.href = url
  link.download = `${state.title} (my voice)${complete ? '' : ' - part'}.mp3`
  link.textContent = complete ? `Download MP3 (${mb(blob.size)})` : `Download what's done (${mb(blob.size)})`
  link.hidden = false
}

async function keepAwake(on) {
  try {
    if (on && !state.wakeLock && navigator.wakeLock) state.wakeLock = await navigator.wakeLock.request('screen')
    if (!on && state.wakeLock) { await state.wakeLock.release(); state.wakeLock = null }
  } catch {
    state.wakeLock = null
  }
}

async function makeAudiobook() {
  if (!readyToSpeak() || !(await loadEngine())) return
  const { id: jobId, chunks } = await currentJob()
  await store.clearOtherJobs(jobId)
  const parts = new Map((await store.loadParts(jobId)).map((p) => [p.index, p.bytes]))
  const totalChars = chunks.reduce((n, c) => n + c.text.length, 0)
  let audioSeconds = [...parts.values()].reduce((s, b) => s + (b.length * 8) / (MP3_KBPS * 1000), 0)
  let genSeconds = 0
  let genChars = 0
  let doneChars = chunks.reduce((n, c, i) => n + (parts.has(i) ? c.text.length : 0), 0)
  let audioSecondsThisRun = 0
  let writer = null
  let lastIndex = -1

  const update = () => {
    setBar('job', parts.size / chunks.length)
    $('stat-chunks').textContent = `${parts.size.toLocaleString()} / ${chunks.length.toLocaleString()}`
    $('stat-audio').textContent = formatDuration(audioSeconds)
    $('stat-left').textContent = genChars ? formatDuration(((totalChars - doneChars) * genSeconds) / genChars) : '–'
    $('stat-speed').textContent = genSeconds ? `${(audioSecondsThisRun / genSeconds).toFixed(2)}× real time` : '–'
  }

  state.stopRequested = false
  setBusy(true, 'Recording')
  show('stop-btn')
  $('stop-btn').disabled = false
  show('job')
  show('listen-btn', false)
  await keepAwake(true)
  update()
  try {
    await syncVoice()
    writer = new Mp3Writer(SAMPLE_RATE, MP3_KBPS)
    for (let i = 0; i < chunks.length; i++) {
      if (parts.has(i)) continue
      if (state.stopRequested) break
      $('now-reading').textContent = chunks[i].text
      const started = performance.now()
      const pcm = await speakChunk(chunks[i])
      genSeconds += (performance.now() - started) / 1000
      genChars += chunks[i].text.length
      doneChars += chunks[i].text.length
      let bytes = writer.encode(pcm)
      if (parts.size + 1 === chunks.length) {
        bytes = concatBytes([bytes, writer.flush()])
        writer = null
      }
      parts.set(i, bytes)
      lastIndex = i
      await store.savePart(jobId, i, bytes)
      audioSeconds += pcm.length / SAMPLE_RATE
      audioSecondsThisRun += pcm.length / SAMPLE_RATE
      update()
    }
  } catch (err) {
    showError('make-error', `${err.message} Your progress is saved; press the button to carry on.`)
  } finally {
    // Paused or stopped early: write out what the encoder still holds.
    if (writer && lastIndex >= 0) {
      const merged = concatBytes([parts.get(lastIndex), writer.flush()])
      parts.set(lastIndex, merged)
      await store.savePart(jobId, lastIndex, merged)
    }
    show('stop-btn', false)
    setBusy(false)
    await keepAwake(false)
  }

  const complete = parts.size === chunks.length
  if (complete) $('stat-left').textContent = 'Done'
  $('now-reading').textContent = complete
    ? `Finished: ${formatDuration(audioSeconds)} of audio.`
    : `Paused at sentence ${parts.size + 1} of ${chunks.length}. Press the button to carry on.`
  $('onair-label').textContent = complete ? 'Done' : 'Paused'
  if (complete) await showResult(jobId, chunks.length)
  else show('listen-btn', parts.size > 0)
  refreshResumeHint()
}

// ----------------------------------------------------------------- start

function checkBrowser() {
  const notes = []
  if (!window.isSecureContext) notes.push('Open this page over https:// (or from localhost). Browsers block the microphone and the voice engine on plain http.')
  if (typeof Worker === 'undefined' || typeof OfflineAudioContext === 'undefined' || typeof indexedDB === 'undefined') {
    notes.push('This browser is missing features the app needs. Use a current version of Chrome or Safari.')
  } else if (!('gpu' in navigator)) {
    notes.push('This browser cannot use your graphics chip for the voice engine, so making audio will be very slow. On a Mac, use Chrome, or Safari 26 or later.')
  }
  $('compat').textContent = notes.join(' ')
  show('compat', notes.length > 0)
}

async function start() {
  checkBrowser()
  $('record-btn').addEventListener('click', toggleRecording)
  $('voice-file').addEventListener('change', async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (file) await useVoiceAudio(await file.arrayBuffer(), file.name)
  })
  $('voice-play').addEventListener('click', () => {
    if (state.voice) new Audio(objectUrl(wavBlob(state.voice.samples))).play().catch(() => {})
  })

  const drop = $('drop')
  $('doc-file').addEventListener('change', (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (file) openDocument(file)
  })
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over') })
  drop.addEventListener('dragleave', () => drop.classList.remove('over'))
  drop.addEventListener('drop', (e) => {
    e.preventDefault()
    drop.classList.remove('over')
    const file = e.dataTransfer?.files?.[0]
    if (file) openDocument(file)
  })
  $('doc-text').addEventListener('input', documentChanged)
  const redrawVoice = () => { if (state.voice) drawWave(state.voice.samples) }
  window.addEventListener('resize', redrawVoice)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', redrawVoice)
  $('expressive').addEventListener('change', refreshResumeHint)

  $('load-btn').addEventListener('click', loadEngine)
  $('sample-btn').addEventListener('click', hearSample)
  $('make-btn').addEventListener('click', makeAudiobook)
  $('stop-btn').addEventListener('click', () => {
    state.stopRequested = true
    $('stop-btn').disabled = true
    $('onair-label').textContent = 'Pausing after this sentence'
  })
  $('listen-btn').addEventListener('click', async () => {
    const { id, chunks } = await currentJob()
    await showResult(id, chunks.length)
    $('player').play().catch(() => {})
  })
  window.addEventListener('beforeunload', (e) => {
    if (state.busy) { e.preventDefault(); e.returnValue = '' }
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.busy) keepAwake(true)
  })

  const savedDoc = await store.getValue('document')
  $('doc-text').value = savedDoc?.text || EXAMPLE_TEXT
  if (savedDoc?.title) {
    state.title = savedDoc.title
    setPill('doc-pill', state.title, 'ok')
  }
  documentChanged()
  const savedVoice = await store.getValue('voice')
  if (savedVoice?.samples) setVoice(savedVoice)
  document.documentElement.dataset.ready = 'true'
  show('compat', $('compat').textContent !== '')
}

start()
