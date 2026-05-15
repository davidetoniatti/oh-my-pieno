import { elements } from "./dom.js";
import { t, translations } from "./i18n.js";
import { updateUILanguage } from "./ui.js";
import { startTutorial } from "./tutorial.js";
import { state, updateURL } from "./state.js";
import { STORAGE_KEYS } from "./constants.js";
import {
  closePanel,
  closeHistoryPanel,
  toggleTheme,
  setTheme,
  toggleHistoryPanel,
  toggleFavoritesPanel,
  closeFavoritesPanel
} from './app.js';

const LANGUAGE_NATIVE = {
  en: "English",
  it: "Italiano",
};

const FOCUSABLE_SELECTOR = 'button, [href], [tabindex]:not([tabindex="-1"])';

const SHORTCUTS = [
  { keys: ["Esc"], labelKey: "shortcut_escape" },
  { keys: ["/"], labelKey: "shortcut_search" },
  { keys: ["Ctrl", "K"], labelKey: "shortcut_search" },
  { keys: ["H"], labelKey: "shortcut_history" },
  { keys: ["F"], labelKey: "shortcut_favorites" },
  { keys: ["L"], labelKey: "shortcut_locate" },
  { keys: ["T"], labelKey: "shortcut_theme" },
  { keys: ["R"], labelKey: "shortcut_refresh" },
  { keys: ["?"], labelKey: "shortcut_settings" },
];

// True when an element is present in the layout tree (not display:none,
// not detached). Used to gate shortcuts on target availability instead of
// viewport width — keyboards attached to mobile devices still work naturally.
function isRendered(el) {
  return !!el && el.offsetParent !== null;
}

function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return !!el.isContentEditable;
}

function hasMod(e) {
  return e.ctrlKey || e.metaKey;
}

function focusSearch() {
  const input = elements.addressSearch;
  if (!input) return;
  input.focus();
  input.select();
}

function clickIfPresent(el) {
  if (!el || el.classList.contains("hidden")) return false;
  el.click();
  return true;
}

function closeTopmost() {
  const settings = document.getElementById("settings-overlay");
  if (settings) {
    settings.dispatchEvent(new CustomEvent("settingsClose"));
    return true;
  }

  const sugg = elements.searchSuggestions;
  if (sugg && !sugg.classList.contains("hidden")) {
    sugg.classList.add("hidden");
    return true;
  }

  if (elements.panel && !elements.panel.classList.contains("hidden")) {
    closePanel();
    return true;
  }

  if (
    elements.historyPanel &&
    !elements.historyPanel.classList.contains("hidden")
  ) {
    closeHistoryPanel();
    return true;
  }

  if (
    elements.favoritesPanel &&
    !elements.favoritesPanel.classList.contains("hidden")
  ) {
    closeFavoritesPanel();
    return true;
  }

  // The filter drawer exists only on mobile (the toggle button is hidden on
  // desktop, so isRendered returns false there and desktop Escape skips this).
  if (
    isRendered(elements.filterToggle) &&
    elements.controls &&
    !elements.controls.classList.contains("mobile-hidden")
  ) {
    elements.controls.classList.add("mobile-hidden");
    elements.filterToggle.classList.remove("active");
    return true;
  }

  return false;
}

export function bindKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    // Tutorial owns its own keys; get out of its way.
    if (document.getElementById("tutorial-overlay")) return;

    // Escape: works in any focus context — let the topmost surface close first.
    if (e.key === "Escape") {
      if (closeTopmost()) e.preventDefault();
      return;
    }

    // Ctrl/Cmd+K: universal "open search".
    if ((e.key === "k" || e.key === "K") && hasMod(e)) {
      e.preventDefault();
      focusSearch();
      return;
    }

    // From here on: single-key shortcuts. Suppress when typing or chording.
    if (isEditable(document.activeElement) || hasMod(e) || e.altKey) return;

    switch (e.key) {
      case "/":
        e.preventDefault();
        focusSearch();
        break;
      case "?":
        e.preventDefault();
        openSettingsModal();
        break;
      case "h":
      case "H":
        e.preventDefault();
        toggleHistoryPanel();
        break;
      case "f":
      case "F":
        e.preventDefault();
        toggleFavoritesPanel();
        break;
      case "l":
      case "L":
        e.preventDefault();
        elements.locateBtn?.click();
        break;
      case "t":
      case "T":
        e.preventDefault();
        toggleTheme();
        break;
      case "r":
      case "R":
        e.preventDefault();
        clickIfPresent(elements.searchHereBtn);
        break;
    }
  });
}

// ---------------------------------------------------------------------------
// Settings hub modal
// ---------------------------------------------------------------------------

let activeSettingsRefresh = null;

export function refreshSettingsModalIfActive() {
  if (activeSettingsRefresh) activeSettingsRefresh();
}

const THEME_LABELS = {
  device: 'theme_system',
  dark: 'theme_dark',
  light: 'theme_light',
};

function createSettingsRow(labelText) {
  const row = document.createElement('div');
  row.className = 'settings-row';

  const label = document.createElement('div');
  label.className = 'settings-label';
  label.textContent = labelText;

  const buttons = document.createElement('div');
  buttons.className = 'settings-buttons';

  row.append(label, buttons);
  return { row, label, buttons };
}

function createGroupTitle(textKey) {
  const title = document.createElement('div');
  title.className = 'settings-group-title';
  title.textContent = t(textKey);
  return title;
}

export function openSettingsModal() {
  if (document.getElementById("settings-overlay")) return;

  const previouslyFocused = document.activeElement;

  const overlay = document.createElement("div");
  overlay.id = "settings-overlay";

  const modal = document.createElement("div");
  modal.className = "tutorial-modal settings-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "settings-title");
  modal.tabIndex = -1;

  const heading = document.createElement("h2");
  heading.id = "settings-title";

  const preferencesTitle = createGroupTitle('preferences_title');
  const settingsSection = document.createElement('div');
  settingsSection.className = 'settings-section';

  const languageRow = createSettingsRow('');
  const themeRow = createSettingsRow('');

  settingsSection.append(languageRow.row, themeRow.row);

  const shortcutsTitle = createGroupTitle('shortcuts_title');
  const list = document.createElement("ul");
  list.className = "shortcuts-list";

  const actions = document.createElement("div");
  actions.className = "tutorial-actions";

  const replayBtn = document.createElement("button");
  replayBtn.type = "button";
  replayBtn.className = "btn-text";

  const spacer = document.createElement("div");
  spacer.className = "spacer";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn-primary";

  actions.append(replayBtn, spacer, closeBtn);
  modal.append(heading, preferencesTitle, settingsSection, shortcutsTitle, list, actions);
  overlay.append(modal);
  document.body.appendChild(overlay);

  const render = () => {
    heading.textContent = t("settings_title");
    preferencesTitle.textContent = t("preferences_title");
    languageRow.label.textContent = t("language_label");
    themeRow.label.textContent = t("theme_label");
    shortcutsTitle.textContent = t("shortcuts_title");
    replayBtn.textContent = t("replay_tutorial");
    closeBtn.textContent = t("close");

    list.replaceChildren();
    for (const s of SHORTCUTS) {
      const li = document.createElement("li");
      const keys = document.createElement("span");
      keys.className = "shortcut-keys";

      s.keys.forEach((k, i) => {
        const kbd = document.createElement("kbd");
        kbd.textContent = k;
        keys.appendChild(kbd);
        if (i < s.keys.length - 1) keys.append("+");
      });

      const label = document.createElement("span");
      label.className = "shortcut-label";
      label.textContent = t(s.labelKey);

      li.append(keys, label);
      list.appendChild(li);
    }

    languageRow.buttons.replaceChildren();
    Object.keys(translations).forEach((code) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-btn" + (state.lang === code ? " active" : "");
      btn.textContent = LANGUAGE_NATIVE[code] || code;

      btn.addEventListener("click", () => {
        if (state.lang === code) return;
        state.lang = code;
        localStorage.setItem(STORAGE_KEYS.LANG, code);
        updateUILanguage();
        updateURL();
        languageRow.buttons.querySelector(".settings-btn.active")?.focus();
      });

      languageRow.buttons.appendChild(btn);
    });

    themeRow.buttons.replaceChildren();
    Object.entries(THEME_LABELS).forEach(([mode, labelKey]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `settings-btn ${state.theme === mode ? 'active' : ''}`;
      btn.textContent = t(labelKey);

      btn.addEventListener('click', () => {
        if (state.theme === mode) return;
        setTheme(mode);
        render();
        themeRow.buttons.querySelector('.settings-btn.active')?.focus();
      });

      themeRow.buttons.appendChild(btn);
    });
  };

  activeSettingsRefresh = render;
  render();

  const close = () => {
    activeSettingsRefresh = null;
    document.removeEventListener("keydown", onKeydown, true);
    overlay.removeEventListener("settingsClose", close);
    overlay.classList.add("fade-out");

    const remove = () => {
      overlay.remove();
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      remove();
    } else {
      overlay.addEventListener("transitionend", remove, { once: true });
    }
  };

  const onKeydown = (e) => {
    if (!overlay.isConnected) return;
    if (e.key === "Tab") {
      const focusables = Array.from(modal.querySelectorAll(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  replayBtn.addEventListener("click", () => {
    close();
    localStorage.removeItem(STORAGE_KEYS.TUTORIAL_SEEN);
    startTutorial();
  });

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  overlay.addEventListener("settingsClose", close);
  document.addEventListener("keydown", onKeydown, true);

  closeBtn.focus();
}
