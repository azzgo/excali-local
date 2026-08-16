import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { deleteRoom, listRooms, saveRoomMeta, type RoomEntry } from "collab-core";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ROUTES, roomRoute } from "./routes";
import { useServerConfig } from "./hooks/use-server-config";
import { fingerprint } from "./invite";
import { cn } from "@/lib/utils";

interface RoomsScreenProps {
  lang: string;
}

/**
 * My rooms — the B-lite local list (Wayfinder 053 myRooms screen, 048):
 *
 * - Source: `excali` DB v3 `rooms` store via collab-core (048 — local-only,
 *   a room IS its invite). Pinned entries sort first, then last-joined.
 * - Pin: toggle persists through saveRoomMeta.
 * - Stale graying: entry fp ≠ fingerprint of the CURRENT configured relay →
 *   grayed + "may belong to another server" (048: warn-only staleness signal,
 *   NEVER auto-deleted, never grayed for an outage — fp mismatch only).
 *   Restorable by re-pasting the invite (re-join rewrites meta + fp).
 * - Delete: explicit per-entry. Private rooms warn that deleting removes the
 *   room key (048/053 — anyone holding the invite keeps access; you can't
 *   re-open it after delete). Confirm/cancel modal.
 * - Click → `#room/<id>` (053 round 3 — the room URL re-activates directly).
 */
export default function RoomsScreen({ lang }: RoomsScreenProps) {
  const [t] = useTranslation();
  const { config } = useServerConfig();
  const [rooms, setRooms] = useState<RoomEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoomEntry | null>(null);

  const refresh = useCallback(async () => {
    setRooms(await listRooms());
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 048: fp is a staleness signal against the CURRENT server config. No server
  // configured → nothing to compare → no graying. Entries without fp never gray.
  const currentFp = config !== null ? fingerprint(config.relay) : null;
  const isStale = (room: RoomEntry) =>
    currentFp !== null && room.fp !== undefined && room.fp !== currentFp;

  const sorted = [...rooms].sort((a, b) =>
    a.pinned === b.pinned ? b.lastJoined - a.lastJoined : a.pinned ? -1 : 1,
  );

  const togglePin = async (room: RoomEntry) => {
    await saveRoomMeta({ ...room, pinned: !room.pinned });
    await refresh();
  };

  const confirmDelete = async () => {
    if (deleteTarget === null) return;
    await deleteRoom(deleteTarget.id);
    setDeleteTarget(null);
    await refresh();
  };

  return (
    <div
      data-testid="collab-rooms"
      className="flex min-h-svh flex-col items-center justify-center bg-muted/30 p-6"
    >
      <div className="w-full max-w-md">
        <h1 className="text-lg font-semibold tracking-tight">{t("CollabMyRooms")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("CollabRoomsIntro")}</p>

        {loaded && sorted.length === 0 && (
          <div className="mt-4 rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
            <div className="font-medium">{t("CollabRoomsEmpty")}</div>
            <p className="mt-1">{t("CollabRoomsEmptyHint")}</p>
          </div>
        )}

        <div className="mt-4 space-y-2">
          {sorted.map((room) => {
            const stale = isStale(room);
            return (
              <div
                key={room.id}
                data-testid={`collab-room-${room.id}`}
                data-stale={stale || undefined}
                title={stale ? t("CollabRoomStale") : undefined}
                onClick={() => {
                  window.location.hash = roomRoute(room.id);
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border bg-card p-3 text-sm shadow-xs transition-colors hover:border-primary",
                  stale && "border-dashed opacity-55 hover:opacity-80",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className={cn("truncate font-medium", stale && "text-muted-foreground")}>
                    {room.label}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="rounded-full border bg-muted px-2 py-0.5 text-[10px] font-medium">
                      {t(room.tier === "private" ? "CollabTierBadgePrivate" : "CollabTierBadgeTeam")}
                    </span>
                    <span>{t("CollabLastJoined", { when: format(new Date(room.lastJoined), "PP p") })}</span>
                    {stale && (
                      <span className="font-medium text-amber-600 dark:text-amber-400">
                        {t("CollabRoomStale")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    data-testid={`collab-room-${room.id}-pin`}
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      void togglePin(room);
                    }}
                  >
                    {room.pinned ? t("CollabUnpin") : t("CollabPin")}
                  </Button>
                  <Button
                    data-testid={`collab-room-${room.id}-delete`}
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(room);
                    }}
                  >
                    {t("CollabDelete")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <Button
          variant="ghost"
          className="mt-3 w-full"
          onClick={() => {
            window.location.hash = ROUTES.landing;
          }}
        >
          {t("CollabBack")}
        </Button>

        {/* 048/053: private-room delete = key-loss warning, confirm/cancel */}
        <Modal
          open={deleteTarget !== null}
          title={t("CollabDeleteRoomTitle")}
          onDismiss={() => setDeleteTarget(null)}
        >
          <div data-testid="collab-delete-modal" className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("CollabDeleteRoomBody")}</p>
            {deleteTarget?.tier === "private" && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-xs dark:border-red-500/40 dark:bg-red-500/10">
                <div className="font-semibold text-red-700 dark:text-red-400">
                  {t("CollabDeletePrivateWarning")}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                data-testid="collab-delete-confirm"
                variant="destructive"
                className="flex-1"
                onClick={() => void confirmDelete()}
              >
                {t("CollabDelete")}
              </Button>
              <Button
                data-testid="collab-delete-cancel"
                variant="ghost"
                className="flex-1"
                onClick={() => setDeleteTarget(null)}
              >
                {t("CollabCancel")}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
}
