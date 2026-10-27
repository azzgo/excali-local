# L4 — real-browser acceptance (manual, user-intervenable)

The automated closure (`pnpm layout:verify`) proves the algorithm against the
real Excalidraw *transform* in happy-dom. It cannot prove two things:

1. that the renderer actually paints what the transform produced;
2. that the result looks right to a human.

This procedure closes those two. It is deliberately **not** headless: the point
is that a person can watch the canvas and intervene.

## Prerequisites

```bash
pnpm page:dev            # → http://localhost:3000
```

Open **`http://localhost:3000/?type=local`** — the bare root renders an empty
fragment by design (`editor.tsx` dispatches on `?type=`), so a blank page there
is not a bug.

## Run

1. In the browser devtools console, paste the contents of
   [`scripts/l4/inject-ab.js`](l4/inject-ab.js) and run it.
2. It returns the measured label sizes plus both arms' audit results. Expect:

   | arm | overlaps | gutters | overflow | unbound | wrapped | bounds |
   | --- | --- | --- | --- | --- | --- | --- |
   | baseline | 0 | 0 | 1 | 0 | 5 | 1680×290 |
   | candidate | 0 | 0 | 0 | 0 | 0 | 1549×208 |

3. The canvas is left showing the **candidate** arm. Screenshot it, then change
   the last `render(placeCandidate())` to `render(placeBaseline())`, re-run, and
   screenshot the baseline.
4. Compare: the baseline forces five labels onto a second line (the boxes are a
   fixed 180×90), the candidate sizes each box from its measured label and none
   wrap. Both are geometrically valid — this is exactly why the audit reports
   `readabilityOk` separately from `ok`.

## Why this is a separate script and not a test

The script reaches into the page's live React fiber to find `excalidrawAPI`
(the page does not expose it unless the agent bridge is active) and imports the
transform from the page's own module graph. Both are browser-only moves that
would be brittle in CI — and their value is the screenshot a human looks at,
not an assertion.
