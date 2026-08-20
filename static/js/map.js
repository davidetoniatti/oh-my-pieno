import { state, updateURL } from "./state.js";
import { priceColor } from "./formatters.js";
import { BRAND_CONFIG } from "./constants.js";

let moveTimeout;
let markerClickHandler = null;

const MOVE_END_DEBOUNCE_MS = 250;
const SEARCH_TRIGGER_FRACTION = 0.25;
const MARKER_BOUNDS_PADDING = 0.2;
const METERS_PER_DEGREE_LAT = 111_320;

function showSearchHereButton() {
  document.getElementById("searchHereBtn")?.classList.remove("hidden");
}

function getViewWidthMeters(center) {
  const bounds = state.map.getBounds();
  const widthDegrees = Math.abs(bounds.getEast() - bounds.getWest());
  return (
    widthDegrees *
    METERS_PER_DEGREE_LAT *
    Math.cos((center.lat * Math.PI) / 180)
  );
}

function isSearchShiftSignificant(center, zoom) {
  if (state.lastSearchZoom !== zoom) return true;
  if (!state.lastSearchCenter) return true;

  const distance = center.distanceTo(state.lastSearchCenter);
  return distance > getViewWidthMeters(center) * SEARCH_TRIGGER_FRACTION;
}

function onMapMoveEnd() {
  clearTimeout(moveTimeout);
  moveTimeout = setTimeout(() => {
    const center = state.map.getCenter();
    const zoom = state.map.getZoom();

    if (isSearchShiftSignificant(center, zoom)) {
      showSearchHereButton();
    }

    syncMarkers();
    updateURL();
  }, MOVE_END_DEBOUNCE_MS);
}

export function initMap(
  onSearch,
  onMarkerClick,
  center = [41.9028, 12.4964],
  zoom = 13,
) {
  markerClickHandler = onMarkerClick;

  state.map = L.map("map", {
    center,
    zoom,
    zoomControl: true,
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
    referrerPolicy: "strict-origin-when-cross-origin",
  }).addTo(state.map);

  state.map.on("click", (e) => {
    onSearch(e.latlng.lat, e.latlng.lng);
  });

  state.map.on("moveend", onMapMoveEnd);

  state.map.on("dblclick", (e) => {
    e.originalEvent.preventDefault();
  });
}

// Brand filtering is client-side only.
// Brand data is already on every station response, so filtering here just
// hides markers.
function matchesBrandFilter(station) {
  const selected = state.selectedBrand;
  if (!selected) return true;

  const brand = (station.brand || "").trim();
  if (selected === BRAND_CONFIG.BUCKET) {
    return (
      !brand || brand === BRAND_CONFIG.BUCKET || !state.topBrands.has(brand)
    );
  }
  return brand === selected;
}

function collectRenderableStations() {
  const bounds = state.map.getBounds().pad(MARKER_BOUNDS_PADDING);
  const items = [];

  for (const station of state.stationsById.values()) {
    if (!station.location || station.selectedPrice == null) continue;

    const id = String(station.id);
    const isSelected = id === state.selectedStationId;

    // The selected station is always kept visible, exempt from both the brand
    // filter and the viewport bounds — otherwise its marker is removed while
    // the panel stays open and #map keeps the has-selection dimming stuck.
    if (!isSelected && !matchesBrandFilter(station)) continue;

    if (
      !isSelected &&
      !bounds.contains([station.location.lat, station.location.lng])
    ) {
      continue;
    }

    items.push({
      id,
      lat: station.location.lat,
      lng: station.location.lng,
      price: station.selectedPrice,
    });
  }

  return items;
}

function computePriceRange(items) {
  if (items.length === 0) {
    return { minPrice: 0, maxPrice: 0 };
  }

  let minPrice = Infinity;
  let maxPrice = -Infinity;

  for (const item of items) {
    if (item.price < minPrice) minPrice = item.price;
    if (item.price > maxPrice) maxPrice = item.price;
  }

  return { minPrice, maxPrice };
}

function createMarkerEntry(item, color, priceText) {
  const icon = L.divIcon({
    className: "",
    html: `
      <div class="price-marker" style="--marker-color:${color}" data-id="${item.id}">
        <span class="marker-price">${priceText}</span>
      </div>
    `,
    iconAnchor: [24, 12],
    iconSize: [48, 24],
  });

  const marker = L.marker([item.lat, item.lng], { icon }).addTo(state.map);

  const root = marker.getElement();
  const el = root?.querySelector(".price-marker") ?? null;
  const priceEl = el?.querySelector(".marker-price") ?? null;

  marker.on("click", () => {
    markerClickHandler?.(item.id);
  });

  return { marker, el, priceEl, color, price: priceText };
}

function updateMarkerEntry(entry, color, priceText) {
  if (entry.color === color && entry.price === priceText) {
    return;
  }

  entry.el?.style.setProperty("--marker-color", color);
  if (entry.priceEl) {
    entry.priceEl.textContent = priceText;
  }

  entry.color = color;
  entry.price = priceText;
}

function upsertMarker(item, minPrice, maxPrice) {
  const id = item.id;
  const color = priceColor(item.price, minPrice, maxPrice);
  const priceText = item.price.toFixed(3);

  if (state.markers.has(id)) {
    updateMarkerEntry(state.markers.get(id), color, priceText);
    return;
  }

  const entry = createMarkerEntry(item, color, priceText);
  state.markers.set(id, entry);
}

function removeStaleMarkers(nextStationIds) {
  for (const [id, entry] of state.markers.entries()) {
    if (nextStationIds.has(String(id))) continue;

    entry.marker.remove();
    state.markers.delete(id);

    if (state.selectedStationId === id) {
      state.selectedStationId = null;
      // Drop the dimming class too, or remaining markers stay faded with
      // nothing selected.
      document.getElementById("map")?.classList.remove("has-selection");
    }
  }
}

export function syncMarkers() {
  if (!state.map) return;

  const renderableStations = collectRenderableStations();
  const { minPrice, maxPrice } = computePriceRange(renderableStations);
  const nextStationIds = new Set();

  for (const item of renderableStations) {
    nextStationIds.add(item.id);
    upsertMarker(item, minPrice, maxPrice);
  }

  removeStaleMarkers(nextStationIds);
}

export function selectMarker(id) {
  const sId = id == null ? null : String(id);

  if (state.selectedStationId && state.markers.has(state.selectedStationId)) {
    const prevEntry = state.markers.get(state.selectedStationId);
    prevEntry.el?.classList.remove("selected");
    prevEntry.marker.setZIndexOffset(0);
  }

  state.selectedStationId = sId;
  const mapEl = document.getElementById("map");

  if (sId && state.markers.has(sId)) {
    const targetEntry = state.markers.get(sId);
    targetEntry.marker.setZIndexOffset(1000);
    targetEntry.el?.classList.add("selected");
    mapEl?.classList.add("has-selection");
  } else {
    mapEl?.classList.remove("has-selection");
  }
}

export function setUserLocationMarker(lat, lng) {
  if (!state.map) return;

  if (state.userLocationMarker) {
    state.userLocationMarker.setLatLng([lat, lng]);
  } else {
    const icon = L.divIcon({
      className: "user-location-marker",
      html: '<div class="user-location-dot"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    state.userLocationMarker = L.marker([lat, lng], {
      icon,
      zIndexOffset: 2000, // Always on top
      interactive: false,
    }).addTo(state.map);
  }
}
