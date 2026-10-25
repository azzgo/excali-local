import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

import type { TransferOfferNotice } from "excali-shared";

const SECOND = 1000;

function remainingSeconds(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / SECOND));
}

/**
 * The Peering offer toast (ADR 0013 decision 7): a peer device is offering a
 * canvas. A sonner toast in the top-right — never a modal, never a banner that
 * reflows the editor. The countdown reads expiresAt from the protocol: the
 * receiver's own deadline, never a page-side timer.
 */
function TransferOfferToastBody({
  offer,
  onAnswer,
}: {
  offer: TransferOfferNotice;
  onAnswer: (accept: boolean) => void;
}) {
  const { t } = useTranslation();
  const [left, setLeft] = useState(() => remainingSeconds(offer.expiresAt));

  useEffect(() => {
    const timer = setInterval(() => {
      const next = remainingSeconds(offer.expiresAt);
      setLeft(next);
      if (next === 0) clearInterval(timer);
    }, SECOND);
    return () => clearInterval(timer);
  }, [offer.expiresAt]);

  const size = offer.bytes >= 1_048_576
    ? `${(offer.bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(offer.bytes / 1024))} KB`;

  return (
    <div className="w-72">
      <p className="text-sm font-medium">{t("AgentTransferOfferTitle")}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("AgentTransferOfferBody", {
          alias: offer.alias,
          name: offer.canvasName,
          elements: offer.elementCount,
          size,
        })}
      </p>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground" data-testid="agent-transfer-countdown">
        {t("AgentTransferExpires", { seconds: left })}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="outline" data-testid="agent-transfer-reject" onClick={() => onAnswer(false)}>
          {t("Cancel")}
        </Button>
        <Button size="sm" data-testid="agent-transfer-accept" disabled={left === 0} onClick={() => onAnswer(true)}>
          {t("AgentTransferAccept")}
        </Button>
      </div>
    </div>
  );
}

export default TransferOfferToastBody;
