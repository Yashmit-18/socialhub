/**
 * Renders a legal document (plain data from legalContent.js) to a standalone HTML page.
 * No React and no JavaScript of its own: the pages must be readable by crawlers and must
 * work even if the app bundle fails to load. The only script is the app's tiny external
 * theme-init.js, which applies the user's saved light/dark choice (allowed by the API's
 * Content-Security-Policy because it is same-origin and not inline).
 *
 * Text supports a deliberately small inline syntax, applied AFTER HTML escaping:
 *   **bold**   `code`   [label](href)   {{email}}   {{operator}}
 * Links must be site-relative, in-page, https: or mailto:, anything else throws at build.
 */
import { LEGAL_LINKS } from './legalLinks.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

const SAFE_HREF = /^(?:\/(?!\/)|#|https:\/\/|mailto:)/;

function fillTokens(text, contact) {
  return String(text).replace(/\{\{(email|operator)\}\}/g, (_, key) => {
    const value = contact?.[key];
    if (!value) throw new Error(`Legal content uses {{${key}}} but LEGAL_CONTACT.${key} is empty`);
    return key === 'email' ? `[${value}](mailto:${value})` : value;
  });
}

/** Inline markup to HTML. Input is escaped first, so content can never inject markup. */
export function inlineHtml(text, contact) {
  let html = escapeHtml(fillTokens(text, contact));
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    if (!SAFE_HREF.test(href)) throw new Error(`Unsafe link in legal content: ${href}`);
    const link = `<a href="${href}">${label}</a>`;
    // Cloudflare's Email Address Obfuscation (on by default, e.g. on quick tunnels) rewrites
    // addresses to "[email protected]" plus a decoder script, so readers without JavaScript,
    // including Meta's crawler, would see no contact. These comments are Cloudflare's
    // documented opt-out; a legal contact must stay readable.
    return href.startsWith('mailto:') ? `<!--email_off-->${link}<!--/email_off-->` : link;
  });
  return html;
}

/**
 * Blocks: a string is a paragraph; { list: [...] } a bullet list; { steps: [...] } a
 * numbered list; { note: '...' } a highlighted callout; { table: { head, rows } } a table.
 */
export function blockHtml(block, contact) {
  const inline = (t) => inlineHtml(t, contact);
  if (typeof block === 'string') return `<p>${inline(block)}</p>`;
  if (block.list) return `<ul>${block.list.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`;
  if (block.steps) return `<ol>${block.steps.map((i) => `<li>${inline(i)}</li>`).join('')}</ol>`;
  if (block.note) return `<p class="note">${inline(block.note)}</p>`;
  if (block.table) {
    const head = block.table.head.map((h) => `<th scope="col">${inline(h)}</th>`).join('');
    const rows = block.table.rows
      .map((row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
      .join('');
    return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  throw new Error(`Unknown legal content block: ${JSON.stringify(block)}`);
}

const LOGO_SVG =
  '<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><defs><linearGradient id="sh-logo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#d946ef"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#sh-logo)"/><circle cx="11" cy="16" r="3.2" fill="#fff"/><circle cx="21.5" cy="10" r="2.6" fill="#fff" opacity=".85"/><circle cx="21.5" cy="22" r="2.6" fill="#fff" opacity=".85"/><path d="M13.6 14.6l5.6-3.2M13.6 17.4l5.6 3.2" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>';

function legalNav(currentSlug, label) {
  const items = LEGAL_LINKS.map(
    (l) =>
      `<a href="${l.path}"${l.slug === currentSlug ? ' aria-current="page"' : ''}>${escapeHtml(l.label)}</a>`,
  ).join('');
  return `<nav aria-label="${escapeHtml(label)}">${items}</nav>`;
}

/** A complete HTML document for one legal page. */
export function renderLegalDocument(
  doc,
  { contact, lastUpdated, year = new Date().getFullYear() },
) {
  const inline = (t) => inlineHtml(t, contact);
  const blocks = (list = []) => list.map((b) => blockHtml(b, contact)).join('\n');
  const toc = doc.sections
    .map((s) => `<li><a href="#${s.id}">${escapeHtml(s.heading)}</a></li>`)
    .join('');
  const sections = doc.sections
    .map(
      (s) =>
        `<section id="${s.id}" aria-labelledby="${s.id}-title"><h2 id="${s.id}-title">${escapeHtml(s.heading)}</h2>\n${blocks(s.blocks)}</section>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.title)} · SocialHub</title>
<meta name="description" content="${escapeHtml(doc.description)}">
<meta name="theme-color" content="#4f46e5">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="/legal.css">
<script src="/theme-init.js"></script>
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="site-header"><div class="wrap bar">
<a class="brand" href="/" aria-label="SocialHub home">${LOGO_SVG}<span>Social<span class="hub">Hub</span></span></a>
${legalNav(doc.slug, 'Legal documents')}
</div></header>
<main id="content" class="wrap">
<article>
<p class="eyebrow">Legal</p>
<h1>${escapeHtml(doc.title)}</h1>
<p class="updated">Last updated: ${escapeHtml(lastUpdated)}</p>
<div class="lead">
${blocks(doc.intro)}
</div>
<nav class="toc" aria-label="On this page"><p>On this page</p><ol>${toc}</ol></nav>
${sections}
</article>
</main>
<footer class="site-footer"><div class="wrap">
<p>Questions about this page? Contact ${inline('{{operator}}')} at ${inline('{{email}}')}.</p>
${legalNav(doc.slug, 'All legal documents')}
<p class="fine">© ${year} SocialHub. Facebook and Instagram are trademarks of Meta Platforms, Inc. SocialHub uses Meta’s official APIs and is not affiliated with or endorsed by Meta.</p>
</div></footer>
</body>
</html>
`;
}

/** Shared stylesheet, served as /legal.css. Light by default; `html.dark` from theme-init.js. */
export const LEGAL_CSS = `:root{--bg:#f8fafc;--card:#ffffff;--text:#0f172a;--muted:#475569;--faint:#64748b;--line:#e2e8f0;--brand:#4f46e5;--brand-soft:#eef2ff;--note:#f1f5f9;color-scheme:light}
html.dark{--bg:#020617;--card:#0f172a;--text:#f1f5f9;--muted:#cbd5e1;--faint:#94a3b8;--line:rgba(255,255,255,.1);--brand:#a5b4fc;--brand-soft:rgba(99,102,241,.16);--note:rgba(255,255,255,.05);color-scheme:dark}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--brand);text-underline-offset:3px}
a:focus-visible{outline:2px solid var(--brand);outline-offset:2px;border-radius:4px}
.wrap{width:100%;max-width:820px;margin:0 auto;padding-left:16px;padding-right:16px}
.skip{position:absolute;left:-9999px;top:8px;background:var(--card);color:var(--text);padding:8px 14px;border-radius:999px;z-index:10}
.skip:focus{left:12px}
.site-header{border-bottom:1px solid var(--line);background:var(--card)}
.bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 20px;min-height:64px;padding-top:10px;padding-bottom:10px}
.brand{display:inline-flex;align-items:center;gap:10px;color:var(--text);text-decoration:none;font-weight:600;font-size:17px;letter-spacing:-.01em}
.brand .hub{color:var(--brand)}
nav[aria-label] a{color:var(--muted);text-decoration:none;font-size:14px;padding:6px 10px;border-radius:999px}
nav[aria-label] a:hover{color:var(--text);background:var(--note)}
nav[aria-label] a[aria-current="page"]{color:var(--brand);background:var(--brand-soft);font-weight:600}
.bar nav{display:flex;flex-wrap:wrap;gap:4px;margin:0 -10px}
main{padding-top:40px;padding-bottom:56px}
article{overflow-wrap:anywhere}
.eyebrow{margin:0;color:var(--brand);font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
h1{margin:6px 0 4px;font-size:clamp(28px,6vw,40px);line-height:1.15;letter-spacing:-.025em}
.updated{margin:0 0 24px;color:var(--faint);font-size:14px}
.lead p{font-size:17px;color:var(--muted)}
h2{margin:44px 0 10px;font-size:22px;line-height:1.3;letter-spacing:-.015em;scroll-margin-top:16px}
p,ul,ol{margin:0 0 14px}
ul,ol{padding-left:22px}
li{margin:6px 0}
li::marker{color:var(--faint)}
strong{font-weight:600}
code{font:0.9em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--note);padding:1px 6px;border-radius:6px}
.note{background:var(--brand-soft);border-left:3px solid var(--brand);padding:12px 16px;border-radius:0 12px 12px 0}
.toc{margin:28px 0 8px;padding:16px 20px;background:var(--card);border:1px solid var(--line);border-radius:16px}
.toc p{margin:0 0 6px;font-weight:600;font-size:14px}
.toc ol{margin:0;columns:2 220px;column-gap:28px;font-size:14px}
.toc li{margin:4px 0;break-inside:avoid}
.toc a{text-decoration:none}
.toc a:hover{text-decoration:underline}
.table-wrap{overflow-x:auto;margin:0 0 16px;border:1px solid var(--line);border-radius:12px}
table{border-collapse:collapse;width:100%;font-size:14px;line-height:1.55}
th,td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--line);min-width:140px}
th{background:var(--note);font-weight:600}
tr:last-child td{border-bottom:0}
.site-footer{border-top:1px solid var(--line);background:var(--card);padding:28px 0 36px;font-size:14px;color:var(--muted)}
.site-footer nav{display:flex;flex-wrap:wrap;gap:4px;margin:10px -10px}
.fine{color:var(--faint);font-size:13px;margin-top:12px}
@media print{.site-header nav,.toc,.skip{display:none}body{background:#fff;color:#000}a{color:#000}}
`;
