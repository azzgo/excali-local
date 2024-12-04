import "./TTDDialog.scss";
type OnTestSubmitRetValue = {
    rateLimit?: number | null;
    rateLimitRemaining?: number | null;
} & ({
    generatedResponse: string | undefined;
    error?: null | undefined;
} | {
    error: Error;
    generatedResponse?: null | undefined;
});
export declare const TTDDialog: (props: {
    onTextSubmit(value: string): Promise<OnTestSubmitRetValue>;
} | {
    __fallback: true;
}) => JSX.Element | null;
/**
 * Text to diagram (TTD) dialog
 */
export declare const TTDDialogBase: import("react").FC<({
    tab: "text-to-diagram" | "mermaid";
} & ({
    onTextSubmit(value: string): Promise<OnTestSubmitRetValue>;
} | {
    __fallback: true;
})) & {
    __fallback?: boolean | undefined;
}>;
export {};
