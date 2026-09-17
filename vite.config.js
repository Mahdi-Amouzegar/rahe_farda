// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// vite.config.js — Vite + Vitest configuration

import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    // ⚠️ برای GitHub Pages: نام ریپازیتوری را اینجا بگذار
    // اگر ریپازیتوری با نام rahe_farda است، این مقدار را '/rahe_farda/' نگه دار.
    // برای دامنه اختصاصی یا Netlify/Vercel، این را به '/' تغییر بده.
    base: '/rahe_farda/',

    server: {
        port: 5173,
        open: true,
        strictPort: false,
    },

    preview: {
        port: 4173,
        open: true,
    },

    build: {
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: true,
        minify: 'esbuild',
        target: 'es2020',

        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
            },
            output: {
                entryFileNames: 'assets/[name]-[hash].js',
                chunkFileNames: 'assets/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash].[ext]',
            },
        },

        chunkSizeWarningLimit: 1000,
    },

    test: {
        environment: 'jsdom',
        globals: true,
        include: ['test/**/*.test.js'],
        exclude: ['node_modules', 'dist'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
        },
    },
});