import { SEARCH_CONFIG, HISTORY_CONFIG, STORAGE_KEYS } from "./constants.js";

function getJSONFromStorage(key, defaultValue) {
  try {
    const val = localStorage.getItem(key);
    if (!val) return defaultValue;
    return JSON.parse(val);
  } catch (e) {
    console.error(`Error parsing storage key "${key}":`, e);
    return defaultValue;
  }
}

export const state = {
  map: null,
  markers: new Map(),
  stationsById: new Map(),
  selectedFuelId: null,
  selectedBrand: null,
  topBrands: new Set(),
  radius: SEARCH_CONFIG.DEFAULT_RADIUS,
  selectedStationId: null,
  lang: "en",
  theme: "device",
  requests: {
    searchAbortController: null,
    detailAbortController: null,
    suggestAbortController: null,
  },
  currentStationData: null,
  lastSearchCenter: null,
  lastSearchZoom: null,
  history: getJSONFromStorage(STORAGE_KEYS.HISTORY, []),
  favorites: getJSONFromStorage(STORAGE_KEYS.FAVORITES, []),
  userLocation: null,
  userLocationMarker: null,
};

export function addToHistory(station) {
  const stationId = String(station.id);
  const previous = state.history.find((item) => String(item.id) === stationId);

  let latestDate = previous?.latestDate || null;
  for (const f of station.fuels || []) {
    if (f.insertDate && (!latestDate || f.insertDate > latestDate)) {
      latestDate = f.insertDate;
    }
  }

  const nextEntry = {
    id: stationId,
    brand: station.brand || previous?.brand,
    address: station.address || previous?.address,
    location: station.location || previous?.location,
    latestDate,
    timestamp: Date.now(),
  };

  state.history = [
    nextEntry,
    ...state.history.filter((item) => String(item.id) !== stationId),
  ].slice(0, HISTORY_CONFIG.MAX_SIZE);

  localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(state.history));
}

export function isFavorite(id) {
  return state.favorites.some((f) => String(f.id) === String(id));
}

export function toggleFavorite(station) {
  const stationId = String(station.id);
  const isFav = isFavorite(stationId);

  if (isFav) {
    state.favorites = state.favorites.filter((f) => String(f.id) !== stationId);
  } else {
    // Extract only necessary data for the list
    let latestDate = null;
    for (const f of station.fuels || []) {
      if (f.insertDate && (!latestDate || f.insertDate > latestDate)) {
        latestDate = f.insertDate;
      }
    }

    state.favorites.push({
      id: stationId,
      brand: station.brand,
      address: station.address,
      location: station.location,
      latestDate,
    });
  }

  localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(state.favorites));
  return !isFav;
}

export function getStateFromURL() {
  const params = new URLSearchParams(window.location.search);

  const lat = params.get("lat");
  const lng = params.get("lng");
  const zoom = params.get("zoom");
  const fuel = params.get("fuel");
  const radius = params.get("radius");

  return {
    lat: lat ? parseFloat(lat) : null,
    lng: lng ? parseFloat(lng) : null,
    zoom: zoom ? parseInt(zoom, 10) : null,
    fuel: fuel ? parseInt(fuel, 10) : null,
    radius: radius ? parseInt(radius, 10) : null,
    brand: params.get("brand"),
  };
}

export function updateURL() {
  const params = new URLSearchParams();

  if (state.map) {
    const center = state.map.getCenter();
    params.set("lat", center.lat.toFixed(6));
    params.set("lng", center.lng.toFixed(6));
    params.set("zoom", state.map.getZoom());
  }

  if (state.selectedFuelId) {
    params.set("fuel", state.selectedFuelId);
  }

  if (state.selectedBrand) {
    params.set("brand", state.selectedBrand);
  }

  params.set("radius", state.radius);

  const newRelativePathQuery = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, "", newRelativePathQuery);
}
