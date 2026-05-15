export const STORAGE_KEYS = {
  TUTORIAL_SEEN: "ohmypieno_tutorial_seen",
  THEME: "ohmypieno_theme",
  HISTORY: "ohmypieno_history",
  FAVORITES: "ohmypieno_favorites",
  LANG: "ohmypieno_lang",
  FUEL: "ohmypieno_fuel",
};

export const BREAKPOINTS = {
  DESKTOP: 900,
};

export const TIMEOUTS = {
  GEO_MS: 10000,
  SUGGESTIONS_DEBOUNCE_MS: 400,
  TOAST_MS: 3000,
};

export const MAP_CONFIG = {
  DEFAULT_ZOOM: 15,
  DEFAULT_LAT: 41.9028, // Rome
  DEFAULT_LNG: 12.4964,
  FLY_DURATION_S: 0.8,
};

export const SEARCH_CONFIG = {
  MIN_ADDRESS_LENGTH: 3,
  DEFAULT_RADIUS: 5,
};

export const HISTORY_CONFIG = {
  MAX_SIZE: 10,
};

// The /api/fuels endpoint returns this exact list (hardcoded server-side per
// invariant #8). Mirroring it here avoids a network round-trip on every page
// load. Keep in sync with internal/api/client.go:GetFuels.
export const FUELS = [
  { id: 1, name: "Benzina" },
  { id: 2, name: "Gasolio" },
  { id: 3, name: "HVO" },
  { id: 4, name: "GPL" },
  { id: 5, name: "Metano" },
];

// MIMIT returns brand names glued (no spaces): e.g. "PompeBianche", "AgipEni".
// BUCKET is the literal label that also doubles as the catch-all for the
// long tail beyond TOP_N most common brands in the current zone.
export const BRAND_CONFIG = {
  BUCKET: "PompeBianche",
  TOP_N: 10,
};

export const SHEET_CONFIG = {
  DRAG_THRESHOLD: 50,
  VELOCITY_THRESHOLD: 0.5,
  PEEK_HEIGHT_VH: 50,
};

// Tutorial step icons. These match the app's existing topbar SVGs where
// possible, so the tutorial's visual vocabulary matches the real buttons.
// Inline strings are safe to drop into innerHTML — content is static and
// controlled here, no user input interpolated.
const ICON_FUEL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="22" x2="15" y2="22"/><line x1="4" y1="9" x2="14" y2="9"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/></svg>';
const ICON_PIN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
const ICON_SEARCH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
const ICON_FILTER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>';
const ICON_HISTORY =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/></svg>';
const ICON_THEME =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
const ICON_LOCATE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></svg>';
const ICON_SETTINGS =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

const ICON_COLLECTION =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>';

export const TUTORIAL_STEPS = [
  { textKey: "tutorial_step1", highlight: null, icon: ICON_FUEL },
  { textKey: "tutorial_step2", highlight: ".price-marker", icon: ICON_PIN },
  { textKey: "tutorial_step3", highlight: ".search-wrap", icon: ICON_SEARCH },
  // On desktop the #filterToggle button is hidden — the selects live inline
  // in the topbar. Highlight them directly instead.
  {
    textKey: "tutorial_step4",
    highlight: "#filterToggle",
    highlightDesktop: "#fuelSelect, #radiusSelect, #brandSelect",
    icon: ICON_FILTER,
  },
  {
    textKey: "tutorial_step5",
    highlight: "#historyToggle, #favoritesToggle",
    icon: ICON_COLLECTION,
  },
  { textKey: "tutorial_step6", highlight: "#locateBtn", icon: ICON_LOCATE },
  {
    textKey: "tutorial_step7",
    highlight: "#helpBtn",
    highlightDesktop: "#help-indicator",
    icon: ICON_SETTINGS,
  },
];
