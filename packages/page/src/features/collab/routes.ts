/**
 * CollabEditor hash routing (Wayfinder 053 round 3 — URL routing per page).
 *
 * Single source for the URL scheme — 043/044/050 import ROUTES / roomRoute /
 * parseHash from here, never re-declare the strings:
 *
 *   landing          ?type=collab              no hash, or unknown hash
 *   server config    #config
 *   create room      #create
 *   join room        #join
 *   my rooms         #rooms
 *   room session     #room/<shareId>           bookmarkable — refresh/bookmark
 *                                              re-activates the room directly,
 *                                              skipping the landing
 *
 * Transient sub-steps (trust confirm, share step, seed prompt, leave modal)
 * share their parent's URL (053 round 3). No react-router — hash routing only.
 */

export type CollabRoute =
  | { name: "landing" }
  | { name: "config" }
  | { name: "create" }
  | { name: "join" }
  | { name: "rooms" }
  | { name: "room"; shareId: string };

export const ROUTES = {
  landing: "",
  config: "#config",
  create: "#create",
  join: "#join",
  rooms: "#rooms",
} as const;

/** Room session URL (053 round 3) — bookmarkable, re-entry skips the landing. */
export function roomRoute(shareId: string): string {
  return `#room/${encodeURIComponent(shareId)}`;
}

/**
 * Map a location.hash to a route. Unknown hashes fall back to the landing
 * (053: "no hash / unknown hash → landing"). The shareId segment is NOT
 * validated here (base64url shape, key presence) — the room screen (044)
 * validates it when it re-activates the session.
 */
export function parseHash(hash: string | null | undefined): CollabRoute {
  const h = (hash ?? "").replace(/^#/, "");
  if (h === "" || h === "/") return { name: "landing" };
  switch (h) {
    case "config":
      return { name: "config" };
    case "create":
      return { name: "create" };
    case "join":
      return { name: "join" };
    case "rooms":
      return { name: "rooms" };
  }
  const roomMatch = /^room\/([^/]+)\/?$/.exec(h);
  if (roomMatch) {
    try {
      const shareId = decodeURIComponent(roomMatch[1]);
      if (shareId !== "") return { name: "room", shareId };
    } catch {
      /* malformed percent-encoding → landing */
    }
  }
  return { name: "landing" };
}
