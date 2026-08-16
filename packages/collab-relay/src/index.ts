/**
 * collab-relay PartyKit entry (task 037).
 *
 * The default export is the PartyKit `Server`-shaped object (module /
 * object-literal form — `PartyKitServer`): task 041 wires it into
 * party.config.ts with the `/room/:shareId` route. PartyKit's HTTP entry
 * point for this shape is `onRequest` (there is no `fetch` method on the
 * object-literal server; the WS upgrade itself is handled by the platform
 * and surfaces as `onConnect`). All server helpers are re-exported for
 * tests and for 038/041's room-DO wiring.
 */
import { relayServer } from "./server"

export default relayServer

export * from "./server"
