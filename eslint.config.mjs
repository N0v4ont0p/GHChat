import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import reactHooksPlugin from "eslint-plugin-react-hooks";

export default [
  {
    ignores: ["out/", "dist/", "node_modules/"],
  },
  {
    ...js.configs.recommended,
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
      "no-undef": "off", // TypeScript handles this
      "no-unused-vars": "off", // TypeScript handles this
    },
  },
];
