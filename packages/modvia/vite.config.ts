import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      codec: "src/codec/index.ts",
      formats: "src/formats/index.ts",
    },
    dts: {
      generator: "tsgo",
    },
    exports: true,
  },
});
