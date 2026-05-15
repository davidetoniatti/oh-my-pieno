import { state, isFavorite } from "./state.js";
import { t } from "./i18n.js";
import { escapeHtml, timeAgo, getDistance } from "./formatters.js";
import { TIMEOUTS, BRAND_CONFIG, STORAGE_KEYS } from "./constants.js";
import { elements, isMobileView } from "./dom.js";

const refreshCallbacks = new Set();

export function registerRefreshCallback(cb) {
  refreshCallbacks.add(cb);
}

export function updateUILanguage() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(key);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    el.title = t(key);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    el.placeholder = t(key);
  });

  if (
    !elements.panel.classList.contains("hidden") &&
    state.currentStationData
  ) {
    renderPanel(state.currentStationData);
  }

  refreshBrandOptions();
  refreshCallbacks.forEach((cb) => cb());
}

export function showToast(msg, type = "info") {
  const existing = document.getElementById("toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "toast";
  toast.className = `toast toast--${type}`;
  toast.textContent = msg;
  elements.app.appendChild(toast);

  toast.offsetHeight;
  toast.classList.add("toast--visible");

  setTimeout(() => {
    toast.classList.remove("toast--visible");
    toast.addEventListener("transitionend", () => toast.remove(), {
      once: true,
    });
  }, TIMEOUTS.TOAST_MS);
}

export function closePanelUI() {
  elements.panel.classList.add("hidden");
  elements.panel.classList.remove("peek", "full");
  elements.map.classList.remove("has-selection");
}

export function closeCollectionPanelUI(panel, toggleBtn) {
  panel.classList.add("hidden");
  panel.classList.remove("peek", "full");
  if (toggleBtn) toggleBtn.classList.remove("active");
}

export function bindCollectionEvents(listEl, onSelect) {
  listEl.addEventListener("click", (e) => {
    if (e.target.closest(".station-map-link")) return;
    const item = e.target.closest(".station-item");
    if (!item) return;
    const id = String(item.dataset.id);
    onSelect(id);
  });
}

export function renderStationList(items, listEl, emptyKey) {
  if (items.length === 0) {
    listEl.innerHTML = `<li class="empty-msg">${t(emptyKey)}</li>`;
    return;
  }

  listEl.innerHTML = items
    .map((entry) => {
      const mapsUrl = entry.location
        ? `https://www.google.com/maps/search/?api=1&query=${entry.location.lat},${entry.location.lng}`
        : "#";
      const dist =
        state.userLocation && entry.location
          ? getDistance(
              state.userLocation.lat,
              state.userLocation.lng,
              entry.location.lat,
              entry.location.lng,
            )
          : null;
      return `
    <li class="station-item" data-id="${entry.id}">
      <div class="station-brand">${escapeHtml(entry.brand || t("nd"))}</div>
      <div class="station-address-container">
        <div class="station-address">${escapeHtml(entry.address || t("addr_not_available"))}</div>
        <a href="${mapsUrl}" target="_blank" rel="noopener" class="station-map-link">
          ${t("open_in_map")}
        </a>
      </div>
      ${entry.latestDate ? `<div class="station-update">${t("last_update", { time: timeAgo(entry.latestDate) })}</div>` : ""}
      ${dist !== null ? `<div class="station-distance">${t("distance_from_pos", { d: dist.toFixed(1) })}</div>` : ""}
    </li>
  `;
    })
    .join("");
}

function renderFuelRow(name, selfPrice, servedPrice) {
  const label = t(`fuel_${name.toLowerCase()}`);
  const displayName = label.startsWith("fuel_") ? name : label;
  const selfText = selfPrice !== Infinity ? selfPrice.toFixed(3) : "--.---";
  const servedText =
    servedPrice !== Infinity ? servedPrice.toFixed(3) : "--.---";
  return `
    <div class="fuel-row">
      <span class="fuel-name">${escapeHtml(displayName)}</span>
      <div class="fuel-prices-combined">
        <div class="price-group">
          <span class="price-label">${t("price_self")}</span>
          <span class="price-value">${selfText}</span>
        </div>
        <span class="price-sep">|</span>
        <div class="price-group">
          <span class="price-label">${t("price_served")}</span>
          <span class="price-value">${servedText}</span>
        </div>
      </div>
    </div>`;
}

function renderContactRow(labelKey, value, hrefPrefix = "") {
  if (!value) return "";
  const escaped = escapeHtml(value);
  let finalHref = hrefPrefix + escaped;

  if (labelKey === "web" && !value.startsWith("http")) {
    finalHref = "https://" + value;
  }

  const link =
    hrefPrefix || labelKey === "web"
      ? `<a href="${finalHref}" target="_blank" rel="noopener">${escaped}</a>`
      : escaped;

  return `
    <div class="info-row">
      <span class="info-label">${t(labelKey)}</span>
      ${link}
    </div>`;
}

export function renderPanel(station) {
  const wasHidden = elements.panel.classList.contains("hidden");
  elements.panel.classList.remove("hidden");
  if (wasHidden && isMobileView()) {
    elements.panel.classList.add("peek");
  }

  const isFav = isFavorite(station.id);
  const fuelMap = new Map();
  let latestDate = null;

  (station.fuels || []).forEach((f) => {
    const key = f.name || "Fuel";
    if (!fuelMap.has(key)) {
      fuelMap.set(key, { selfMin: Infinity, servedMin: Infinity });
    }
    const entry = fuelMap.get(key);

    if (f.isSelf && f.price < entry.selfMin) {
      entry.selfMin = f.price;
    } else if (!f.isSelf && f.price < entry.servedMin) {
      entry.servedMin = f.price;
    }

    if (f.insertDate && (!latestDate || f.insertDate > latestDate)) {
      latestDate = f.insertDate;
    }
  });

  let fuelHtml = "";
  for (const [name, entry] of fuelMap.entries()) {
    fuelHtml += renderFuelRow(name, entry.selfMin, entry.servedMin);
  }

  const addr = station.address || t("addr_not_available");
  const mapsUrl = station.location
    ? `https://www.google.com/maps/search/?api=1&query=${station.location.lat},${station.location.lng}`
    : "#";

  const dist =
    state.userLocation && station.location
      ? getDistance(
          state.userLocation.lat,
          state.userLocation.lng,
          station.location.lat,
          station.location.lng,
        )
      : null;

  elements.panelContent.innerHTML = `
    <div class="station-header">
      <div class="station-brand-row">
        <div class="station-brand">${escapeHtml(station.brand || t("nd"))}</div>
        <button id="favoriteBtn" class="favorite-btn ${isFav ? "active" : ""}" aria-label="Toggle favorite">
          <svg viewBox="0 0 24 24" fill="${isFav ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>
      </div>
      <div class="station-address-container">
        <div class="station-address">${escapeHtml(addr)}</div>
        <a href="${mapsUrl}" target="_blank" rel="noopener" class="station-map-link">
          ${t("open_in_map")}
        </a>
      </div>
      ${latestDate ? `<div class="station-update">${t("last_update", { time: timeAgo(latestDate) })}</div>` : ""}
      ${dist !== null ? `<div class="station-distance">${t("distance_from_pos", { d: dist.toFixed(1) })}</div>` : ""}
    </div>

    <div class="section-title">${t("fuel_prices")}</div>
    <div class="fuel-grid">
      ${fuelHtml || `<p class="empty-msg">${t("no_prices")}</p>`}
    </div>

    ${
      station.phoneNumber || station.email || station.website
        ? `
      <div class="section-title">${t("contacts")}</div>
      <div class="station-contacts">
        ${renderContactRow("phone", station.phoneNumber, "tel:")}
        ${renderContactRow("email", station.email, "mailto:")}
        ${renderContactRow("web", station.website)}
      </div>
    `
        : ""
    }

    <div class="section-title">${t("additional_info")}</div>
    <div class="station-footer">
      <div class="footer-row"><span class="footer-label">${t("station_name")}:</span> ${escapeHtml(station.name)}</div>
      <div class="footer-row"><span class="footer-label">${t("station_id")}:</span> ${station.id}</div>
      ${station.company ? `<div class="footer-row"><span class="footer-label">${t("company")}:</span> ${escapeHtml(station.company)}</div>` : ""}
    </div>
  `;
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

export function setTheme(mode) {
  state.theme = mode;
  localStorage.setItem(STORAGE_KEYS.THEME, mode);
  applyThemeByMode(mode);
}

export function toggleTheme() {
  const modes = ["device", "dark", "light"];
  const currentIndex = modes.indexOf(state.theme);
  const nextIndex = (currentIndex + 1) % modes.length;
  setTheme(modes[nextIndex]);
}
