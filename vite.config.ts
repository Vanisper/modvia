import { defineConfig } from "vite-plus";

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
              patterns: [
                "../codec",
                "../codec/**",
                "../formats",
                "../formats/**",
                "../model",
                "../model/**",
              ],
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
              patterns: [
                "../formats",
                "../formats/**",
                "../../formats",
                "../../formats/**",
                "../model",
                "../model/**",
                "../../model",
                "../../model/**",
              ],
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
              patterns: ["../model", "../model/**", "../../model", "../../model/**"],
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
              patterns: ["../formats", "../formats/**", "../../formats", "../../formats/**"],
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
              patterns: ["../scalars", "../scalars/**", "../operators", "../operators/**"],
            },
          ],
        },
      },
      {
        files: ["packages/modvia/src/codec/scalars/**"],
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
        files: ["packages/modvia/src/codec/operators/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: ["../scalars", "../scalars/**"],
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
