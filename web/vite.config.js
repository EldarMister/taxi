import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { exportLegalDocuments } from './scripts/export-legal-documents.mjs';

export default defineConfig({
  plugins: [tailwindcss(), { name: 'atlas-legal-documents', buildStart: exportLegalDocuments }],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        privacy: resolve(import.meta.dirname, 'privacy/index.html'),
        terms: resolve(import.meta.dirname, 'terms/index.html'),
        deletion: resolve(import.meta.dirname, 'delete-account/index.html'),
        drivers: resolve(import.meta.dirname, 'drivers/index.html'),
      },
    },
  },
});
