import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(), 
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: 'Rakivinum',
          short_name: 'Rakivinum',
          description: 'Digitalni pečat kvaliteta, senzorna analitika i marketing vrhunskih destilerija.',
          theme_color: '#D4AF37',
          background_color: '#0F0F11',
          display: 'standalone',
          orientation: 'portrait',
          icons: [
            { src: '/icon-192-v3.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icon-512-v3.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB limit
          // Do not hijack Firebase / Google auth return navigations with cached index.html
          navigateFallbackDenylist: [/^\/__\//, /^\/firebase-auth/, /^\/community(?:\/)?$/],
          runtimeCaching: [
            {
              urlPattern: ({ request, url }) =>
                request.mode === 'navigate' && /^\/community(?:\/)?$/.test(url.pathname),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'community-navigation',
                networkTimeoutSeconds: 3,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        }
      })
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // firestore.rules / firebase.json menjaju se samo sa firebase deploy — ne treba da prže Vite reload
      watch: {
        ignored: [
          '**/firestore.rules',
          '**/firebase.json',
          '**/.firebaserc',
          '**/firestore.indexes.json',
          '**/backups/**',
          '**/.firebase/**',
          '**/docs/**',
        ],
      },
    },
    build: {
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;

            // Heavy PDF/image stack (largest warning source).
            if (id.includes('html2canvas') || id.includes('jspdf') || id.includes('qrcode')) {
              return 'pdf-stack';
            }

            // Charts and data visualization.
            if (id.includes('recharts') || id.includes('d3')) {
              return 'charts-vendor';
            }

            // Icon set: avoid dozens of tiny icon chunks.
            if (id.includes('lucide-react')) {
              return 'icons-vendor';
            }

            // Firebase SDK split from UI libs.
            if (id.includes('firebase')) {
              return 'firebase-vendor';
            }

            // Keep the rest on Vite default strategy to avoid circular chunk groups.
            return;
          },
        },
      },
    },
  };
});
