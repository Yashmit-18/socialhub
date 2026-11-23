/**
 * Every static legal file the build emits, keyed by its path in `dist`:
 * `privacy.html`, `terms.html`, `data-deletion.html` and their shared `legal.css`.
 * Used by the `socialhub-legal-pages` Vite plugin (vite.config.js) and by the tests.
 */
import { LAST_UPDATED, LEGAL_CONTACT, LEGAL_DOCUMENTS } from './legalContent.js';
import { LEGAL_CSS, renderLegalDocument } from './legalHtml.js';

export function buildLegalFiles({ year } = {}) {
  const files = new Map([['legal.css', { type: 'text/css', body: LEGAL_CSS }]]);
  for (const doc of LEGAL_DOCUMENTS) {
    files.set(doc.path.slice(1), {
      type: 'text/html',
      body: renderLegalDocument(doc, { contact: LEGAL_CONTACT, lastUpdated: LAST_UPDATED, year }),
    });
  }
  return files;
}
