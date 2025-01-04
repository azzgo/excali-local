import { $ } from "bun";

const run = async () => {
  await Promise.all([
    $`bun --filter ./packages/excali-local clean:editor`,
    $`bun --filter ./packages/excali-local clean:output`,
    $`bun --filter ./packages/excali-local clean:archive`,
  ])
}

run()
