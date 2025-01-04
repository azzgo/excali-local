import { $ } from "bun";

const run = async () => {
  await Promise.all([
    $`bun --filter ./packages/excali-local zip:chrome`,
    $`bun --filter ./packages/excali-local zip:firefox`,
  ])
}

run()
