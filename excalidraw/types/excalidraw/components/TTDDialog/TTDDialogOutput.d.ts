interface TTDDialogOutputProps {
    error: Error | null;
    canvasRef: React.RefObject<HTMLDivElement>;
    loaded: boolean;
}
export declare const TTDDialogOutput: ({ error, canvasRef, loaded, }: TTDDialogOutputProps) => JSX.Element;
export {};
