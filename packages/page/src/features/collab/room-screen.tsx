import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ROUTES } from "./routes";

interface RoomScreenProps {
  lang: string;
  /** 128-bit capability token from #room/<shareId> (049 §4). */
  shareId: string;
}

/**
 * Room session — SHELL ONLY. Task 044 owns the session chrome (one-row bar
 * above the canvas: room+privacy, conn dot, roster dots, copy invite, save,
 * leave modal) and the re-activation conflict rule (053 round 3: relay
 * snapshot wins / dead+cache → cache seeds / dead+no-cache → seed prompt).
 *
 * THIS FILE owns the URL side of bookmarkability: the router maps
 * `#room/<shareId>` straight here, so a refresh/bookmark re-activates the
 * room directly — the landing is skipped (053 round 3). TODO(044): validate
 * the shareId (base64url 128-bit, per 049 §4) and start the session here.
 */
export default function RoomScreen({ lang, shareId }: RoomScreenProps) {
  const [t] = useTranslation();
  return (
    <div
      data-testid="collab-room"
      className="flex min-h-svh flex-col items-center justify-center bg-muted/30 p-6"
    >
      <div className="w-full max-w-md">
        <h1 className="text-lg font-semibold tracking-tight">{t("CollabRoomSession")}</h1>
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t("CollabRoomShareId")}</span>
          <span data-testid="collab-room-shareid" className="font-mono break-all">
            {shareId}
          </span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{t("CollabRoomBookmarkHint")}</p>
        <div className="mt-4 rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
          TODO(044) · {t("CollabPlaceholderNote")}
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              window.location.hash = ROUTES.rooms;
            }}
          >
            {t("CollabMyRooms")}
          </Button>
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() => {
              window.location.hash = ROUTES.landing;
            }}
          >
            {t("CollabBack")}
          </Button>
        </div>
      </div>
    </div>
  );
}
