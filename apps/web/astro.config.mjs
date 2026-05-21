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
      changefreq: 'weekly',
      priority: 0.8,
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
