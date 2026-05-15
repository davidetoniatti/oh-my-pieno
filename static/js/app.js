import { state, getStateFromURL, updateURL, addToHistory, toggleFavorite } from "./state.js";
import { hasLocale, t } from "./i18n.js";
import {
  searchStations,
  geocodeAddress,
  fetchStationDetails,
} from "./api.js";
import {
  initMap,
  syncMarkers,
  selectMarker,
  setUserLocationMarker,
} from "./map.js";
import {
  updateUILanguage,
  closePanelUI,
  toggleCollectionPanel,
  closeCollectionPanel,
  renderPanel,
  showToast,
  bindCollectionEvents,
  renderStationList,
} from "./ui.js";
import { Sheet } from "./Sheet.js";
import { checkTutorial } from "./tutorial.js";
import { bindKeyboardShortcuts, openSettingsModal } from "./keyboard.js";
import {
  TIMEOUTS,
  MAP_CONFIG,
  SEARCH_CONFIG,
  STORAGE_KEYS,
  BRAND_CONFIG,
  FUELS,
} from "./constants.js";
import { elements, isMobileView } from "./dom.js";

document.addEventListener("DOMContentLoaded", bootstrapApp);

export function closePanel() {
  closePanelUI();
  state.currentStationData = null;
  selectMarker(null);
}

export function toggleHistoryPanel() {
  toggleCollectionPanel(elements.historyPanel, elements.historyToggle, () => {
    renderStationList(state.history, elements.historyList, "no_history");
  });
}

export function toggleFavoritesPanel() {
  toggleCollectionPanel(elements.favoritesPanel, elements.favoritesToggle, () => {
    renderStationList(state.favorites, elements.favoritesList, "no_favorites");
  });
}

export function closeHistoryPanel() {
  closeCollectionPanel(elements.historyPanel, elements.historyToggle);
}

export function closeFavoritesPanel() {
  closeCollectionPanel(elements.favoritesPanel, elements.favoritesToggle);
}

async function bootstrapApp() {
  const browserLang = navigator.language.split("-")[0];
  if (hasLocale(browserLang)) state.lang = browserLang;

  const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || "device";
  setTheme(savedTheme);

  // Listen for live system theme changes
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (state.theme === "device") {
        applyThemeByMode("device");
      }
    });

  // Responsive Controls Slots
  const mq = window.matchMedia("(max-width: 900px)");
  const placeControls = (e) => {
    if (e.matches) {
      elements.mobileControlsSlot.appendChild(elements.controls);
    } else {
      elements.desktopControlsSlot.appendChild(elements.controls);
    }
  };
  placeControls(mq);
  mq.addEventListener("change", placeControls);

  updateUILanguage();

  const urlState = getStateFromURL();
  const validRadii = [...elements.radiusSelect.options].map((o) =>
    parseInt(o.value, 10),
  );
  if (urlState.radius && validRadii.includes(urlState.radius)) {
    state.radius = urlState.radius;
    elements.radiusSelect.value = state.radius;
  }

  const startLat = urlState.lat || MAP_CONFIG.DEFAULT_LAT;
  const startLng = urlState.lng || MAP_CONFIG.DEFAULT_LNG;
  const startZoom = urlState.zoom || MAP_CONFIG.DEFAULT_ZOOM;

  initMap(performSearch, openStationById, [startLat, startLng], startZoom);

  loadFuels(urlState.fuel);
  if (urlState.brand) state.selectedBrand = urlState.brand;
  bindBrandSelect();
  bindControls();
  bindCollectionEvents(elements.historyList, openStationById);
  bindCollectionEvents(elements.favoritesList, openStationById);
  bindKeyboardShortcuts();
  new Sheet("panel", "bottom");
  new Sheet("historyPanel", "bottom");
  new Sheet("favoritesPanel", "bottom");
  new Sheet("controls", "top");

  // If no location in URL, try geolocating
  if (!urlState.lat && !urlState.lng && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        state.userLocation = { lat: latitude, lng: longitude };
        setUserLocationMarker(latitude, longitude);
        state.map.setView([latitude, longitude], MAP_CONFIG.DEFAULT_ZOOM);
        performSearch(latitude, longitude);
      },
      () => {
        // Fallback to default search if geo fails
        performSearch(startLat, startLng);
      },
      { timeout: TIMEOUTS.GEO_MS },
    );
  } else {
    performSearch(startLat, startLng);
  }
}

export function setTheme(mode) {
  state.theme = mode;
  localStorage.setItem(STORAGE_KEYS.THEME, mode);
  applyThemeByMode(mode);
}

export function applyThemeByMode(mode) {
  let activeTheme = mode;
  if (mode === "device") {
    activeTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  document.documentElement.setAttribute("data-theme", activeTheme);
  document.documentElement.setAttribute("data-theme-mode", mode);
}

export function toggleTheme() {
  const modes = ["device", "dark", "light"];
  const currentIndex = modes.indexOf(state.theme);
  const nextIndex = (currentIndex + 1) % modes.length;
  setTheme(modes[nextIndex]);
}

export function refreshBrandOptions() {
  const counts = new Map();
  let bucketCount = 0;

  for (const station of state.stationsById.values()) {
    const brand = (station.brand || "").trim();
    if (!brand || brand === BRAND_CONFIG.BUCKET) {
      bucketCount++;
      continue;
    }
    counts.set(brand, (counts.get(brand) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const topEntries = sorted.slice(0, BRAND_CONFIG.TOP_N);
  for (const [, n] of sorted.slice(BRAND_CONFIG.TOP_N)) bucketCount += n;

  state.topBrands = new Set(topEntries.map(([name]) => name));

  const displayNames = topEntries.map(([name]) => name);
  if (bucketCount > 0) displayNames.push(BRAND_CONFIG.BUCKET);

  // The selected brand may be a tail brand (present in the zone but outside
  // top N) or absent from the zone entirely. Either way, ensure it stays
  // visible in the dropdown so the user can see what they've filtered on.
  const selected = state.selectedBrand;
  const selectionInZone =
    selected &&
    (counts.has(selected) ||
      (selected === BRAND_CONFIG.BUCKET && bucketCount > 0));
  if (selected && !displayNames.includes(selected)) {
    displayNames.push(selected);
  }

  displayNames.sort((a, b) => a.localeCompare(b));

  const select = elements.brandSelect;
  select.innerHTML = "";

  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = t("brand_all");
  allOpt.setAttribute("data-i18n", "brand_all");
  select.appendChild(allOpt);

  for (const name of displayNames) {
    const opt = document.createElement("option");
    opt.value = name;
    if (name === selected && !selectionInZone) {
      opt.textContent = `${name} (${t("brand_not_in_area")})`;
      opt.disabled = true;
    } else {
      opt.textContent = name;
    }
    select.appendChild(opt);
  }

  select.value = selected ?? "";
}

function bindBrandSelect() {
  elements.brandSelect.addEventListener("change", () => {
    const v = elements.brandSelect.value;
    state.selectedBrand = v === "" ? null : v;
    syncMarkers();
    updateURL();
  });
}

function loadFuels(defaultFuelId) {
  state.fuels = FUELS;
  elements.fuelSelect.innerHTML = state.fuels
    .map((f) => {
      const label = t(`fuel_${f.name.toLowerCase()}`);
      const name = label.startsWith("fuel_") ? f.name : label;
      return `<option value="${f.id}">${name}</option>`;
    })
    .join("");

  const validDefault =
    defaultFuelId && state.fuels.some((f) => f.id === defaultFuelId);
  state.selectedFuelId = validDefault ? defaultFuelId : state.fuels[0]?.id || 1;
  elements.fuelSelect.value = state.selectedFuelId;
  if (!validDefault) updateURL();

  elements.fuelSelect.addEventListener("change", () => {
    state.selectedFuelId = parseInt(elements.fuelSelect.value);
    const c = state.map.getCenter();
    performSearch(c.lat, c.lng);
    updateURL();
  });
}

function bindControls() {
  elements.radiusSelect.addEventListener("change", (e) => {
    state.radius = parseInt(e.target.value);
    const c = state.map.getCenter();
    performSearch(c.lat, c.lng);
    updateURL();
  });

  elements.locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      showToast(t("geo_not_supported"), "error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        state.userLocation = { lat: latitude, lng: longitude };
        setUserLocationMarker(latitude, longitude);
        state.map.setView([latitude, longitude], MAP_CONFIG.DEFAULT_ZOOM);
        performSearch(latitude, longitude);
      },
      () => showToast(t("pos_error"), "error"),
      { timeout: TIMEOUTS.GEO_MS },
    );
  });

  elements.historyToggle.addEventListener("click", toggleHistoryPanel);
  elements.favoritesToggle.addEventListener("click", toggleFavoritesPanel);

  elements.panelContent.addEventListener("click", (e) => {
    const favBtn = e.target.closest("#favoriteBtn");
    if (!favBtn) return;

    if (state.currentStationData) {
      const isFav = toggleFavorite(state.currentStationData);
      favBtn.classList.toggle("active", isFav);
      const svg = favBtn.querySelector("svg");
      svg.setAttribute("fill", isFav ? "currentColor" : "none");

      // Refresh favorites list if it's open
      if (!elements.favoritesPanel.classList.contains("hidden")) {
        renderStationList(state.favorites, elements.favoritesList, "no_favorites");
      }
    }
  });

  elements.panel.addEventListener("sheetClosed", closePanel);
  elements.historyPanel.addEventListener("sheetClosed", closeHistoryPanel);
  elements.favoritesPanel.addEventListener("sheetClosed", closeFavoritesPanel);

  elements.filterToggle.addEventListener("click", () => {
    elements.filterToggle.classList.toggle("active");
    elements.controls.classList.toggle("mobile-hidden");
  });

  elements.controls.addEventListener("sheetClosed", () => {
    elements.filterToggle.classList.remove("active");
  });

  elements.searchHereBtn.addEventListener("click", () => {
    const c = state.map.getCenter();
    performSearch(c.lat, c.lng);
  });

  elements.panelClose.addEventListener("click", closePanel);
  elements.historyPanelClose.addEventListener("click", closeHistoryPanel);
  elements.favoritesPanelClose.addEventListener("click", closeFavoritesPanel);

  elements.helpBtn?.addEventListener("click", () => {
    openSettingsModal();
  });

  bindAddressSearch();
}

function resetSearchUI() {
  closePanel();
  closeHistoryPanel();
  closeFavoritesPanel();
  elements.searchSuggestions.classList.add("hidden");
}

function bindAddressSearch() {
  const addressInput = elements.addressSearch;
  const searchBtn = elements.searchBtn;
  const suggestionsBox = elements.searchSuggestions;
  let debounceTimeout;

  addressInput.addEventListener("input", () => {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(
      () => showSuggestions(addressInput, suggestionsBox),
      TIMEOUTS.SUGGESTIONS_DEBOUNCE_MS,
    );
  });

  suggestionsBox.addEventListener("click", (e) => {
    const item = e.target.closest(".suggestion-item");
    if (!item) return;
    const lat = parseFloat(item.dataset.lat);
    const lon = parseFloat(item.dataset.lon);
    addressInput.value = item.textContent.trim();
    state.map.setView([lat, lon], MAP_CONFIG.DEFAULT_ZOOM);
    performSearch(lat, lon);
    resetSearchUI();
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap"))
      suggestionsBox.classList.add("hidden");
  });

  const doSearch = async () => {
    const query = addressInput.value.trim();
    if (!query) return;
    resetSearchUI();
    try {
      const data = await geocodeAddress(query, state.lang);
      if (data?.length > 0) {
        const { lat, lon } = data[0];
        state.map.setView([lat, lon], MAP_CONFIG.DEFAULT_ZOOM);
        performSearch(lat, lon);
      } else {
        showToast(t("nd"), "info");
      }
    } catch (err) {
      showToast(t("error", { msg: err.message }), "error");
    }
  };

  searchBtn.addEventListener("click", doSearch);
  addressInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch();
  });
}

async function showSuggestions(input, box) {
  const query = input.value.trim();
  if (query.length < SEARCH_CONFIG.MIN_ADDRESS_LENGTH) {
    box.classList.add("hidden");
    return;
  }
  state.requests.suggestAbortController?.abort();
  state.requests.suggestAbortController = new AbortController();
  try {
    const results = await geocodeAddress(
      query,
      state.lang,
      state.requests.suggestAbortController.signal,
    );
    if (results?.length > 0) {
      box.innerHTML = "";
      for (const res of results) {
        const item = document.createElement("div");
        item.className = "suggestion-item";
        item.dataset.lat = res.lat;
        item.dataset.lon = res.lon;
        item.textContent = res.display_name;
        box.appendChild(item);
      }
      box.classList.remove("hidden");
    } else {
      box.classList.add("hidden");
    }
  } catch (err) {
    if (err.name === "AbortError") return;
    box.classList.add("hidden");
  }
}

let firstSearchDone = false;

export async function performSearch(lat, lng) {
  elements.searchHereBtn.classList.add("hidden");
  try {
    closePanel();
    const data = await searchStations(
      lat,
      lng,
      state.radius,
      state.selectedFuelId,
    );
    state.stationsById.clear();
    for (const s of data.results || []) {
      state.stationsById.set(String(s.id), s);
    }
    state.lastSearchCenter = L.latLng(lat, lng);
    state.lastSearchZoom = state.map?.getZoom() ?? null;
    refreshBrandOptions();
    syncMarkers();

    if (!firstSearchDone) {
      firstSearchDone = true;
      checkTutorial();
    }
  } catch (err) {
    if (err.name !== "AbortError")
      showToast(t("error", { msg: err.message }), "error");
  }
}

function showPanelLoading() {
  elements.panel.classList.remove("hidden");
  if (isMobileView()) elements.panel.classList.add("peek");
  elements.panelContent.innerHTML = `
    <div class="panel-loading">
      <div class="spinner"></div>
      <p>${t("loading_details")}</p>
    </div>`;
}

function showPanelError(message) {
  elements.panelContent.innerHTML = `<div class="panel-loading"><p>${t("error", { msg: message })}</p></div>`;
}

function resolveStationLocation(station, knownLocation) {
  return (
    station.location ??
    knownLocation ??
    state.stationsById.get(String(station.id))?.location ??
    null
  );
}

async function ensureStationVisible(station, forceSearch) {
  const sId = String(station.id);
  if (!station.location) return;

  if (forceSearch || !state.markers.has(sId)) {
    const zoom = Math.max(state.map.getZoom(), MAP_CONFIG.DEFAULT_ZOOM);
    state.map.setView([station.location.lat, station.location.lng], zoom, {
      animate: false,
    });
    await performSearch(station.location.lat, station.location.lng);
    selectMarker(sId);
  }
}

function focusMapOnStation(station) {
  if (!station.location) return;

  const { lat, lng } = station.location;
  const zoom = Math.max(state.map.getZoom(), MAP_CONFIG.DEFAULT_ZOOM);

  // On desktop the side panel covers the right part of the map. Shift the
  // fly-to target right by half the panel width so the station lands in the
  // visible half instead of under the panel.
  let target = [lat, lng];
  if (!isMobileView()) {
    const panelWidth = elements.panel?.offsetWidth ?? 0;
    if (panelWidth > 0) {
      const shifted = state.map
        .project([lat, lng], zoom)
        .add([panelWidth / 2, 0]);
      target = state.map.unproject(shifted, zoom);
    }
  }

  state.map.flyTo(target, zoom, { duration: MAP_CONFIG.FLY_DURATION_S });
}

export async function openStationById(
  id,
  knownLocation = null,
  forceSearch = false,
) {
  const sId = String(id);
  selectMarker(sId);

  closeHistoryPanel();
  closeFavoritesPanel();

  showPanelLoading();

  try {
    const station = await fetchStationDetails(sId);
    station.location = resolveStationLocation(station, knownLocation);

    addToHistory(station);
    await ensureStationVisible(station, forceSearch);

    state.currentStationData = station;
    focusMapOnStation(station);
    renderPanel(station);
  } catch (err) {
    if (err.name === "AbortError") return;
    showPanelError(err.message);
  }
}
