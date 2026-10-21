"use client";

// LEAVING A TAB CLOSES WHAT THAT TAB PUT ON THE SCREEN.
//
// Ben, 2026-09-15: "when switching between tab bars in the quote builder, certain artifacts
// remain … Verify neither of these things can ever happen to any window."
//
// THE MECHANISM, because it is not obvious and the obvious guess is wrong. A tab that is not
// open is hidden with `visibility: hidden` rather than unmounted (QuoteToolShell explains why:
// both screens size themselves from their own box and would recompute from nothing on the way
// back). Visibility INHERITS, and it inherits into `position: fixed` children too — so a fixed
// overlay inside a hidden tab is correctly hidden with it. What escapes is a PORTAL: a dialog
// rendered into <body> is not a DOM descendant of the tab at all, so it inherits nothing and
// simply stays on screen.
//
// Reproduced 2026-09-15: open Catalog, open a range, open the photograph full-screen, press
// Quote Builder. The tab changes and a 1500x900 `role="dialog"` remains, painted over the quote.
//
// WHY AN EVENT RATHER THAN A PROP. The two dialogs this covers are portalled from inside the
// catalogue, which is inside ChatScreen, which is inside the shell — threading "is my tab still
// open" down that chain means three components carrying a fact none of them are about, and the
// next portal somebody adds will not be given it. The tab strip is the one place that knows a
// switch happened, and a dialog is the one place that knows how to close itself. This is the
// wire between them, and it is the same shape as the Escape handler each of them already has.
//
// IT FIRES ON A REAL CHANGE ONLY. FolderTabs calls onSelect for a press on the tab that is
// already open — that is how the arrow keys work — and announcing there would close a dialog
// somebody had just opened from the tab they are standing on.

import { useEffect } from "react";

const TAB_SWITCH_EVENT = "hoh:tab-switch";

/** Called by the tab strip when the OPEN tab changes. */
export function announceTabSwitch() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TAB_SWITCH_EVENT));
}

/**
 * Close this when the window behind it changes tab.
 *
 * For anything portalled out of the tree — `createPortal` to <body> — because that is exactly
 * what the tab's own `visibility: hidden` cannot reach. A dialog rendered inside its tab needs
 * nothing: it is hidden with everything else.
 */
export function useCloseOnTabSwitch(onClose: () => void) {
  useEffect(() => {
    const onSwitch = () => onClose();
    window.addEventListener(TAB_SWITCH_EVENT, onSwitch);
    return () => window.removeEventListener(TAB_SWITCH_EVENT, onSwitch);
  }, [onClose]);
}
