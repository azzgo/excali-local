// Plain config object (no `vitest/config` import): keeps the config loadable
// even before the workspace install links this package's node_modules.
export default {
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}
