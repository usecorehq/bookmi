/** @type {import('jest').Config} */
module.exports = {
  rootDir: "../..",
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/e2e/**/*.e2e-spec.ts"],
  moduleFileExtensions: ["ts", "tsx", "js", "json"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.json" }],
  },
};
