// RULE A fixture: the portable zone must not touch web globals.
export function readTitle(): string {
  return document.title + String(window.innerWidth) + String(localStorage.length);
}
