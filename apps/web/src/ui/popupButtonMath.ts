/** Shared `PopupMenuItem.closesPopup` default: YES. */
export function popupButtonCloses(closesPopup: boolean | undefined): boolean {
  return closesPopup ?? true;
}
