import { state, getStateFromURL, updateURL, toggleFavorite } from "./state.js";
import { hasLocale, t } from "./i18n.js";
import { geocodeAddress } from "./api.js";
import { initMap, syncMarkers, selectMarker, setUserLocationMarker } from "./map.js";
import {
  updateUILanguage,
  showToast,
  bindCollectionEvents,
  setTheme,
  applyThemeByMode,
  toggleTheme,
  renderStationList,
  refreshBrandOptions,
} from "./ui.js";
import {
  toggleHistoryPanel,
  toggleFavoritesPanel,
  closePanel,
  closeHistoryPanel,
  closeFavoritesPanel,
  performSearch,
  openStationById,
  resetSearchUI,
} from "./panels.js";
import { Sheet } from "./Sheet.js";
import { bindKeyboardShortcuts } from "./keyboard.js";
import { openSettingsModal } from "./settings.js";
import {
  TIMEOUTS,
  MAP_CONFIG,
  SEARCH_CONFIG,
  STORAGE_KEYS,
  FUELS,
} from "./constants.js";
import { elements } from "./dom.js";

document.addEventListener("DOMContentLoaded", bootstrapApp);

async function bootstrapApp() {
  const savedLang = localStorage.getItem(STORAGE_KEYS.LANG);
  if (savedLang && hasLocale(savedLang)) {
    state.lang = savedLang;
  } else {
    const browserLang = navigator.language.split("-")[0];
    if (hasLocale(browserLang)) state.lang = browserLang;
  }

  const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || "device";
  setTheme(savedTheme);

  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (state.theme === "device") {
        applyThemeByMode("device");
      }
    });

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
        performSearch(startLat, startLng);
      },
      { timeout: TIMEOUTS.GEO_MS },
    );
  } else {
    performSearch(startLat, startLng);
  }
}

function bindBrandSelect() {
  elements.brandSelect.addEventListener("change", () => {
    const v = elements.brandSelect.value;
    state.selectedBrand = v === "" ? null : v;
    syncMarkers();
    updateURL();
  });
}

function loadFuels(urlFuelId) {
  state.fuels = FUELS;
  elements.fuelSelect.innerHTML = state.fuels
    .map((f) => {
      const label = t(`fuel_${f.name.toLowerCase()}`);
      const name = label.startsWith("fuel_") ? f.name : label;
      return `<option value="${f.id}">${name}</option>`;
    })
    .join("");

  const savedFuel = parseInt(localStorage.getItem(STORAGE_KEYS.FUEL), 10);
  const defaultFuelId = urlFuelId || savedFuel;

  const validDefault =
    defaultFuelId && state.fuels.some((f) => f.id === defaultFuelId);
  state.selectedFuelId = validDefault ? defaultFuelId : state.fuels[0]?.id || 1;
  elements.fuelSelect.value = state.selectedFuelId;
  if (!urlFuelId && !validDefault) updateURL();

  elements.fuelSelect.addEventListener("change", () => {
    state.selectedFuelId = parseInt(elements.fuelSelect.value);
    localStorage.setItem(STORAGE_KEYS.FUEL, state.selectedFuelId);
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

  elements.helpBtn?.addEventListener("click", () => {
    openSettingsModal();
  });

  bindAddressSearch();
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
