import { useEffect, useRef, useState } from 'react'
import { MapKeyNotice, MapTiles } from './MapTiles'
import { MapContainer, Marker, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import '../utils/leafletIcons'
import { geoErrorMessage, MIN_SEARCH_LENGTH, reverseGeocode, searchAddresses } from '../utils/geo'

const INDIA = [20.5937, 78.9629]

function Recenter({ value }) {
  const map = useMap()
  useEffect(() => {
    if (value) map.setView([value.latitude, value.longitude], 16)
  }, [value, map])
  return null
}
function ClickToSelect({ onSelect }) {
  useMapEvents({ click: (e) => onSelect(e.latlng.lat, e.latlng.lng) })
  return null
}

/**
 * Address search + map selection (same Geoapify proxy and Leaflet setup as checkout).
 * `value` is { latitude, longitude } | null; `onChange(place)` receives
 * { latitude, longitude, formatted, city, state } for whichever way the user picked.
 */
function LocationPicker({ value, onChange }) {
  const [text, setText] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [notice, setNotice] = useState('')
  const skip = useRef(false)

  useEffect(() => {
    if (skip.current) { skip.current = false; return }
    const q = text.trim()
    if (q.length < MIN_SEARCH_LENGTH) { setSuggestions([]); return }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const places = await searchAddresses(q, controller.signal)
        setSuggestions(places)
        setNotice(places.length ? '' : 'No matching addresses. Try another search or tap the map.')
      } catch (err) {
        if (!controller.signal.aborted) { setSuggestions([]); setNotice(geoErrorMessage(err)) }
      }
    }, 400)
    return () => { clearTimeout(timer); controller.abort() }
  }, [text])

  const choose = (place) => {
    skip.current = true
    setText(place.formatted)
    setSuggestions([])
    setNotice('')
    onChange(place)
  }
  const pickPoint = async (lat, lon) => {
    setSuggestions([])
    try {
      const place = await reverseGeocode(lat, lon)
      setNotice(place ? '' : 'No address found for that spot; you can edit the fields below.')
      if (place) { skip.current = true; setText(place.formatted) }
      onChange(place ?? { latitude: lat, longitude: lon, formatted: '' })
    } catch (err) {
      setNotice(geoErrorMessage(err))
      onChange({ latitude: lat, longitude: lon, formatted: '' })
    }
  }

  return (
    <div>
      <div className="relative">
        <input className="input" role="combobox" aria-expanded={suggestions.length > 0} aria-label="Search address" autoComplete="off" placeholder="Search the restaurant address…" value={text} onChange={(e) => setText(e.target.value)} />
        {suggestions.length > 0 && (
          <ul role="listbox" className="absolute z-[1000] mt-1 max-h-60 w-full overflow-auto rounded-lg border border-line bg-surface shadow-lg">
            {suggestions.map((p, i) => (
              <li key={`${p.latitude},${p.longitude},${i}`} role="option">
                <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-muted" onClick={() => choose(p)}>{p.formatted}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {notice && <p className="mt-1 text-xs text-muted" role="status">{notice}</p>}
      <div className="mt-2 h-56 overflow-hidden rounded-lg border border-line">
        <MapContainer className="h-full w-full" center={value ? [value.latitude, value.longitude] : INDIA} zoom={value ? 16 : 4}>
          <MapTiles />
          <Recenter value={value} />
          <ClickToSelect onSelect={pickPoint} />
          {value && <Marker position={[value.latitude, value.longitude]} draggable eventHandlers={{ dragend: (e) => { const p = e.target.getLatLng(); pickPoint(p.lat, p.lng) } }} />}
        </MapContainer>
      </div>
      <MapKeyNotice />
      <p className="mt-1 text-xs text-muted">
        {value ? `Selected: ${value.latitude.toFixed(5)}, ${value.longitude.toFixed(5)}` : 'Search, or tap the map to place the pin.'}
      </p>
    </div>
  )
}

export default LocationPicker
