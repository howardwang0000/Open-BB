// tts-worker.js: runs the Chatterbox voice model in a background thread.
// Model and calls follow Resemble AI's own browser demo
// (github.com/resemble-ai/transformersjs-chatterbox-demo).
//
// Messages in:  { id, type: 'load', files? }   files: { 'config.json': File, 'onnx/…': File, … }
//                 from a folder on this computer (see ../get_voice_engine.command);
//                 without it the model is downloaded from Hugging Face.
//               { id, type: 'voice', samples: Float32Array (24 kHz mono) }
//               { id, type: 'speak', text, exaggeration, maxNewTokens }
// Messages out: { id, ok: true, ...result } or { id, ok: false, error }
//               { type: 'progress', file, loaded, total }  while downloading or reading files

import { AutoProcessor, ChatterboxModel, Tensor, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js'

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

// Serve the model from files on this computer through transformers.js's custom-cache
// hook: every file it asks for (by Hugging Face URL or local path) comes from the
// chosen folder, and nothing is downloaded or copied into browser storage.
function useLocalFiles(files) {
  const lookup = (key) => {
    const m = String(key).match(/chatterbox-ONNX\/(?:resolve\/[^/]+\/)?(.+)$/)
    return m ? files[decodeURIComponent(m[1])] : undefined
  }
  env.useCustomCache = true
  env.customCache = {
    async match(key) {
      const file = lookup(key)
      return file ? new Response(file, { headers: { 'content-length': String(file.size) } }) : undefined
    },
    async put() {},
  }
  // transformers.js insists one of these is on; local lookups only happen for files the
  // folder lacks, and then fail with a message naming the missing file.
  env.allowLocalModels = true
  env.allowRemoteModels = false
}

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

async function load(files) {
  if (model) return { device: model.__mode }
  if (files) useLocalFiles(files)
  processor ??= await AutoProcessor.from_pretrained(MODEL_ID)
  let mode = await gpuMode()
  // A folder may hold only one of the two language-model variants.
  if (files && mode === 'webgpu-f16' && !files['onnx/language_model_q4f16.onnx']) mode = 'webgpu'
  if (files && mode !== 'webgpu-f16' && !files['onnx/language_model_q4.onnx']) {
    throw new Error('The engine folder is missing onnx/language_model_q4.onnx, which this browser needs. Run get_voice_engine.command again.')
  }
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
    if (type === 'load') result = await load(e.data.files)
    else if (type === 'voice') result = await setVoice(e.data.samples)
    else if (type === 'speak') result = await speak(e.data)
    else throw new Error(`Unknown request: ${type}`)
    const transfer = result.samples ? [result.samples.buffer] : []
    self.postMessage({ id, ok: true, ...result }, transfer)
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || String(err) })
  }
})
