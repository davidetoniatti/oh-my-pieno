const FOCUSABLE_SELECTOR = 'button, [href], [tabindex]:not([tabindex="-1"])';

export function createModal({ id, ariaLabel, onClose, className = "" }) {
  const previouslyFocused = document.activeElement;

  const overlay = document.createElement("div");
  overlay.id = id;
  // Note: overlay styling (inset 0, z-index, etc) should be in CSS
  // We'll use the existing patterns from style.css

  const modal = document.createElement("div");
  modal.className = `tutorial-modal ${className}`;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  if (ariaLabel) {
    modal.setAttribute("aria-labelledby", ariaLabel);
  }
  modal.tabIndex = -1;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const close = () => {
    document.removeEventListener("keydown", onKeydown, true);
    overlay.classList.add("fade-out");

    const remove = () => {
      overlay.remove();
      if (onClose) onClose();
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
    
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }

    if (e.key === "Tab") {
      const focusables = Array.from(modal.querySelectorAll(FOCUSABLE_SELECTOR));
      const visible = focusables.filter(el => {
        // Simple visibility check
        return !el.classList.contains("hidden") && el.offsetParent !== null;
      });

      if (visible.length === 0) return;
      
      const first = visible[0];
      const last = visible[visible.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  document.addEventListener("keydown", onKeydown, true);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  return { overlay, modal, close };
}
