import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// React Compiler 1.0 (stable Oct 2025). Automatic memoization at the
// compiler level — eliminates the manual React.memo/useMemo/useCallback
// dance for most components, and gives measured INP wins in heavily
// interactive UIs:
//   • Wakelet: 30% INP speedup specifically on Radix Dropdowns
//   • Sanity Studio: 20-30% editing frame-rate improvement in production
// Our Renpy editor is exactly that workload (Radix Select/Dropdown +
// dnd-kit per card), so this is the highest impact/effort knob available.
//
// `target: "19"` matches our React version (matters because the compiler
// emits different runtime helpers per React major). Existing React.memo /
// useCallback stay intact — Compiler works alongside them, not instead.
const reactCompilerConfig = {
  target: "19" as const,
};

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", reactCompilerConfig]],
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
