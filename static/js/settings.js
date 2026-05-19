import { state, updateURL } from "./state.js";
import { t, translations } from "./i18n.js";
import { updateUILanguage, setTheme, toggleTheme } from "./ui.js";
import { startTutorial } from "./tutorial.js";
import { closePanel, toggleHistoryPanel, toggleFavoritesPanel } from "./panels.js";
import { STORAGE_KEYS } from "./constants.js";
import { elements } from "./dom.js";
import { createModal } from "./modal.js";
import { appEvents, APP_EVENT_TYPES } from "./events.js";

const LANGUAGE_NATIVE = {
  en: "English",
  it: "Italiano",
};

const THEME_LABELS = {
  device: "theme_system",
  dark: "theme_dark",
  light: "theme_light",
};

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

  const { modal, close } = createModal({
    id: "settings-overlay",
    ariaLabel: "settings-title",
    className: "settings-modal",
    onClose: () => {
      appEvents.removeEventListener(APP_EVENT_TYPES.LANGUAGE_CHANGE, render);
      overlay.removeEventListener("settingsClose", close);
    }
  });

  const overlay = document.getElementById("settings-overlay");

  const heading = document.createElement("h2");
  heading.id = "settings-title";

  modal.append(
    heading,
    preferencesTitle,
    settingsSection,
    shortcutsTitle,
    list,
    actions,
  );

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

  appEvents.addEventListener(APP_EVENT_TYPES.LANGUAGE_CHANGE, render);
  render();

  replayBtn.addEventListener("click", () => {
    close();
    localStorage.removeItem(STORAGE_KEYS.TUTORIAL_SEEN);
    startTutorial();
  });

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("settingsClose", close);

  closeBtn.focus();
}
