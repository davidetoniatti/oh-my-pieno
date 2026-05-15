import { elements } from "./dom.js";
import {
  closePanel,
  closeHistoryPanel,
  toggleHistoryPanel,
  toggleFavoritesPanel,
  closeFavoritesPanel
} from './panels.js';
import { toggleTheme } from './ui.js';
import { openSettingsModal } from './settings.js';

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

  const tutorial = document.getElementById("tutorial-overlay");
  if (tutorial) return false; // Handled by tutorial.js

  if (!elements.panel.classList.contains("hidden")) {
    closePanel();
    return true;
  }
  if (!elements.historyPanel.classList.contains("hidden")) {
    closeHistoryPanel();
    return true;
  }
  if (!elements.favoritesPanel.classList.contains("hidden")) {
    closeFavoritesPanel();
    return true;
  }

  if (clickIfPresent(elements.panelClose)) return true;
  if (clickIfPresent(elements.historyPanelClose)) return true;
  if (clickIfPresent(elements.favoritesPanelClose)) return true;

  return false;
}

export function bindKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (closeTopmost()) e.preventDefault();
      return;
    }

    const target = e.target;
    const isInput =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable;

    if (isInput) return;

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
        elements.searchHereBtn?.click();
        break;
    }
  });
}
