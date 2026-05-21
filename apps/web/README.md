# @magicterm/web

The marketing site for [magicterm.app](https://magicterm.app).

## Stack

- **[Astro 5](https://astro.build/)** — static site generator, ships zero JavaScript
  by default and is built to be SEO-friendly out of the box.
- **Tailwind CSS 4** (Vite plugin) — utility classes built on top of the same
  CSS-variable design tokens we use in the desktop app, so theming stays consistent.
- **Framer Motion + Lenis** — reserved for future scroll-driven animations
  (currently using native CSS scroll-timeline / view-timeline where supported).
- **`@astrojs/sitemap`** — auto-generates a sitemap on build.
- **Sharp** — runtime image optimisation pipeline.

## Develop

```bash
pnpm install
pnpm --filter @magicterm/web dev
```

Then open http://localhost:4321.

## Build

```bash
pnpm --filter @magicterm/web build
```

Output lands in `dist/`. Cloudflare Pages deploys this on push to `main`
(see `.github/workflows/web-deploy.yml`).

## Screenshots

The site expects screenshots under `public/screenshots/`. See
[`public/screenshots/README.md`](./public/screenshots/README.md) for filenames
and capture guidance.

The site renders its own browser frame (traffic lights + header) around each
image, so you only need to capture the **content** of the Magic Term window —
no macOS title bar, no shadow.

## Analytics

Cloudflare Web Analytics — see `src/layouts/Base.astro`. Replace
`REPLACE_WITH_CF_ANALYTICS_TOKEN` with the token from your Cloudflare dashboard
(Analytics → Web Analytics → Beacon) once the site is deployed.

## SEO

- Static HTML for every route → search engines crawl just fine.
- `<title>`, `<meta name="description">`, OG, Twitter cards on every page (see `Base.astro`).
- JSON-LD `SoftwareApplication` structured data on the home page.
- `robots.txt` and auto-generated `sitemap-index.xml`.
- Canonical URLs default to the rendered route on `magicterm.app`.
