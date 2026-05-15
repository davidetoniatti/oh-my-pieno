import { state, addToHistory, updateURL } from "./state.js";
import { t } from "./i18n.js";
import { elements, isMobileView } from "./dom.js";
import {
  searchStations,
  fetchStationDetails,
} from "./api.js";
import {
  syncMarkers,
  selectMarker,
  setUserLocationMarker,
} from "./map.js";
import {
  closePanelUI,
  closeCollectionPanelUI,
  renderPanel,
  showToast,
  renderStationList,
  refreshBrandOptions,
} from "./ui.js";
import { checkTutorial } from "./tutorial.js";
import {
  MAP_CONFIG,
  BRAND_CONFIG,
} from "./constants.js";

let firstSearchDone = false;

export function closePanel() {
  closePanelUI();
  state.currentStationData = null;
  selectMarker(null);
}

export function toggleCollectionPanel(panel, toggleBtn, renderFn) {
  const isHidden = panel.classList.contains("hidden");

  if (isHidden) {
    closePanel();
    if (panel === elements.historyPanel) {
      closeCollectionPanelUI(elements.favoritesPanel, elements.favoritesToggle);
    } else if (panel === elements.favoritesPanel) {
      closeCollectionPanelUI(elements.historyPanel, elements.historyToggle);
    }

    renderFn();
    panel.classList.remove("hidden");
    if (isMobileView()) panel.classList.add("peek");
    toggleBtn.classList.add("active");
  } else {
    closeCollectionPanelUI(panel, toggleBtn);
  }
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
  closeCollectionPanelUI(elements.historyPanel, elements.historyToggle);
}

export function closeFavoritesPanel() {
  closeCollectionPanelUI(elements.favoritesPanel, elements.favoritesToggle);
}

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

export function resetSearchUI() {
  closePanel();
  closeHistoryPanel();
  closeFavoritesPanel();
  elements.searchSuggestions.classList.add("hidden");
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
