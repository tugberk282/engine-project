import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        port: 5174,
        strictPort: true,
    },
    build: {
        chunkSizeWarningLimit: 650,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes('node_modules')) return;

                    if (id.includes('three/examples')) return 'three-examples';
                    if (id.includes('three')) return 'three-core';
                    if (id.includes('cannon-es')) return 'physics';

                    return 'vendor';
                }
            }
        }
    }
});
