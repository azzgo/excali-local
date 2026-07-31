# Architecture

> Detail doc linked from [AGENTS.md](../AGENTS.md). Verified against `main` @ `6461b01` (v1.6.4).

## Three-layer monorepo

Excali Local is a local-first browser extension (Chrome/Firefox/Edge, MV3) that runs
Excalidraw **fully offline**: screenshot annotation, an offline editor, a local gallery
with collections, presentation mode, and custom fonts. No backend — all data in
IndexedDB / localStorage.

Bun workspaces, three packages:

| Package | Role |
| --- | --- |
| `packages/excali-local` | **Extension shell** (WXT). Generates the MV3 manifest; hosts the background service worker, content script, crop script, popup, and options page. Embeds the built editor from `excali-page`. |
| `packages/excali-page` | **Editor app** (React 19 + Vite 5). The Excalidraw UI — editor, gallery, presentation, marker. Ships as a standalone web app and as the extension's editor. |
| `packages/excali-shared` | **Shared layer**. Font-config IndexedDB (`excali-fonts`) + pure utils/types (`cn`, `getBrowser`, `getLang`). Imported via the `excali-shared` workspace alias. |

## Repository layout

```
packages/
  excali-local/            # WXT extension shell
    wxt.config.ts          # manifest generator (perms, commands, i18n)
    entrypoints/
      background.ts        # message-routing hub
      excalidraw.content.ts# .excalidraw detection + "Open with" button
      crop.ts              # select-area screenshot script
      popup/ options/      # React entry UIs
      lib/utils.ts         # shell helpers (cn, ...)
    public/_locales/{en,zh_CN}/messages.json  # chrome.i18n strings
    public/editor/         # GENERATED (gitignored) — output of page:build
  excali-page/
    excalidraw-excalidraw-0.18.0-csp.12.tgz   # local patched Excalidraw dep
    vite.config.mts        # CSP globals, @ alias, Vitest config
    src/
      main.tsx             # single root: mounts <Editor/>, injects fonts
      features/editor/     # editor core: components/ hooks/ store/ utils/ lib/
      features/gallery/    # gallery + collections
      components/ui/       # shadcn-style primitives (Radix + Tailwind)
      lib/ locales/        # utils + i18n
    test/                  # mirrors src/features/...; setup.ts + provider.helper.tsx
  excali-shared/src/       # db.ts (fonts) + index.ts (shared utils/types)
scripts/                   # build.ts clean.ts tar.ts zip.ts sync-version.sh
.github/workflows/release.yml
```

## Data flow & message protocol

`popup / content script → background (message router) → editor tab → READY`.

Message `type` values are string literals (no enum). Defined in
`entrypoints/background.ts` and `features/editor/hooks/use-message-event.ts`:

- **Inbound to background** (from popup/content): `OPEN_LOCAL_EDITOR`,
  `OPEN_QUICK_EDITOR`, `OPEN_QUICK_EDITOR_WITH_JSON`, `CAPTURE_VISIBLE_TAB`,
  `CAPTURE_SELECT_AREA`, `CAPTURE_SELECT_AREA_END`, `CAPTURE_SELECT_AREA_ERROR`.
- **Background → editor tab**: `UPDATE_CANVAS_WITH_SCREENSHOT`,
  `UPDATE_CANVAS_WITH_JSON`.
- **Editor → background**: `READY` (editor finished booting; can accept canvas updates).

Adding a message type: update both the background router and the editor hook.

## Editor boot & forms

Single HTML entry (`index.html` → `src/main.tsx`) mounts `<Editor />` inside a Jotai
`<Provider>`. Boot sequence in `main.tsx`:

1. `initI18n()` (i18next).
2. `injectCustomFonts()` — installs `@font-face` rules before Excalidraw reads them.
3. `initFontConfig(...)` — hands the font config to Excalidraw.
4. `EXCALIDRAW_ASSET_PATH` is set from the Vite-injected env var.

Three editor components under `features/editor/components/`:

- `editor.tsx` — root assembler.
- `local-editor.tsx` — full editor with autosave.
- `quick-editor.tsx` — ephemeral annotation, no save.

## Presentation & marker

- **Presentation:** slides are Excalidraw frame elements, ordered by an index stored
  on each frame's `customData`. Sorting in `utils/assemble.ts`; the index is written in
  `utils/excalidraw-api.helper.ts`. State in `store/presentation.ts`; slide UI in
  `components/slide-*.tsx`; orchestration in `hooks/use-update-slides.ts`.
- **Marker sidebar:** `components/marker-sidebar.tsx` + `hooks/use-marker.ts` +
  `store/marker.ts`. Excalidraw's `renderTopRightUi` does **not** react to external
  state, so the code uses a `forceUpdate` trick to refresh it — preserve that pattern.

## Key file index

| File | Why it matters |
| --- | --- |
| `packages/excali-local/wxt.config.ts` | Manifest, permissions, keyboard commands, Firefox `gecko.id`. |
| `packages/excali-local/entrypoints/background.ts` | Extension hub; all message routing. |
| `packages/excali-local/entrypoints/excalidraw.content.ts` | `.excalidraw` detection + button injection. |
| `packages/excali-local/entrypoints/crop.ts` | Select-area screenshot logic. |
| `packages/excali-page/vite.config.mts` | CSP globals, `@` alias, Vitest config. |
| `packages/excali-page/src/features/editor/utils/indexdb.ts` | `excali` DB schema (v2) + gallery CRUD. |
| `packages/excali-page/src/features/editor/components/local-editor.tsx` | Main editor UI + save pipeline. |
| `packages/excali-page/src/features/gallery/store/gallery-atoms.ts` | Gallery Jotai state. |
| `packages/excali-shared/src/db.ts` + `index.ts` | Font-config storage + shared utils/types. |
| `scripts/{build,clean,tar,zip}.ts` + `sync-version.sh` | Build/pack/version tooling. |
| `.github/workflows/release.yml` | Tag → test → build → pack → draft release. |
