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
                        if (normalizedId.endsWith('/src/editor/HierarchyFallback.ts')) return 'editor-hierarchy-fallback';
                        if (normalizedId.includes('/src/engine/components/')) return 'engine-components';
                        if (normalizedId.includes('/src/engine/')) return 'engine-core';
                        if (normalizedId.includes('/src/platform/')) return 'platform';
                        if (normalizedId.includes('/src/editor/') && !normalizedId.endsWith('/src/editor/Editor.ts')) {
                            if (normalizedId.includes('/Inspector') || normalizedId.includes('/EditorInspectors')) return 'editor-inspector';
                            if (normalizedId.includes('/Project')) return 'editor-project';
                            if (normalizedId.includes('/Hierarchy')) return 'editor-hierarchy';
                            if (normalizedId.includes('/Scene') || normalizedId.includes('/Viewport') || normalizedId.includes('/Camera')) return 'editor-scene';
                            if (normalizedId.includes('/Console')) return 'editor-console';
                            return 'editor-support';
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
