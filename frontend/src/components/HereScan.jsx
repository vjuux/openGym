// "What's here?": photos in, a list of kit out, every chip yours to flip, one Save. Photos are read
// one at a time, so each one adds to the list as soon as it lands. They live in memory only and are
// re-encoded before they leave the phone, which drops their location data.
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { KIT_IDS, kitLabel } from '../lib/kit.js'
import { isKeyProblem, kitFromScan, providerForKey, scanPhotos } from '../lib/gym-scan.js'
import { decodeImage, encodeImage } from '../lib/media-ingest.js'
import { nativeFetch } from '../lib/capacitor-fetch.js'
import { secureGet, secureRemove, secureSet } from '../lib/coach-secrets.js'

const KEY_NAME = 'spot.apiKey'
// A key baked into a personal build at build time (docs/dev/spot.md). Never put one in a file in
// this repository: the fork is public. A build without it asks on the phone instead.
const BUILT_IN_KEY = import.meta.env.VITE_SPOT_AI_KEY || ''
const EDGE_PX = 1280
const QUALITY = 0.8

const toBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).split(',')[1])
  r.onerror = reject
  r.readAsDataURL(blob)
})

export async function photoForScan(file) {
  const pic = await decodeImage(file, file.type || 'image/jpeg')
  try {
    const out = await encodeImage(pic, EDGE_PX, QUALITY)
    return { mime: out.mime, data: await toBase64(out.blob), thumb: URL.createObjectURL(out.blob) }
  } finally { pic.close() }
}

export default function HereScan({ place, title, startKit, startName, onSave, close }) {
  const [photos, setPhotos] = useState([])
  const [kit, setKit] = useState(() => new Set(startKit))
  const [name, setName] = useState(startName)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(0)
  const [note, setNote] = useState('')
  const [key, setKey] = useState(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [saving, setSaving] = useState(false)
  // Flipped by hand stays flipped: a later photo may add kit, never undo your choice.
  const flipped = useRef(new Set())
  const waiting = useRef([])
  const camera = useRef(null)
  const gallery = useRef(null)

  useEffect(() => {
    secureGet(KEY_NAME).then(v => setKey(v || BUILT_IN_KEY)).catch(() => setKey(BUILT_IN_KEY))
    return () => { photos.forEach(p => URL.revokeObjectURL(p.thumb)) }
  }, [])

  const read = async (photo, useKey) => {
    setBusy(n => n + 1)
    setNote('')
    try {
      const scan = await scanPhotos([photo], { key: useKey, fetcher: nativeFetch })
      const found = kitFromScan(scan)
      setKit(prev => {
        const next = new Set(prev)
        for (const id of found) if (!flipped.current.has(id)) next.add(id)
        return next
      })
      if (!found.length) setNote('Nothing recognised in that one. Try a wider shot, or pick below.')
    } catch (e) {
      if (isKeyProblem(e)) {
        // Forget it and ask again, or a mistyped key would be stuck here for good.
        await secureRemove(KEY_NAME).catch(() => {})
        waiting.current.push(photo)
        setKey('')
        setNote('That key was refused. Paste another one.')
      } else setNote(`Could not read that photo: ${String(e?.message || e).slice(0, 120)}`)
    } finally {
      setBusy(n => n - 1)
    }
  }

  const onFiles = async e => {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    for (const file of files) {
      let photo
      try { photo = await photoForScan(file) } catch { setNote('That photo could not be opened.'); continue }
      setPhotos(list => [...list, photo])
      if (key) read(photo, key)
      else waiting.current.push(photo)
    }
  }

  const saveKey = async () => {
    const k = keyDraft.trim()
    if (!providerForKey(k)) { setNote('That does not look like a Gemini, OpenAI or Claude key.'); return }
    await secureSet(KEY_NAME, k).catch(() => {})
    setKey(k)
    setKeyDraft('')
    setNote('')
    for (const photo of waiting.current.splice(0)) read(photo, k)
  }

  const flip = id => {
    flipped.current.add(id)
    setKit(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const on = KIT_IDS.filter(id => kit.has(id))
  const off = KIT_IDS.filter(id => !kit.has(id))
  const save = async () => {
    setSaving(true)
    try { await onSave({ name: name.trim() || title, kit: on }); close() } finally { setSaving(false) }
  }

  return (
    <div className="here-scan">
      <h3>What's here?</h3>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onFiles} aria-label="Take a photo" />
      <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={onFiles} aria-label="Choose photos" />

      <div className="here-photos">
        {photos.map(p => <img key={p.thumb} src={p.thumb} alt="" />)}
        <button type="button" className="here-snap" onClick={() => camera.current?.click()}>
          <Icon name="camera" /><span>{photos.length ? 'Another' : 'Snap'}</span>
        </button>
      </div>
      {!photos.length && <p className="here-hint">A few wide shots are enough. It remembers this place.</p>}
      <button type="button" className="here-link" onClick={() => gallery.current?.click()}>Choose photos</button>

      {key === '' && photos.length > 0 && (
        <div className="here-key">
          <p>To read photos, paste an AI key (Gemini, OpenAI or Claude). It stays on this phone.</p>
          <div>
            <input value={keyDraft} onChange={e => setKeyDraft(e.target.value)} placeholder="AI key" autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label="AI key" />
            <button type="button" onClick={saveKey} disabled={!keyDraft.trim()}>Use</button>
          </div>
        </div>
      )}
      {busy > 0 && <p className="here-hint" role="status">Reading…</p>}
      {note && <p className="here-hint" role="status">{note}</p>}

      <div className="here-chips">
        {on.map(id => <button type="button" key={id} className="here-chip on" aria-pressed="true" onClick={() => flip(id)}>{kitLabel(id)}</button>)}
        {!on.length && <span className="here-hint">Nothing yet, so body weight only.</span>}
      </div>
      {more
        ? <div className="here-chips">{off.map(id => <button type="button" key={id} className="here-chip" aria-pressed="false" onClick={() => flip(id)}>{kitLabel(id)}</button>)}</div>
        : <button type="button" className="here-link" onClick={() => setMore(true)}>Add by hand</button>}

      <label className="here-name">
        <span>Name</span>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder={title} />
      </label>
      <button type="button" className="here-go" onClick={save} disabled={saving || busy > 0}>Save this place</button>
    </div>
  )
}
