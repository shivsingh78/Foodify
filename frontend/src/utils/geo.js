import axios from 'axios'
import { serverUrl } from '../config'

// Geocoding goes through the backend so the Geoapify key never reaches the browser.
const get = (path, params, signal) =>
  axios.get(`${serverUrl}/api/geo/${path}`, { params, signal, withCredentials: true }).then((r) => r.data.results)

export const searchAddresses = (text, signal) => get('autocomplete', { text, limit: 5 }, signal)

export const reverseGeocode = async (lat, lon, signal) => (await get('reverse', { lat, lon }, signal))[0] ?? null

export const MIN_SEARCH_LENGTH = 3

/** Human-readable message for a failed geocoding request. */
export const geoErrorMessage = (error) => {
  const status = error?.response?.status
  if (status === 429) return 'Too many searches. Please wait a moment and try again.'
  if (status === 503) return 'Address search is not available right now. You can still pick a spot on the map.'
  if (status === 504) return 'Address search timed out. Please try again.'
  return 'Could not search addresses. Check your connection and try again, or pick a spot on the map.'
}

/** Maps a browser geolocation error to a message. */
export const geolocationErrorMessage = (error) => {
  if (error?.code === 1) return 'Location permission was denied. Search for your address or tap the map instead.'
  if (error?.code === 3) return 'Getting your location timed out. Search for your address or tap the map instead.'
  return 'Could not determine your location. Search for your address or tap the map instead.'
}
