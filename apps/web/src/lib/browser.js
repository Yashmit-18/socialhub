/** Full-page navigation to an external URL (Meta's consent dialog). Isolated for testability. */
export function redirectTo(url) {
  window.location.assign(url);
}
