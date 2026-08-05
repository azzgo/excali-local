import { spawn } from "node:child_process";

const run = (script: string) =>
  new Promise<void>((resolve, reject) => {
    const p = spawn("pnpm", ["--filter", "./packages/excali-local", script], {
      stdio: "inherit",
      shell: true,
    });
    p.on("close", (code) =>
      code ? reject(new Error(`${script} failed (exit ${code})`)) : resolve(),
    );
  });

await Promise.all([run("clean:editor"), run("clean:output"), run("clean:archive")]);
