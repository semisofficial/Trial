import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled]):not([type=\"hidden\"])",
  "select:not([disabled])", "textarea:not([disabled])", "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

// Shared across dialogs so a dialog opened from another (cart -> checkout)
// does not release the page scroll lock early.
let lockCount = 0;
let savedOverflow = "";

/* Modal behaviour for an open dialog panel:
   - moves focus to the panel itself (not a field, so phones don't pop the keyboard),
   - Escape calls onClose (when given), Tab stays inside the panel,
   - the page behind cannot scroll while any dialog is open,
   - focus returns to the opening control when the dialog closes. */
export function useModal(open, panelRef, onClose) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const root = document.documentElement;
    if (lockCount++ === 0) {
      savedOverflow = root.style.overflow;
      root.style.overflow = "hidden";
    }
    const panel = panelRef.current;
    panel?.focus({ preventScroll: true });

    const onKeyDown = (event) => {
      if (event.key === "Escape" && onCloseRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll(FOCUSABLE)].filter((element) => element.getClientRects().length > 0);
      if (items.length === 0) { event.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active) || active === panel) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (--lockCount === 0) root.style.overflow = savedOverflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, panelRef]);
}
