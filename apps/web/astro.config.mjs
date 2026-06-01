import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://magicterm.app',
  output: 'static',
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'viewport',
  },
  build: {
    inlineStylesheets: 'auto',
    assets: '_astro',
  },
  image: {
    domains: ['github.com', 'avatars.githubusercontent.com'],
  },
  integrations: [
    react(),
    sitemap({
      // Exclude pages we never want indexed (auth callbacks marked noindex,
      // 404, etc.) so Search Console doesn't flag "submitted URL marked
      // noindex" warnings.
      filter: (page) => !page.includes('/auth/') && !page.endsWith('/404/'),
      changefreq: 'weekly',
      priority: 0.8,
      serialize(item) {
        // Boost priority of the homepage and the strongest landing pages.
        if (item.url === 'https://magicterm.app/') {
          return { ...item, priority: 1.0, changefreq: 'weekly' };
        }
        if (
          item.url.startsWith('https://magicterm.app/download') ||
          item.url.startsWith('https://magicterm.app/termius-alternative') ||
          item.url.startsWith('https://magicterm.app/ssh-client-')
        ) {
          return { ...item, priority: 0.9, changefreq: 'weekly' };
        }
        return item;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
