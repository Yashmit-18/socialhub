import { describe, expect, it } from 'vitest';
import { LEGAL_CONTACT, LEGAL_DOCUMENTS } from './legalContent.js';
import { blockHtml, escapeHtml, inlineHtml, renderLegalDocument } from './legalHtml.js';
import { LEGAL_LINKS } from './legalLinks.js';
import { buildLegalFiles } from './legalPages.js';

const contact = { operator: 'Example Op', email: 'privacy@example.com' };

describe('legal inline markup', () => {
  it('escapes HTML before applying markup, so content cannot inject tags', () => {
    expect(inlineHtml('<script>alert(1)</script> & "x"', contact)).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;',
    );
    expect(escapeHtml(`'`)).toBe('&#39;');
  });

  it('supports bold, code, safe links and contact tokens', () => {
    expect(
      inlineHtml('**a** `b` [c](/terms.html) [d](https://example.com/x?a=1&b=2)', contact),
    ).toBe(
      '<strong>a</strong> <code>b</code> <a href="/terms.html">c</a> <a href="https://example.com/x?a=1&amp;b=2">d</a>',
    );
    // Email links opt out of Cloudflare's obfuscation so the contact stays readable without JS.
    expect(inlineHtml('Run by {{operator}}: {{email}}', contact)).toBe(
      'Run by Example Op: <!--email_off--><a href="mailto:privacy@example.com">privacy@example.com</a><!--/email_off-->',
    );
  });

  it('rejects unsafe links and missing contact details at build time', () => {
    expect(() => inlineHtml('[x](javascript:alert(1))', contact)).toThrow(/Unsafe link/);
    expect(() => inlineHtml('[x](//evil.example)', contact)).toThrow(/Unsafe link/);
    expect(() => inlineHtml('[x](http://insecure.example)', contact)).toThrow(/Unsafe link/);
    expect(() => inlineHtml('{{email}}', { operator: 'Op', email: '' })).toThrow(
      /LEGAL_CONTACT.email/,
    );
    expect(() => blockHtml({ unknown: 1 }, contact)).toThrow(/Unknown legal content block/);
  });

  it('renders lists, steps, notes and tables', () => {
    expect(blockHtml({ list: ['a'] }, contact)).toBe('<ul><li>a</li></ul>');
    expect(blockHtml({ steps: ['a'] }, contact)).toBe('<ol><li>a</li></ol>');
    expect(blockHtml({ note: 'n' }, contact)).toBe('<p class="note">n</p>');
    expect(blockHtml({ table: { head: ['h'], rows: [['c']] } }, contact)).toContain(
      '<th scope="col">h</th>',
    );
  });
});

describe('generated legal pages', () => {
  const files = buildLegalFiles({ year: 2026 });

  it('emits one static HTML file per document plus the shared stylesheet', () => {
    expect([...files.keys()].sort()).toEqual(
      ['data-deletion.html', 'legal.css', 'privacy.html', 'terms.html'].sort(),
    );
    expect(files.get('legal.css').body).toContain('html.dark');
  });

  it('has a real operator and contact address configured', () => {
    expect(LEGAL_CONTACT.operator).toBeTruthy();
    expect(LEGAL_CONTACT.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });

  for (const doc of LEGAL_DOCUMENTS) {
    describe(doc.path, () => {
      const html = files.get(doc.path.slice(1)).body;

      it('is a complete, crawler-readable document with the full text in the HTML', () => {
        expect(html.startsWith('<!doctype html>')).toBe(true);
        expect(html).toContain(`<title>${doc.title} · SocialHub</title>`);
        expect(html).toContain(`<h1>${doc.title}</h1>`);
        expect(html).toMatch(/Last updated: \d{1,2} \w+ \d{4}/);
        for (const section of doc.sections) {
          expect(html).toContain(`<section id="${section.id}"`);
          expect(html).toContain(`<a href="#${section.id}">`);
        }
        // Only the app's external theme script: no inline scripts, no app bundle.
        expect(html.match(/<script\b[^>]*>/g)).toEqual(['<script src="/theme-init.js">']);
      });

      it('links to every legal page, marks itself current and shows the contact', () => {
        for (const link of LEGAL_LINKS) expect(html).toContain(`href="${link.path}"`);
        expect(html).toContain(`href="${doc.path}" aria-current="page"`);
        expect(html).toContain(`href="mailto:${LEGAL_CONTACT.email}"`);
      });

      it('leaves no unfilled tokens or raw markup behind', () => {
        expect(html).not.toMatch(/\{\{|\}\}|\*\*|\]\(|undefined|\bnull\b|TODO/);
      });

      it('makes no certification or compliance claims', () => {
        expect(html).not.toMatch(
          /certif|\bISO ?27001\b|\bSOC ?2\b|\bHIPAA\b|\bPCI\b|GDPR[- ]compliant|CCPA[- ]compliant|fully compliant/i,
        );
      });

      it('only links to pages that exist on this site, in-page anchors, mailto or https', () => {
        const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
        const sitePages = new Set([
          '/',
          '/favicon.svg',
          '/legal.css',
          ...LEGAL_LINKS.map((l) => l.path),
        ]);
        for (const href of hrefs) {
          if (href.startsWith('#')) expect(html).toContain(`id="${href.slice(1)}"`);
          else if (href.startsWith('/')) expect(sitePages.has(href)).toBe(true);
          else expect(href).toMatch(/^(?:mailto:|https:\/\/)/);
        }
      });
    });
  }

  it('describes the facts Meta reviewers look for', () => {
    const privacy = files.get('privacy.html').body;
    for (const fact of [
      'AES-256-GCM',
      'pages_manage_posts',
      'MongoDB Atlas',
      'Cloudflare',
      'We do not sell or rent personal data',
      'simulated',
      '/data-deletion.html',
    ]) {
      expect(privacy).toContain(fact);
    }
    const deletion = files.get('data-deletion.html').body;
    for (const step of [
      'Remove with its accounts',
      'Apps and websites',
      '/api/v1/meta/data-deletion/',
    ]) {
      expect(deletion).toContain(step);
    }
  });

  it('renders the same output for the same input (deterministic build)', () => {
    const doc = LEGAL_DOCUMENTS[0];
    const options = { contact, lastUpdated: '1 January 2026', year: 2026 };
    expect(renderLegalDocument(doc, options)).toBe(renderLegalDocument(doc, options));
  });
});
