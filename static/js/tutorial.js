import { t } from "./i18n.js";
import { TUTORIAL_STEPS, STORAGE_KEYS, BREAKPOINTS } from "./constants.js";
import { createModal } from "./modal.js";
import { appEvents, APP_EVENT_TYPES } from "./events.js";

export function checkTutorial() {
  if (localStorage.getItem(STORAGE_KEYS.TUTORIAL_SEEN) === "true") return;
  startTutorial();
}

export function startTutorial() {
  if (document.getElementById("tutorial-overlay")) return;

  const dotsContainer = document.createElement("div");
  dotsContainer.className = "tutorial-progress";
  dotsContainer.id = "tutorial-dots";

  const iconBox = document.createElement("div");
  iconBox.className = "tutorial-icon";
  iconBox.setAttribute("aria-hidden", "true");

  const title = document.createElement("h2");
  title.id = "tutorial-title";

  const text = document.createElement("p");
  text.id = "tutorial-text";
  text.setAttribute("aria-live", "polite");

  const actions = document.createElement("div");
  actions.className = "tutorial-actions";

  const backBtn = document.createElement("button");
  backBtn.id = "tutorial-back";
  backBtn.type = "button";
  backBtn.className = "btn-text";

  const spacer = document.createElement("div");
  spacer.className = "spacer";

  const skipBtn = document.createElement("button");
  skipBtn.id = "tutorial-skip";
  skipBtn.type = "button";
  skipBtn.className = "btn-text";

  const nextBtn = document.createElement("button");
  nextBtn.id = "tutorial-next";
  nextBtn.type = "button";
  nextBtn.className = "btn-primary";

  let currentIndex = 0;
  const totalSteps = TUTORIAL_STEPS.length;
  actions.append(backBtn, spacer, skipBtn, nextBtn);

  const clearHighlights = () => {
    document
      .querySelectorAll(".tutorial-highlight")
      .forEach((el) => el.classList.remove("tutorial-highlight"));
  };

  const updateUI = () => {
    const step = TUTORIAL_STEPS[currentIndex];

    title.replaceChildren();
    const em = document.createElement("em");
    em.textContent = "PIENO";
    title.append(t("tutorial_title") + " OHMY", em);

    backBtn.textContent = t("btn_back");
    skipBtn.textContent = t("btn_skip");
    text.textContent = t(step.textKey);

    const dots = dotsContainer.querySelectorAll(".dot");
    dots.forEach((dot, i) => {
      dot.classList.toggle("active", i === currentIndex);
    });

    backBtn.classList.toggle("hidden", currentIndex === 0);
    nextBtn.textContent =
      currentIndex === totalSteps - 1 ? t("btn_finish") : t("btn_next");

    iconBox.innerHTML = step.icon || "";

    const isDesktop = window.matchMedia(
      `(min-width: ${BREAKPOINTS.DESKTOP + 1}px)`,
    ).matches;
    const highlight =
      isDesktop && step.highlightDesktop
        ? step.highlightDesktop
        : step.highlight;

    clearHighlights();
    if (highlight) {
      document
        .querySelectorAll(highlight)
        .forEach((el) => el.classList.add("tutorial-highlight"));
    }
  };

  const onPopState = () => close();

  const { modal, close } = createModal({
    id: "tutorial-overlay",
    ariaLabel: "tutorial-title",
    onClose: () => {
      clearHighlights();
      appEvents.removeEventListener(APP_EVENT_TYPES.LANGUAGE_CHANGE, updateUI);
      window.removeEventListener("popstate", onPopState);
      localStorage.setItem(STORAGE_KEYS.TUTORIAL_SEEN, "true");
      if (history.state && history.state.tutorial) {
        history.back();
      }
    }
  });

  modal.setAttribute("aria-describedby", "tutorial-text");
  modal.append(dotsContainer, iconBox, title, text, actions);

  // Push a history entry so the browser back button dismisses the tutorial.
  history.pushState({ tutorial: true }, "");

  TUTORIAL_STEPS.forEach(() => {
    const dot = document.createElement("span");
    dot.className = "dot";
    dotsContainer.appendChild(dot);
  });

  const goNext = () => {
    if (currentIndex < totalSteps - 1) {
      currentIndex++;
      updateUI();
    } else {
      close();
    }
  };

  const goBack = () => {
    if (currentIndex > 0) {
      currentIndex--;
      updateUI();
    }
  };

  nextBtn.addEventListener("click", goNext);
  backBtn.addEventListener("click", goBack);
  skipBtn.addEventListener("click", close);
  window.addEventListener("popstate", onPopState);

  appEvents.addEventListener(APP_EVENT_TYPES.LANGUAGE_CHANGE, updateUI);
  updateUI();
  nextBtn.focus();
}
