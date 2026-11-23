import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      codec: "src/codec.ts",
      formats: "src/formats.ts",
    },
    platform: "neutral",
    dts: {
      generator: "tsgo",
    },
    exports: true,
    publint: true,
    attw: {
      profile: "esm-only",
    },
  },
});
