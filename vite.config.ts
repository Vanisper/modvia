import { defineConfig } from "vite-plus";

function forbidLayers(names: readonly string[]): string[] {
  const patterns: string[] = [];
  for (const name of names) {
    for (const prefix of ["..", "../..", "../../.."]) {
      patterns.push(`${prefix}/${name}`, `${prefix}/${name}/**`);
    }
  }
  return patterns;
}

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        files: ["packages/modvia/src/shared/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: forbidLayers(["scalars", "codec", "primitives", "formats", "model"]),
            },
          ],
        },
      },
      {
        files: ["packages/modvia/src/scalars/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: forbidLayers(["codec", "primitives", "formats", "model"]),
            },
          ],
        },
      },
      {
        files: ["packages/modvia/src/codec/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: forbidLayers(["primitives", "formats", "model"]),
            },
          ],
        },
      },
      {
        files: ["packages/modvia/src/codec/core/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: ["../operators", "../operators/**"],
            },
          ],
        },
      },
      {
        files: ["packages/modvia/src/primitives/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: forbidLayers(["formats", "model"]),
            },
          ],
        },
      },
      {
        files: ["packages/modvia/src/formats/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: forbidLayers(["model"]),
            },
          ],
        },
      },
      {
        files: ["packages/modvia/src/model/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: forbidLayers(["primitives", "formats"]),
            },
          ],
        },
      },
      {
        files: ["packages/modvia/src/model/core/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: ["../operators", "../operators/**"],
            },
          ],
        },
      },
    ],
  },
  run: {
    cache: true,
  },
});
