import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    esbuild: {
        keepNames: true
    },
    server: {
        port: 5174,
        strictPort: true,
    },
    build: {
        chunkSizeWarningLimit: 650,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    const normalizedId = id.replace(/\\/g, '/');

                    if (!normalizedId.includes('node_modules')) {
                        if (normalizedId.includes('/src/editor/') && !normalizedId.endsWith('/src/editor/Editor.ts')) {
                            return 'editor-windows';
                        }

                        return;
                    }

                    if (normalizedId.includes('three/examples')) return 'three-examples';
                    if (normalizedId.includes('three')) return 'three-core';
                    if (normalizedId.includes('cannon-es')) return 'physics';

                    return 'vendor';
                }
            }
        }
    }
});
