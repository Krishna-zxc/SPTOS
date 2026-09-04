import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Commuters are the reason this is a PWA (PRD §10): a bus stop is exactly where
 * a data connection is worst, and a driver's phone has to keep accepting taps
 * through a dead spot (FR-D6).
 *
 * The caching strategy is where the reliability NFR gets decided, so it is
 * spelled out rather than left to a default:
 *
 *   - the app shell is precached, so the UI always opens;
 *   - the catalogue (routes and stops) is cached, because it barely changes and
 *     an offline commuter can still find their stop;
 *   - **live endpoints are never cached.** A cached position replayed later
 *     would be indistinguishable from a live one, which is the single thing the
 *     transparency NFR forbids. Offline, those requests fail and the UI says so.
 */
const NEVER_CACHE = /\/api\/(routes\/\d+\/live|stops\/\d+\/live|driver|admin|auth)/;
const CATALOGUE = /\/api\/(routes|stops|meta)(\?|$)/;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'SPTOS — Live bus tracker',
        short_name: 'SPTOS',
        description:
          'Live bus positions, stop-level arrival estimates and crowding for city routes.',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/],
        runtimeCaching: [
          { urlPattern: NEVER_CACHE, handler: 'NetworkOnly' },
          {
            urlPattern: CATALOGUE,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'sptos-catalogue',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // OpenStreetMap tiles: the only third-party request we make, and the
            // reason the map still draws on a slow connection (PRD §13 — no
            // billing-enabled map provider).
            urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],

  server: {
    port: 5173,
    // Proxying in dev means the browser only ever talks to one origin, so no
    // CORS preflight and no separate socket URL to configure.
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:4000', ws: true, changeOrigin: true },
    },
  },

  build: { outDir: 'dist', sourcemap: true },
  test: { environment: 'node', include: ['test/**/*.test.js'] },
});
