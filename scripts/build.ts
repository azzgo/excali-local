import { $ } from "bun";

const run = async () => {
  await Promise.all([
    $`bun --filter ./packages/excali-local build:chrome`,
    $`bun --filter ./packages/excali-local build:firefox`,
  ])
}

run()
