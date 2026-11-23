import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("pdfjs-dist")) return "pdf-preview";
          if (id.includes("pdf-lib") || id.includes("pako"))
            return "pdf-export";
        },
      },
    },
  },
});
