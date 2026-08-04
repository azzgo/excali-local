# Code Conventions

> Detail doc linked from [AGENTS.md](../AGENTS.md).

## State management

**Jotai.** Atoms live in each feature's `store/` directory
(`features/editor/store/`, `features/gallery/store/`). Don't introduce Redux/Zustand.

## UI primitives

`excali-page/src/components/ui/` — Radix + shadcn-style + Tailwind v4. Reuse these
before adding new components. Add new ones via
`bun --filter excali-page shadcn:add <name>`.

## Path alias

`@` → `packages/excali-page/src` (Vite alias, defined in `vite.config.mts`).

## Icons

Both `@tabler/icons-react` and `lucide-react` are used:

- `lucide-react` — **page-only**.
- `@tabler/icons-react` — in **both** the shell and the page.

Check which package you're in before importing.

## i18n (two systems — do not mix)

- **Extension shell:** chrome.i18n. Strings in
  `packages/excali-local/public/_locales/{en,zh_CN}/messages.json`, referenced via
  `__MSG_key__` in the manifest.
- **Page app:** i18next + react-i18next. All strings inline in
  `src/locales/locales.ts` (single file, `en`/`zh` resources); initialized by
  `initI18n()` in `main.tsx`.

## Storage (two IndexedDB databases)

- **`excali` (v2):** stores `files`, `drawings`, `collections`
  (`features/editor/utils/indexdb.ts`). The `drawings` store has indexes on
  `updatedAt` and `collectionIds` (multiEntry). Changing the schema **must** bump
  `DB_VERSION` and add an `upgrade()` migration branch — existing users have data.
- **`excali-fonts` (v1):** single `fontConfig` store keyed by `"font-config"`
  (`excali-shared/src/db.ts`).

## Agent bridge (Go daemon)

- **Wire contract**: `packages/excali-shared/src/agent-bridge.ts` is the single source
  of truth for the Leg-B protocol (ports, WS message types, token rules, consent
  keys). The Go daemon mirrors it in `packages/excali-bridge/internal/contract/` —
  change both together (code-gen is a tracked follow-up).
- **Auth posture (011)**: loopback-only; origin allow-list `chrome-extension://<id>` at
  the WS upgrade; ≥128-bit per-session hex token in the `handshake` message. The token
  is **never logged or persisted** — the pidfile holds `{pid, port}` only.
- **Displacement (016/017)**: the daemon holds ≤1 active page; a new activation
  displaces the prior — it receives `{type:"displaced"}` then its socket closes. The
  page hook stops its session and sends `AGENT_BRIDGE_DISPLACED` to its SW. The SW
  (per-profile control plane) stays the consent/UI authority; the daemon is the
  cross-profile arbiter.
- **Leg A (agent CLI)**: versioned minimal JSON-RPC (ADR 0001); CLI subcommand ==
  method. Three command sets are implemented (`excali-bridge <method> [json]`):
  **canvas/v1** (16 — the activated canvas), **gallery/v1** (10 — gallery + collections),
  **fonts/v1** (5 — font config + daemon-local OS-font list); plus daemon-local meta
  (`ping`/`commands.list`/`protocol.version`/`bridge.status`). 33 methods total. The
  agent-facing surface is taught by the `excali-draw` skill (`skills/excali-draw/`); the CLI
  is the stable contract.

## Testing

Vitest + Testing Library + happy-dom. Tests mirror `src/features/...` under
`test/features/...`. Config lives in `excali-page/vite.config.mts`.

- `test/setup.ts` mocks `localStorage`, `sessionStorage`, `requestIdleCallback`, and
  `location`.
- `test/features/editor/hooks/provider.helper.tsx` exports `globalJotaiStore` +
  `ProviderWrapper` — wrap any component-under-test that reads atoms.
- Coverage excludes util/type/locale files and `indexdb.ts` (see `vite.config.mts`).
