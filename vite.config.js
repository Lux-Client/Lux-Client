import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    base: './',
    
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@components': path.resolve(__dirname, './src/components'),
            '@pages': path.resolve(__dirname, './src/pages'),
            '@hooks': path.resolve(__dirname, './src/hooks'),
            '@context': path.resolve(__dirname, './src/context'),
            '@config': path.resolve(__dirname, './src/config'),
            '@lib': path.resolve(__dirname, './src/lib'),
            '@services': path.resolve(__dirname, './src/services'),
            '@utils': path.resolve(__dirname, './src/utils'),
            '@locales': path.resolve(__dirname, './src/locales'),
        },
    },
    
    build: {
        outDir: 'dist',
        sourcemap: false,
        minify: 'esbuild',
        target: 'esnext',
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
            output: {
                manualChunks: {
                    'vendor-react': ['react', 'react-dom'],
                    'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-select'],
                    'vendor-three': ['three'],
                    'vendor-hotkeys': ['@tanstack/react-hotkeys'],
                },
            },
        },
    },
    
    server: {
        port: 3000,
        hmr: {
            overlay: true,
        },
    },
    
    optimizeDeps: {
        include: ['react', 'react-dom', 'three', '@tanstack/react-hotkeys'],
        force: true,
    },
    
    cacheDir: 'node_modules/.vite',
    
    worker: {
        format: 'es',
    },
    
    esbuild: {
        legalComments: 'none',
        treeShaking: true,
        minifyIdentifiers: true,
        minifySyntax: true,
    },
    
    css: {
        modules: {
            localsConvention: 'camelCaseOnly',
        },
    },
    
    preview: {
        port: 3001,
    },
});