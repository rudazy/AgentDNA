/** Minimal ESLint flat config. Prefer `npm run typecheck` and `npm test` as hard gates. */
export default [
  {
    ignores: [".next/**", "node_modules/**", "out/**", "coverage/**"],
  },
];
