import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/dist", "**/coverage", "**/node_modules", "apps/server/migrations"] },

  // All TypeScript
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      eqeqeq: ["error", "always"],
    },
  },

  // Node: server, core and config files
  {
    files: ["apps/server/**/*.ts", "packages/**/*.ts", "*.{js,ts}", "apps/*/*.{js,ts}"],
    languageOptions: { globals: globals.node },
  },

  // Browser: web app
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },

  // shadcn/ui components export variants next to components; that is expected.
  {
    files: ["apps/web/src/components/ui/**/*.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },

  // Must be last: turns off rules that conflict with Prettier.
  prettier,
);
