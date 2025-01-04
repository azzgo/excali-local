import { $ } from "bun";

const run = async () => {
  await Promise.all([
    $`bun --filter ./packages/excali-local tar:chrome`,
    $`bun --filter ./packages/excali-local tar:firefox`,
  ])
}

run()
