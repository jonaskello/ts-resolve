/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/src/**/?(*.)+(spec|test).[jt]s?(x)"],
  collectCoverage: false, // we use --coverage in the script instead
  collectCoverageFrom: ["src/**/*.ts"],
  coverageReporters: ["text-summary", "lcov"],
};
