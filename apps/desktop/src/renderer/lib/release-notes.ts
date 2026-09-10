/**
 * `electron-updater` hands us the GitHub release body as rendered HTML (it
 * reads releases.atom), and our release bodies are long: download tables,
 * checksum tables, install instructions, auto-updater notes. Only the part
 * above the first horizontal rule is the changelog, so that's what we keep.
 *
 * Whatever survives is then reduced to a small tag whitelist with no
 * attributes except link targets. This is remote content rendered with
 * `dangerouslySetInnerHTML`, so it must not be able to carry markup we didn't
 * ask for — `<img onerror>` runs even though `<script>` wouldn't.
 */

const ALLOWED_TAGS = new Set([
  'H1',
  'H2',
  'H3',
  'H4',
  'P',
  'UL',
  'OL',
  'LI',
  'STRONG',
  'B',
  'EM',
  'I',
  'CODE',
  'PRE',
  'A',
  'BR',
  'DEL',
]);

const DROPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META']);

function sanitize(root: Element, doc: Document): void {
  for (const child of Array.from(root.children)) {
    if (DROPPED_TAGS.has(child.tagName)) {
      child.remove();
      continue;
    }

    sanitize(child, doc);

    if (!ALLOWED_TAGS.has(child.tagName)) {
      // Unwrap rather than delete: a stray <div> or <summary> still holds text
      // worth reading, and images simply disappear because they have no
      // children.
      const contents = doc.createDocumentFragment();
      while (child.firstChild) contents.appendChild(child.firstChild);
      child.replaceWith(contents);
      continue;
    }

    const href = child.tagName === 'A' ? child.getAttribute('href') : null;
    for (const attribute of Array.from(child.attributes)) {
      child.removeAttribute(attribute.name);
    }

    if (href && /^https?:\/\//i.test(href)) {
      child.setAttribute('href', href);
      child.setAttribute('target', '_blank');
      child.setAttribute('rel', 'noopener noreferrer');
    }
  }
}

/**
 * Returns sanitized HTML for the highlights of a release, or an empty string if
 * there is nothing usable.
 */
export function extractReleaseHighlights(html: string): string {
  if (typeof DOMParser === 'undefined') return '';

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const container = doc.createElement('div');

  for (const node of Array.from(doc.body.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'HR') break;
    container.appendChild(node);
  }

  // The generated body opens with a "What's New" heading and closes the section
  // with a "Full changelog:" quote. Both duplicate what the modal already says.
  container.querySelectorAll('blockquote').forEach((quote) => quote.remove());
  for (const heading of Array.from(container.querySelectorAll('h1, h2'))) {
    if (/^what'?s new$/i.test(heading.textContent?.trim() ?? '')) heading.remove();
  }

  sanitize(container, doc);

  return container.innerHTML.trim();
}
