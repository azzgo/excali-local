import { useEffect, useState } from "react";
import { parseHash, type CollabRoute } from "./routes";
import LandingScreen from "./landing-screen";
import ConfigScreen from "./config-screen";
import CreateScreen from "./create-screen";
import JoinScreen from "./join-screen";
import RoomsScreen from "./rooms-screen";
import RoomScreen from "./room-screen";

interface CollabEditorProps {
  lang: string;
}

/**
 * CollabEditor — the `?type=collab` surface (Wayfinder 053).
 *
 * Hash router (053 round 3 — no react-router; every page maps to a URL):
 *
 *   no hash / unknown → LandingScreen
 *   #config           → ConfigScreen  (read-only summary; webapp mirror = 049)
 *   #create           → CreateScreen  (shell — flow = 043)
 *   #join             → JoinScreen    (shell — flow = 043)
 *   #rooms            → RoomsScreen   (shell — flow = 043)
 *   #room/<shareId>   → RoomScreen    (shell — session chrome = 044)
 *
 * Route state lives in the hash: hashchange re-renders, back/forward work
 * for free, and #room/<shareId> survives refresh/bookmark (re-activates the
 * room directly, skipping the landing).
 */
export default function CollabEditor({ lang }: CollabEditorProps) {
  const [route, setRoute] = useState<CollabRoute>(() =>
    parseHash(window.location.hash),
  );

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  switch (route.name) {
    case "config":
      return <ConfigScreen lang={lang} />;
    case "create":
      return <CreateScreen lang={lang} />;
    case "join":
      return <JoinScreen lang={lang} />;
    case "rooms":
      return <RoomsScreen lang={lang} />;
    case "room":
      return <RoomScreen lang={lang} shareId={route.shareId} />;
    default:
      return <LandingScreen lang={lang} />;
  }
}
