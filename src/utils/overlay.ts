/* Roles rather than a list of stores, so the next overlay costs nothing here. */
const OVERLAY_ROLES = '[role="dialog"], [role="alertdialog"], [role="menu"]';

/**
 * Whether a dialog or a menu is drawn over the page.
 *
 * A screen's own keys - Escape, Ctrl+A - belong to whatever is on top of it
 * while something is, where they mean "close this" or address the list being
 * read rather than the surface underneath.
 */
export function isOverlayOpen(): boolean {
  return document.querySelector(OVERLAY_ROLES) !== null;
}
