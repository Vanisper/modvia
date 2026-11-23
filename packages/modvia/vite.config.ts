import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      codec: "src/codec.ts",
      formats: "src/formats.ts",
    },
    dts: {
      generator: "tsgo",
    },
    exports: true,
  },
});
