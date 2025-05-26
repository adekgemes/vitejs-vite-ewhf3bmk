// File: vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills'; // Import plugin

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // Opsi untuk plugin, misalnya:
      // Apakah akan menyertakan polyfill untuk 'global'. Defaultnya true.
      global: true,
      // Apakah akan menyertakan polyfill untuk 'buffer'. Defaultnya true.
      buffer: true,
      // Apakah akan menyertakan polyfill untuk 'process'. Defaultnya true.
      process: true,
      // Anda bisa menonaktifkan polyfill tertentu jika tidak dibutuhkan
      // crypto: false, // Contoh jika Anda tidak ingin polyfill crypto
    }),
  ],
  // Bagian define mungkin tidak lagi diperlukan jika nodePolyfills bekerja dengan baik
  // define: {
  //   'global': 'globalThis', // Lebih modern dari 'window' atau '{}'
  // },
  resolve: {
    alias: {
      // Jika ada alias spesifik yang dibutuhkan, tambahkan di sini
      // Contoh: 'stream': 'stream-browserify', (biasanya ditangani oleh nodePolyfills)
    },
  },
  // Optimasi build (opsional, tapi baik untuk produksi)
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            return id
              .toString()
              .split('node_modules/')[1]
              .split('/')[0]
              .toString();
          }
        },
      },
    },
  },
});
