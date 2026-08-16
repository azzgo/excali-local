import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ROUTES } from "./routes";

interface CreateScreenProps {
  lang: string;
}

/**
 * Create room — SHELL ONLY. The full create flow (name + privacy tier →
 * share step with copy invite, 053) is task 043; this screen only wires the
 * route. TODO(043): replace the placeholder with the flow; the intermediate
 * share step keeps the same #create URL (053 round 3: transient sub-steps
 * share their parent's URL).
 */
export default function CreateScreen({ lang }: CreateScreenProps) {
  const [t] = useTranslation();
  return (
    <div
      data-testid="collab-create"
      className="flex min-h-svh flex-col items-center justify-center bg-muted/30 p-6"
    >
      <div className="w-full max-w-md">
        <h1 className="text-lg font-semibold tracking-tight">{t("CollabCreateRoom")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("CollabCreateIntro")}</p>
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
