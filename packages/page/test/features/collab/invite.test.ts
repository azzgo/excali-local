import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  encodeRoomInvite,
  encodeServerInvite,
  parseInvite,
  type RoomInvite,
  type ServerInvite,
} from "collab-core";
import {
  copyInvite,
  copyInviteCode,
  copyText,
  dialServer,
  extractInviteToken,
  fingerprint,
  inviteClipboardText,
  inviteCode,
  inviteSentence,
  parsePastedInvite,
  pasteSeverity,
  type PasteSeverity,
  type Translate,
} from "@/features/collab/invite";
import PasteWarnings from "@/features/collab/paste-warnings";
import ShareStep from "@/features/collab/share-step";
import type { ServerConfig } from "@/features/collab/storage";

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

/** 32-byte base64url key (43 chars, no padding) — collab-core validates length. */
const KEY43 = "A".repeat(43);
/** 16-byte base64url shareId (22 chars) — collab-core validates length. */
const SHARE_ID = "B".repeat(22);

/** Structural t() double: returns the key, or key(vars) so tests can assert interpolation. */
const t = ((key: string, vars?: object) =>
  vars === undefined
    ? key
    : `${key}(${Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join(",")})`) as unknown as Translate;

const serverInvite = (relay = "wss://relay.example.com", org = "Acme"): ServerInvite => ({
  relay,
  org,
  sk: KEY43,
  ck: KEY43,
});

const storedServer: ServerConfig = {
  relay: "wss://relay.example.com",
  org: "Acme",
  sk: KEY43,
  ck: KEY43,
};

/* ------------------------------ clipboard stubs ------------------------------ */

function stubClipboard(impl?: (text: string) => Promise<void>) {
  const writeText = vi.fn(impl ?? (() => Promise.resolve()));
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

function removeClipboard() {
  delete (navigator as unknown as Record<string, unknown>).clipboard;
}

let hadExecCommand = false;
let originalExecCommand: unknown;
function stubExecCommand(ok: boolean) {
  if (!hadExecCommand) {
    hadExecCommand = true;
    originalExecCommand = (document as unknown as Record<string, unknown>).execCommand;
  }
  (document as unknown as Record<string, unknown>).execCommand = vi.fn(() => ok);
}

function restoreExecCommand() {
  if (!hadExecCommand) return;
  const doc = document as unknown as Record<string, unknown>;
  if (originalExecCommand === undefined) delete doc.execCommand;
  else doc.execCommand = originalExecCommand;
  hadExecCommand = false;
}

/* ------------------------------- WebSocket stub ------------------------------ */

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  close() {
    this.onclose?.();
  }
}

afterEach(() => {
  cleanup();
  removeClipboard();
  restoreExecCommand();
  vi.unstubAllGlobals();
  FakeWebSocket.instances = [];
  vi.restoreAllMocks();
});

/* ------------------------------- clipboard + sentence ------------------------ */

describe("invite clipboard (054 Q1: sentence + code)", () => {
  test("copyInvite writes sentence + code containing the token", async () => {
    const writeText = stubClipboard();
    const payload: RoomInvite = { shareId: SHARE_ID, tier: "private", roomSecret: KEY43 };
    expect(await copyInvite(t, "room", payload, { name: "Sprint" })).toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain(encodeRoomInvite(payload)); // the token
    expect(text).toContain("name=Sprint");
    expect(text).toContain("tier=CollabTierLabelPrivate");
    expect(text).toContain("\n"); // sentence + code
  });

  test("copyInviteCode writes the bare code only (share-step secondary)", async () => {
    const writeText = stubClipboard();
    const payload: RoomInvite = { shareId: SHARE_ID, tier: "team" };
    expect(await copyInviteCode("room", payload)).toBe(true);
    expect(writeText).toHaveBeenCalledWith(encodeRoomInvite(payload));
  });

  test("server invite sentence interpolates the org label (opt.gen.clipboard)", () => {
    expect(inviteSentence(t, "server", serverInvite())).toContain("org=Acme");
    const text = inviteClipboardText(t, "server", serverInvite());
    expect(text).toContain("org=Acme");
    expect(text).toContain(encodeServerInvite(serverInvite()));
  });

  test("room tier label: private → encrypted, team → team", () => {
    const priv = inviteSentence(t, "room", { shareId: SHARE_ID, tier: "private" }, { name: "X" });
    expect(priv).toContain("tier=CollabTierLabelPrivate");
    const team = inviteSentence(t, "room", { shareId: SHARE_ID, tier: "team" }, { name: "X" });
    expect(team).toContain("tier=CollabTierLabelTeam");
  });

  test("clipboard fallback: async API rejects → execCommand path", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    stubExecCommand(true);
    expect(await copyText("fallback text")).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  test("clipboard fallback: no async API at all → execCommand path", async () => {
    // happy-dom ships a native navigator.clipboard via a prototype getter — shadow it
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    stubExecCommand(true);
    expect(await copyText("fallback text")).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  test("clipboard fallback: both paths fail → false", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    stubExecCommand(false);
    expect(await copyText("x")).toBe(false);
  });
});

/* --------------------------------- parsing ---------------------------------- */

describe("parsePastedInvite (054 Q1: sentence+code OR bare code)", () => {
  test("sentence + code and bare code both parse to the same room invite", () => {
    const code = encodeRoomInvite({ shareId: SHARE_ID, tier: "team" });
    const sentence = `Join me in「Sprint」(team) — paste this into Excali Local → Collaborate:\n${code}`;
    expect(parsePastedInvite(sentence)).toEqual({ kind: "room", shareId: SHARE_ID, tier: "team" });
    expect(parsePastedInvite(code)).toEqual({ kind: "room", shareId: SHARE_ID, tier: "team" });
  });

  test("extractInviteToken finds the token inside chat text; garbage → null", () => {
    const code = encodeRoomInvite({ shareId: SHARE_ID, tier: "team" });
    expect(extractInviteToken(`here is my invite: ${code} thanks!`)).toBe(code);
    expect(extractInviteToken("no token here")).toBeNull();
  });

  test("garbage → kind 'none' (maps to error severity)", () => {
    expect(parsePastedInvite("this is not an invite at all").kind).toBe("none");
    expect(pasteSeverity(parsePastedInvite("garbage"), { server: null })).toEqual({
      kind: "error",
      reason: "none",
    });
  });

  test("parse round-trips via collab-core: room (team + private w/ secret + fp) and server", () => {
    const fp = fingerprint("wss://relay.example.com");
    const team = encodeRoomInvite({ shareId: SHARE_ID, tier: "team", fp });
    expect(parseInvite(team)).toEqual({ kind: "room", shareId: SHARE_ID, tier: "team", fp });

    const priv = encodeRoomInvite({
      shareId: SHARE_ID,
      tier: "private",
      roomSecret: KEY43,
      fp: "fp-abc123",
    });
    expect(parseInvite(priv)).toEqual({
      kind: "room",
      shareId: SHARE_ID,
      tier: "private",
      roomSecret: KEY43,
      fp: "fp-abc123",
    });

    const srv = encodeServerInvite(serverInvite());
    expect(parseInvite(srv)).toEqual({
      kind: "server",
      relay: "wss://relay.example.com",
      org: "Acme",
      sk: KEY43,
      ck: KEY43,
    });
  });
});

/* --------------------------------- severity --------------------------------- */

describe("pasteSeverity (054 Q4/Q5/Q9 grammar)", () => {
  const room = (over: Partial<RoomInvite> = {}): RoomInvite => ({
    shareId: SHARE_ID,
    tier: "team",
    ...over,
  });

  test("no-key: private room without roomSecret → red + disabled (Q4)", () => {
    const parsed = parsePastedInvite(encodeRoomInvite(room({ tier: "private" })));
    expect(pasteSeverity(parsed, { server: storedServer })).toEqual({ kind: "no-key" });
    // no-key beats unreachable — the key is the fundamental problem
    expect(
      pasteSeverity(parsed, { server: storedServer, dial: "unreachable" }),
    ).toEqual({ kind: "no-key" });
  });

  test("ok: team room and private room with secret", () => {
    expect(pasteSeverity(parsePastedInvite(encodeRoomInvite(room())), { server: storedServer })).toEqual({
      kind: "ok",
    });
    expect(
      pasteSeverity(parsePastedInvite(encodeRoomInvite(room({ tier: "private", roomSecret: KEY43 }))), {
        server: storedServer,
      }),
    ).toEqual({ kind: "ok" });
  });

  test("fp-mismatch: invite fp ≠ fingerprint(configured relay) → amber warn-only (Q5)", () => {
    const parsed = parsePastedInvite(
      encodeRoomInvite(room({ fp: "deadbeef" })),
    );
    expect(pasteSeverity(parsed, { server: storedServer })).toEqual({ kind: "fp-mismatch" });
    // matching fp → ok
    const matching = parsePastedInvite(
      encodeRoomInvite(room({ fp: fingerprint(storedServer.relay) })),
    );
    expect(pasteSeverity(matching, { server: storedServer })).toEqual({ kind: "ok" });
    // no server configured → nothing to compare against
    expect(pasteSeverity(parsed, { server: null })).toEqual({ kind: "ok" });
  });

  test("unreachable: dial failure → red; server vs room copy selection (Q9)", () => {
    const srv = pasteSeverity(parsePastedInvite(encodeServerInvite(serverInvite())), {
      server: storedServer,
      dial: "unreachable",
    });
    expect(srv).toEqual({ kind: "unreachable", inviteKind: "server" });

    const r = pasteSeverity(parsePastedInvite(encodeRoomInvite(room())), {
      server: storedServer,
      dial: "unreachable",
    });
    expect(r).toEqual({ kind: "unreachable", inviteKind: "room" });

    // unreachable beats fp-mismatch (red > amber)
    const fp = pasteSeverity(
      parsePastedInvite(encodeRoomInvite(room({ fp: "deadbeef" }))),
      { server: storedServer, dial: "unreachable" },
    );
    expect(fp).toEqual({ kind: "unreachable", inviteKind: "room" });
  });

  test("loopback: probe skipped (060 neutral — never an error state)", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    expect(await dialServer("http://127.0.0.1:1999")).toBe("skipped");
    expect(FakeWebSocket.instances).toHaveLength(0);
    // severity stays ok (or fp-level) — no unreachable for loopback
    const parsed = parsePastedInvite(
      encodeServerInvite(serverInvite("http://127.0.0.1:1999", "dev")),
    );
    expect(pasteSeverity(parsed, { server: null, dial: "skipped" })).toEqual({ kind: "ok" });
  });

  test("error: malformed payload carries the failing field (049 §4)", () => {
    const truncated = encodeServerInvite(serverInvite()).slice(0, -20);
    const severity = pasteSeverity(parsePastedInvite(truncated), { server: null }) as Extract<
      PasteSeverity,
      { kind: "error" }
    >;
    expect(severity.kind).toBe("error");
    expect(severity.reason.startsWith("payload:")).toBe(true);
  });
});

/* --------------------------------- dialServer -------------------------------- */

describe("dialServer (054 Q9 live dial)", () => {
  test("remote relay reachable when the WS handshake opens", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const p = dialServer("wss://relay.example.com");
    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].onopen?.();
    expect(await p).toBe("ok");
  });

  test("remote relay error → unreachable; never answering → timeout unreachable", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const err = dialServer("wss://relay.example.com", 1000);
    FakeWebSocket.instances[0].onerror?.();
    expect(await err).toBe("unreachable");

    const timeout = dialServer("wss://relay.example.com", 30);
    expect(await timeout).toBe("unreachable");
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  test("invalid relay URL → unreachable without probing", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    expect(await dialServer("ftp://relay.example.com")).toBe("unreachable");
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});

/* ------------------------------ PasteWarnings UI ----------------------------- */

describe("PasteWarnings (054 severity UI, copy verbatim)", () => {
  test("no-key → red card + Join DISABLED (Q4: no continue path)", () => {
    render(createElement(PasteWarnings, { severity: { kind: "no-key" } }));
    expect(screen.getByText("CollabNoKeyTitle")).toBeTruthy();
    expect(screen.getByText("CollabNoKeyBody")).toBeTruthy();
    const join = screen.getByTestId("collab-warning-join-disabled") as HTMLButtonElement;
    expect(join.disabled).toBe(true);
    expect(screen.queryByTestId("collab-warning-continue")).toBeNull();
  });

  test("fp-mismatch → amber card + Continue anyway ENABLED (Q5 warn-only)", () => {
    const onContinue = vi.fn();
    render(
      createElement(PasteWarnings, {
        severity: { kind: "fp-mismatch" },
        serverRelay: "wss://relay.example.com",
        onContinue,
      }),
    );
    expect(screen.getByText("CollabFpTitle")).toBeTruthy();
    expect(screen.getByText("CollabFpBody")).toBeTruthy();
    fireEvent.click(screen.getByTestId("collab-warning-continue"));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  test("unreachable server invite → red + Retry + Save anyway (Q9)", () => {
    const onRetry = vi.fn();
    const onSaveAnyway = vi.fn();
    render(
      createElement(PasteWarnings, {
        severity: { kind: "unreachable", inviteKind: "server" },
        onRetry,
        onSaveAnyway,
      }),
    );
    expect(screen.getByText("CollabSrvUnreachTitle")).toBeTruthy();
    expect(screen.getByText("CollabSrvUnreachBody")).toBeTruthy();
    fireEvent.click(screen.getByTestId("collab-warning-retry"));
    fireEvent.click(screen.getByTestId("collab-warning-save-anyway"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onSaveAnyway).toHaveBeenCalledTimes(1);
  });

  test("unreachable room invite → joinSrvDown copy (nobody answered ≠ server said no)", () => {
    const onRetry = vi.fn();
    render(
      createElement(PasteWarnings, {
        severity: { kind: "unreachable", inviteKind: "room" },
        onRetry,
      }),
    );
    expect(screen.getByText("CollabJoinSrvDownTitle")).toBeTruthy();
    expect(screen.getByText("CollabJoinSrvDownBody")).toBeTruthy();
    expect(screen.queryByTestId("collab-warning-save-anyway")).toBeNull();
    fireEvent.click(screen.getByTestId("collab-warning-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("error → red card without actions; ok → renders nothing", () => {
    render(createElement(PasteWarnings, { severity: { kind: "error", reason: "none" } }));
    expect(screen.getByText("CollabNoInviteFound")).toBeTruthy();
    cleanup();

    render(
      createElement(PasteWarnings, {
        severity: { kind: "error", reason: "shareId: shareId must be a base64url 128-bit id" },
      }),
    );
    expect(screen.getByText("CollabInvalidInvite")).toBeTruthy();
    expect(
      screen.getByText("shareId: shareId must be a base64url 128-bit id"),
    ).toBeTruthy();
    cleanup();

    const { container } = render(createElement(PasteWarnings, { severity: { kind: "ok" } }));
    expect(container.firstChild).toBeNull();
  });
});

/* --------------------------------- ShareStep UI ------------------------------ */

describe("ShareStep (054 share step — sentence+code, copy buttons, amber caution)", () => {
  const invite: RoomInvite = { shareId: SHARE_ID, tier: "private", roomSecret: KEY43 };
  // the component's react-i18next double returns the bare key (interpolation vars ignored)
  const sentence = "CollabShareClipboard";
  const code = encodeRoomInvite(invite);

  test("renders name + tier badge + preview + amber caution (054 prototype)", () => {
    render(createElement(ShareStep, { name: "Sprint", invite }));
    expect(screen.getByText("CollabShareTitle")).toBeTruthy();
    expect(screen.getByText("Sprint")).toBeTruthy();
    expect(screen.getByText("CollabTierBadgePrivate")).toBeTruthy();
    expect(screen.getByText("CollabShareCaution")).toBeTruthy();
    const preview = screen.getByTestId("collab-share-preview");
    expect(preview.textContent).toContain(sentence);
    expect(preview.textContent).toContain(code);
    // per 054: no toast — the preview box IS the confirmation
    expect(screen.queryByText("CollabShareCopyDone")).toBeNull();
  });

  test("primary Copy invite writes sentence + code; secondary Code only writes the bare code", async () => {
    const writeText = stubClipboard();
    const onCopied = vi.fn();
    render(createElement(ShareStep, { name: "Sprint", invite, onCopied }));

    fireEvent.click(screen.getByTestId("collab-share-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${sentence}\n${code}`));
    expect(onCopied).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("collab-share-copy-code"));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(code));
    expect(onCopied).toHaveBeenCalledTimes(2);
  });

  test("ghost Skip — enter room fires onSkip", () => {
    const onSkip = vi.fn();
    render(createElement(ShareStep, { name: "Sprint", invite, onSkip }));
    fireEvent.click(screen.getByTestId("collab-share-skip"));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
