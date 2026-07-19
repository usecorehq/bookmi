/** @type {import('jest').Config} */
const base = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleFileExtensions: ["ts", "tsx", "js", "json"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.json" }],
  },
};

module.exports = {
  rootDir: ".",
  projects: [
    {
      ...base,
      displayName: "unit",
      testMatch: ["<rootDir>/src/**/*.spec.ts"],
    },
    {
      ...base,
      displayName: "integration",
      testMatch: ["<rootDir>/test/integration/**/*.int-spec.ts"],
      globalSetup: "<rootDir>/test/integration/setup-testcontainers.ts",
      globalTeardown: "<rootDir>/test/integration/teardown-testcontainers.ts",
    },
  ],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.module.ts",
    "!src/main.ts",
    "!src/seed.ts",
    "!src/drizzle/schema.ts",
  ],
};
