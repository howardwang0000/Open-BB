// Test double for @huggingface/transformers, served in place of the CDN module by
// e2e.cjs. Behaves like Chatterbox from the outside: a "download" with progress,
// encode_speech(), and generate() returning a waveform roughly as long as the text,
// with the imperfections the real model has (random silence before and after the
// speech, varying loudness, now and then a trailing mumble).

export class Tensor {
  constructor(type, data, dims) {
    this.type = type
    this.data = data
    this.dims = dims
  }
}

export const env = {}

export class AutoProcessor {
  static async from_pretrained() {
    return { _call: async (text) => ({ input_ids: new Tensor('int64', new BigInt64Array(text.length), [1, text.length]), __text: text }) }
  }
}

let seed = 7
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const SR = 24000

export class ChatterboxModel {
  static async from_pretrained(_id, { progress_callback } = {}) {
    for (const [file, total] of [['language_model_q4.onnx', 400e6], ['conditional_decoder.onnx', 700e6], ['speech_encoder.onnx', 400e6]]) {
      for (let f = 0; f <= 1; f += 0.25) progress_callback?.({ status: 'progress', file, loaded: total * f, total })
      progress_callback?.({ status: 'done', file, loaded: total, total })
    }
    return new ChatterboxModel()
  }

  async encode_speech(audio) {
    if (!(audio.data instanceof Float32Array) || audio.dims[1] < SR * 3) throw new Error('fake: voice sample too short')
    return { audio_features: 1, audio_tokens: 2, speaker_embeddings: 3, speaker_features: 4 }
  }

  async generate({ __text: text, speaker_embeddings, exaggeration, max_new_tokens }) {
    if (speaker_embeddings !== 3) throw new Error('fake: no speaker')
    if (typeof exaggeration !== 'number' || !(max_new_tokens > 0)) throw new Error('fake: bad arguments')
    await new Promise((r) => setTimeout(r, 5))
    const speech = Math.round(text.length * 0.065 * SR)
    const lead = Math.round(random() * 0.3 * SR)
    const tail = Math.round(random() * 0.8 * SR)
    const level = 0.05 + random() * 0.15
    const mumble = random() < 0.3 ? Math.round(0.2 * SR) : 0
    const out = new Float32Array(lead + speech + tail + mumble)
    for (let i = 0; i < speech; i++) {
      const t = i / SR
      const env = Math.min(1, i / 360, (speech - i) / 360) * (0.35 + 0.65 * Math.abs(Math.sin(2 * Math.PI * 3.5 * t)))
      out[lead + i] = level * env * (Math.sin(2 * Math.PI * 170 * t) + 0.4 * Math.sin(2 * Math.PI * 340 * t))
    }
    for (let i = 0; i < mumble; i++) out[lead + speech + tail + i] = 0.003 * Math.sin((2 * Math.PI * 90 * i) / SR)
    return new Tensor('float32', out, [1, out.length])
  }
}
