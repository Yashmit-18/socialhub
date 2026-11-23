/** Isolated so tests can observe the navigation (jsdom cannot navigate). */
export const legalNavigation = {
  replace: (url) => window.location.replace(url),
};
