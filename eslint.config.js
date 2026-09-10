const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");

module.exports = [
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "prisma/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: null, ecmaVersion: 2022, sourceType: "commonjs" },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },
  { ignores: ["dist/**", "node_modules/**"] },
];
