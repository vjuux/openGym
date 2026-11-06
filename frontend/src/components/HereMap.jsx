// The full-screen map behind the Here screen: your dot and the places near you. Leaflet is already
// in the app for the gym reminder's little map (components/GymMap.jsx) and loads only when opened.
// The tiles are OSM's own, drained of colour in CSS so the only colour on screen is what you can tap.
//
// ponytail: OSM's public tiles suit one person. Past that, their usage policy wants a tile host of
// our own; only TILES.url changes.
import { useEffect, useRef } from 'react'
import { TILES } from '../lib/gym-places.js'

// The card covers the bottom of the screen, so a point meant to look centred sits higher up.
const LIFT = 0.2

export default function HereMap({ pos, places, selectedId, onSelect, recenter }) {
  const host = useRef(null)
  const live = useRef(null)
  const cb = useRef(onSelect)
  cb.current = onSelect
  // Leaflet loads after the first render, and by then these have often moved on.
  const latest = useRef(null)
  latest.current = { pos, places, selectedId }

  const show = (ll, zoom) => {
    const m = live.current?.map
    if (!m) return
    const z = zoom ?? m.getZoom()
    const lifted = m.unproject(m.project(ll, z).add([0, (host.current?.clientHeight || 0) * LIFT]), z)
    m.setView(lifted, z)
  }

  useEffect(() => {
    let gone = false, resize = null
    Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(([mod]) => {
      const L = mod.default || mod
      if (gone || !host.current) return
      const map = L.map(host.current, { zoomControl: false, attributionControl: true, zoomSnap: 0.5 }).setView(pos ? [pos.lat, pos.lng] : [30, 0], pos ? 15 : 3)
      map.attributionControl.setPrefix(false)
      L.tileLayer(TILES.url, { maxZoom: TILES.maxZoom, attribution: TILES.attribution }).addTo(map)
      map.on('click', () => cb.current?.(null))
      live.current = { L, map, pins: L.layerGroup().addTo(map), dot: null, centred: false, touched: false }
      map.on('dragstart', () => { if (live.current) live.current.touched = true })
      setPins()
      setDot()
      // The page may still be sliding in, and a phone rotates: refit, and recentre unless you moved it.
      resize = new ResizeObserver(() => {
        const m = live.current
        if (!m) return
        map.invalidateSize({ pan: false })
        const { pos: now, places: list, selectedId: picked } = latest.current
        const on = list.find(p => p.id === picked) || now
        if (on && !m.touched) show([on.lat, on.lng])
      })
      resize.observe(host.current)
    }).catch(() => {})
    return () => { gone = true; resize?.disconnect(); live.current?.map.remove(); live.current = null }
  }, [])

  const setPins = () => {
    const m = live.current
    if (!m) return
    const { places: list, selectedId: picked } = latest.current
    m.pins.clearLayers()
    for (const p of list) {
      const on = p.id === picked
      const cls = `here-pin${on ? ' on' : ''}${p.kind === 'saved' ? ' saved' : ''}${p.known ? ' known' : ''}`
      const size = on ? 22 : 14
      const marker = m.L.marker([p.lat, p.lng], {
        icon: m.L.divIcon({ className: cls, iconSize: [size, size] }),
        title: p.name || 'Place to train',
        zIndexOffset: on ? 1000 : 0,
      })
      marker.on('click', e => { m.L.DomEvent.stopPropagation(e); cb.current?.(p.id) })
      m.pins.addLayer(marker)
    }
  }
  useEffect(setPins, [places, selectedId])

  const setDot = () => {
    const m = live.current
    const { pos } = latest.current
    if (!m || !pos) return
    if (!m.dot) {
      m.dot = m.L.marker([pos.lat, pos.lng], { icon: m.L.divIcon({ className: 'here-dot', iconSize: [18, 18] }), interactive: false, keyboard: false, zIndexOffset: 500 }).addTo(m.map)
    } else m.dot.setLatLng([pos.lat, pos.lng])
    if (!m.centred) { m.centred = true; show([pos.lat, pos.lng], 15) }
  }
  useEffect(setDot, [pos?.lat, pos?.lng])

  // A picked place comes into view above the card.
  useEffect(() => {
    const p = selectedId && places.find(x => x.id === selectedId)
    if (p) show([p.lat, p.lng])
  }, [selectedId])

  useEffect(() => {
    if (!recenter || !pos) return
    if (live.current) live.current.touched = false
    show([pos.lat, pos.lng], 15)
  }, [recenter])

  return <div className="here-map" ref={host} role="application" aria-label="Map of places to train near you" />
}
