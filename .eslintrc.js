module.exports = {
  extends: "divid",
  parserOptions: {
    project: "./tsconfig.json",
  },
  ignorePatterns: ["**/__examples__/**/*"],
  rules: {
    "@typescript-eslint/consistent-type-imports": "off",
    "@typescript-eslint/no-unnecessary-condition": "off",
    "@typescript-eslint/prefer-readonly-parameter-types": "off",
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
  },
};
