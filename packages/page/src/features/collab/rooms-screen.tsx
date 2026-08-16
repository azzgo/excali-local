import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ROUTES } from "./routes";

interface RoomsScreenProps {
  lang: string;
}

/**
 * My rooms — SHELL ONLY. The local B-lite room list (pin, fp-mismatch stale
 * graying, key-loss warning on private-room delete, 053) is task 043; this
 * screen only wires the route. TODO(043): replace the placeholder with the
 * list (source: `excali` DB v3 `rooms` store via collab-core cache helpers).
 */
export default function RoomsScreen({ lang }: RoomsScreenProps) {
  const [t] = useTranslation();
  return (
    <div
      data-testid="collab-rooms"
      className="flex min-h-svh flex-col items-center justify-center bg-muted/30 p-6"
    >
      <div className="w-full max-w-md">
        <h1 className="text-lg font-semibold tracking-tight">{t("CollabMyRooms")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("CollabRoomsIntro")}</p>
        <div className="mt-4 rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
          TODO(043) · {t("CollabPlaceholderNote")}
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
      </div>
    </div>
  );
}
