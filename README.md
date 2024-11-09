# Excali Local 

To install dependencies:

```bash
bun install
```


Project organizated with mono-repo pattern.

To run the webapp of editor to start developing:

```bash
bun run page:dev
```

use the following command to build the webapp, it will bundle the webapp and put it in the `local` package's `public/editor` folder.

```bash
bun run page:build
```

To developing the local extension, run command:

```bash
bun run local:dev
```

To build the local extension, run command:

```bash
bun run local:build
```

To run the command to archive the local extension build assets, run command:

```bash
bun run local:tar
```

