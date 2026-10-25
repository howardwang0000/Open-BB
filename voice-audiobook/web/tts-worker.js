// tts-worker.js: runs the Chatterbox voice model in a background thread.
// Model and calls follow Resemble AI's own browser demo
// (github.com/resemble-ai/transformersjs-chatterbox-demo).
//
// Messages in:  { id, type: 'load' }
//               { id, type: 'voice', samples: Float32Array (24 kHz mono) }
//               { id, type: 'speak', text, exaggeration, maxNewTokens }
// Messages out: { id, ok: true, ...result } or { id, ok: false, error }
//               { type: 'progress', file, loaded, total }  while downloading

import { AutoProcessor, ChatterboxModel, Tensor } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js'

const MODEL_ID = 'onnx-community/chatterbox-ONNX'

// Only the language model has quantized variants; the other parts are fp32 only.
const DTYPES = {
  'webgpu-f16': { embed_tokens: 'fp32', speech_encoder: 'fp32', language_model: 'q4f16', conditional_decoder: 'fp32' },
  webgpu: { embed_tokens: 'fp32', speech_encoder: 'fp32', language_model: 'q4', conditional_decoder: 'fp32' },
  wasm: { embed_tokens: 'fp32', speech_encoder: 'fp32', language_model: 'q4', conditional_decoder: 'fp32' },
}

let model = null
let processor = null
let speaker = null

async function gpuMode() {
  try {
    const adapter = await navigator.gpu?.requestAdapter()
    if (!adapter) return null
    return adapter.features.has('shader-f16') ? 'webgpu-f16' : 'webgpu'
  } catch {
    return null
  }
}

async function loadModel(mode) {
  return ChatterboxModel.from_pretrained(MODEL_ID, {
    device: mode === 'wasm' ? 'wasm' : 'webgpu',
    dtype: DTYPES[mode],
    progress_callback: (p) => {
      if (p.status === 'progress' || p.status === 'done') {
        self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded ?? p.total ?? 0, total: p.total ?? 0 })
      }
    },
  })
}

async function load() {
  if (model) return { device: model.__mode }
  processor ??= await AutoProcessor.from_pretrained(MODEL_ID)
  let mode = await gpuMode()
  if (mode) {
    try {
      model = await loadModel(mode)
    } catch (err) {
      console.warn('WebGPU failed, falling back to WASM:', err)
      mode = null
    }
  }
  if (!model) {
    mode = 'wasm'
    model = await loadModel(mode)
  }
  model.__mode = mode
  return { device: mode }
}

async function setVoice(samples) {
  if (!model) throw new Error('The voice model is not loaded yet.')
  speaker = await model.encode_speech(new Tensor('float32', samples, [1, samples.length]))
  return {}
}

async function speak({ text, exaggeration = 0.5, maxNewTokens = 400 }) {
  if (!model || !processor) throw new Error('The voice model is not loaded yet.')
  if (!speaker) throw new Error('Add your voice recording first.')
  const inputs = await processor._call(text)
  const waveform = await model.generate({ ...inputs, ...speaker, exaggeration, max_new_tokens: maxNewTokens })
  return { samples: Float32Array.from(waveform.data) }
}

self.addEventListener('message', async (e) => {
  const { id, type } = e.data
  try {
    let result
    if (type === 'load') result = await load()
    else if (type === 'voice') result = await setVoice(e.data.samples)
    else if (type === 'speak') result = await speak(e.data)
    else throw new Error(`Unknown request: ${type}`)
    const transfer = result.samples ? [result.samples.buffer] : []
    self.postMessage({ id, ok: true, ...result }, transfer)
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || String(err) })
  }
})
