import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["node_modules", "test-results", "playwright-report", "data"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/client/sw.js"],
    languageOptions: {
      globals: {
        self: "readonly",
      },
    },
  },
);
