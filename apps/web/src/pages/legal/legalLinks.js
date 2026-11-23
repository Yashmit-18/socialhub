/**
 * The public legal documents. Kept separate from their (long) text so the landing page and
 * the router can link to them without bundling the documents themselves.
 *
 * Each document is a static HTML file generated at build time (see legalPages.js and the
 * `socialhub-legal-pages` plugin in vite.config.js), so crawlers such as Meta's privacy
 * policy checker receive the full text without running JavaScript. `alias` is a short
 * SPA route that forwards to the file.
 */
export const LEGAL_LINKS = [
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    label: 'Privacy',
    path: '/privacy.html',
    alias: '/privacy',
  },
  {
    slug: 'terms',
    title: 'Terms of Service',
    label: 'Terms',
    path: '/terms.html',
    alias: '/terms',
  },
  {
    slug: 'data-deletion',
    title: 'Data Deletion Instructions',
    label: 'Data deletion',
    path: '/data-deletion.html',
    alias: '/data-deletion',
  },
];

export const legalLink = (slug) => LEGAL_LINKS.find((link) => link.slug === slug);
