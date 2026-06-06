import { defineConfig } from "vite";

export default defineConfig({
    root: ".",
    base: "/",
    publicDir: "public",
    build: {
        outDir: "dist",
        emptyOutDir: true,
        target: "es2020",
        minify: "esbuild",
        cssCodeSplit: true,
        sourcemap: false,
        rollupOptions: {
            output: {
                manualChunks: undefined,
            },
        },
    },
    server: {
        port: 5173,
        strictPort: false,
    },
});
