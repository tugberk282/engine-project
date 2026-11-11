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
        // Three's ESM distribution is one indivisible ~659 kB module; every app-owned chunk stays far below this bound.
        chunkSizeWarningLimit: 670,
        rolldownOptions: {
            output: {
                codeSplitting: {
                    groups: [
                        {
                            name: 'three-examples', test: /node_modules[\\/]three[\\/]examples/,
                            includeDependenciesRecursively: false, priority: 120
                        },
                        {
                            name: 'three-core', test: /node_modules[\\/]three[\\/]build/,
                            includeDependenciesRecursively: false, priority: 110
                        },
                        { name: 'physics', test: /node_modules[\\/]cannon-es/, priority: 100 },
                        { name: 'vendor', test: /node_modules/, priority: 90 },
                        { name: 'editor-hierarchy-fallback', test: /src[\\/]editor[\\/]HierarchyFallback\.ts$/, priority: 80 },
                        { name: 'engine-components', test: /src[\\/]engine[\\/]components[\\/]/, priority: 70 },
                        { name: 'engine-core', test: /src[\\/]engine[\\/]/, priority: 60 },
                        { name: 'platform', test: /src[\\/]platform[\\/]/, priority: 50 },
                        { name: 'editor-inspector', test: /src[\\/]editor[\\/](?:Inspector|EditorInspectors)/, priority: 40 },
                        { name: 'editor-project', test: /src[\\/]editor[\\/]Project/, priority: 35 },
                        { name: 'editor-hierarchy', test: /src[\\/]editor[\\/]Hierarchy/, priority: 30 },
                        { name: 'editor-scene', test: /src[\\/]editor[\\/](?:Scene|Viewport|EditorCamera)/, priority: 25 },
                        { name: 'editor-console', test: /src[\\/]editor[\\/]Console/, priority: 20 },
                        {
                            name: 'editor-support',
                            test: (id) => /src[\\/]editor[\\/]/.test(id) && !/src[\\/]editor[\\/]Editor\.ts$/.test(id),
                            priority: 10
                        }
                    ]
                }
            }
        }
    }
});
