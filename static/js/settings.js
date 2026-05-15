import { state, updateURL } from "./state.js";
import { t, translations } from "./i18n.js";
import { updateUILanguage, setTheme, toggleTheme, registerRefreshCallback } from "./ui.js";
import { startTutorial } from "./tutorial.js";
import { closePanel, toggleHistoryPanel, toggleFavoritesPanel } from "./panels.js";
import { STORAGE_KEYS } from "./constants.js";
import { elements } from "./dom.js";

const FOCUSABLE_SELECTOR = 'button, [href], [tabindex]:not([tabindex="-1"])';

const LANGUAGE_NATIVE = {
  en: "English",
  it: "Italiano",
};

const THEME_LABELS = {
  device: "theme_system",
  dark: "theme_dark",
  light: "theme_light",
};

let activeSettingsRefresh = null;

registerRefreshCallback(() => {
  if (activeSettingsRefresh) activeSettingsRefresh();
});

function createSettingsRow(labelText) {
  const row = document.createElement("div");
  row.className = "settings-row";

  const label = document.createElement("div");
  label.className = "settings-label";
  label.textContent = labelText;

  const buttons = document.createElement("div");
  buttons.className = "settings-buttons";

  row.append(label, buttons);
  return { row, label, buttons };
}

function createGroupTitle(textKey) {
  const title = document.createElement("div");
  title.className = "settings-group-title";
  title.textContent = t(textKey);
  return title;
}

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

  const preferencesTitle = createGroupTitle("preferences_title");
  const settingsSection = document.createElement("div");
  settingsSection.className = "settings-section";

  const languageRow = createSettingsRow("");
  const themeRow = createSettingsRow("");

  settingsSection.append(languageRow.row, themeRow.row);

  const shortcutsTitle = createGroupTitle("shortcuts_title");
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
  modal.append(
    heading,
    preferencesTitle,
    settingsSection,
    shortcutsTitle,
    list,
    actions,
  );
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
        languageRow.buttons.querySelector(".settings-btn.active")?.focus();
      });

      languageRow.buttons.appendChild(btn);
    });

    themeRow.buttons.replaceChildren();
    Object.entries(THEME_LABELS).forEach(([mode, labelKey]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `settings-btn ${state.theme === mode ? "active" : ""}`;
      btn.textContent = t(labelKey);

      btn.addEventListener("click", () => {
        if (state.theme === mode) return;
        setTheme(mode);
        render();
        themeRow.buttons.querySelector(".settings-btn.active")?.focus();
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
