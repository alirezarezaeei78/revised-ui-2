import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    files: ["scripts/*.js"],
    // These standalone Node scripts use CommonJS intentionally.
    rules: { "@typescript-eslint/no-require-imports": "off" }
  },
  {
    ignores: [".next/**", "node_modules/**", "out/**"]
  }
];

export default eslintConfig;
