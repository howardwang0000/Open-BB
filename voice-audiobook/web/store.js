// store.js: keeps your voice sample and audiobook progress in this browser (IndexedDB),
// so a long book survives a reload or a closed laptop lid. Nothing leaves the computer.
// Every call fails soft: without storage the app still works, it just cannot resume.

const DB_NAME = 'voice-audiobook'
let dbPromise = null

function open() {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('kv')
        req.result.createObjectStore('parts') // key: [jobId, chunkIndex] -> Uint8Array of MP3
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

async function run(storeName, mode, fn) {
  const db = await open()
  if (!db) return undefined
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, mode)
      const req = fn(tx.objectStore(storeName))
      tx.oncomplete = () => resolve(req?.result)
      tx.onerror = tx.onabort = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  })
}

export const getValue = (key) => run('kv', 'readonly', (s) => s.get(key))
export const setValue = (key, value) => run('kv', 'readwrite', (s) => s.put(value, key))

export const savePart = (jobId, index, bytes) => run('parts', 'readwrite', (s) => s.put(bytes, [jobId, index]))

/** All saved MP3 pieces of a job, in order: [{ index, bytes }]. */
export async function loadParts(jobId) {
  const range = IDBKeyRange.bound([jobId, 0], [jobId, Number.MAX_SAFE_INTEGER])
  const keys = (await run('parts', 'readonly', (s) => s.getAllKeys(range))) || []
  const values = (await run('parts', 'readonly', (s) => s.getAll(range))) || []
  return keys.map((k, i) => ({ index: k[1], bytes: values[i] }))
}

/** Forget every job except `keepJobId` (old books take space). */
export async function clearOtherJobs(keepJobId) {
  const keys = (await run('parts', 'readonly', (s) => s.getAllKeys())) || []
  const stale = keys.filter((k) => k[0] !== keepJobId)
  if (stale.length) await run('parts', 'readwrite', (s) => { stale.forEach((k) => s.delete(k)); return null })
}

/** Short fingerprint of strings, numbers and typed arrays (e.g. text + voice + settings). */
export async function hashOf(...values) {
  const blob = new Blob(values.flatMap((v) => [ArrayBuffer.isView(v) ? v : String(v), '\u0000']))
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')
}
