import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { buildLegalFiles } from './src/pages/legal/legalPages.js';

/**
 * Emits the public legal pages (/privacy.html, /terms.html, /data-deletion.html and
 * /legal.css) as static files, so crawlers such as Meta's privacy policy checker get the
 * full text without running JavaScript. The dev server renders them on request, reloading
 * the content module each time so edits show up without a restart.
 */
function legalPages() {
  return {
    name: 'socialhub-legal-pages',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const name = (req.url ?? '').split('?')[0].slice(1);
        if (!/^(?:[a-z-]+\.html|legal\.css)$/.test(name)) return next();
        try {
          const mod = await server.ssrLoadModule('/src/pages/legal/legalPages.js');
          const file = mod.buildLegalFiles().get(name);
          if (!file) return next();
          res.setHeader('Content-Type', `${file.type}; charset=utf-8`);
          res.end(file.body);
        } catch (error) {
          next(error);
        }
      });
    },
    generateBundle() {
      for (const [fileName, file] of buildLegalFiles()) {
        this.emitFile({ type: 'asset', fileName, source: file.body });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), legalPages()],
  server: {
    port: 5173,
    strictPort: true,
    // The API is proxied so the browser sees a single origin (refresh cookie stays first-party).
    proxy: {
      '/api': { target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000' },
    },
  },
  build: {
    // Maps are still written (for debugging a build locally) but the bundles do not point to
    // them, so browsers do not fetch the original source. dist/*.map is not deployed content.
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
    restoreMocks: true,
  },
});
