import { defineConfig } from "vite";
import cliPackageJSON from "../../cli/package.json";

export default defineConfig({
    build: {
        emptyOutDir: true,
        lib: {
            entry: "src/retrom-host.ts",
            fileName: () => "wasm4-retrom.mjs",
            formats: ["es"],
        },
        minify: "terser",
        outDir: "dist/retrom",
        rollupOptions: {
            output: { inlineDynamicImports: true },
        },
        sourcemap: false,
    },
    define: {
        WASM4_GAMEDEV_MODE: false,
        WASM4_VERSION: JSON.stringify(cliPackageJSON.version),
    },
});
