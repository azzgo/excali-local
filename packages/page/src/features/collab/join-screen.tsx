import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ROUTES } from "./routes";

interface JoinScreenProps {
  lang: string;
}

/**
 * Join room — SHELL ONLY. The full join flow (paste room invite → seed prompt
 * for empty/dead rooms, 053/054 Q7) is task 043; this screen only wires the
 * route. TODO(043): replace the placeholder with the paste flow; the seed
 * prompt keeps the same #join URL (053 round 3).
 */
export default function JoinScreen({ lang }: JoinScreenProps) {
  const [t] = useTranslation();
  return (
    <div
      data-testid="collab-join"
      className="flex min-h-svh flex-col items-center justify-center bg-muted/30 p-6"
    >
      <div className="w-full max-w-md">
        <h1 className="text-lg font-semibold tracking-tight">{t("CollabJoinTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("CollabJoinIntro")}</p>
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
