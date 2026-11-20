// Applies the saved colour theme before first paint to avoid a light/dark flash.
(function () {
  try {
    var saved = localStorage.getItem('sh-theme');
    var dark =
      saved === 'dark' ||
      ((!saved || saved === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {
    /* storage or matchMedia unavailable: keep the default light theme */
  }
})();
