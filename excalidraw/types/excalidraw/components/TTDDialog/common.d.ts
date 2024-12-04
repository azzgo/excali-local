import { MermaidOptions } from "@excalidraw/mermaid-to-excalidraw";
import { MermaidToExcalidrawResult } from "@excalidraw/mermaid-to-excalidraw/dist/interfaces";
import { NonDeletedExcalidrawElement } from "../../element/types";
import { AppClassProperties, BinaryFiles } from "../../types";
export interface MermaidToExcalidrawLibProps {
    loaded: boolean;
    api: Promise<{
        parseMermaidToExcalidraw: (definition: string, options: MermaidOptions) => Promise<MermaidToExcalidrawResult>;
    }>;
}
interface ConvertMermaidToExcalidrawFormatProps {
    canvasRef: React.RefObject<HTMLDivElement>;
    mermaidToExcalidrawLib: MermaidToExcalidrawLibProps;
    mermaidDefinition: string;
    setError: (error: Error | null) => void;
    data: React.MutableRefObject<{
        elements: readonly NonDeletedExcalidrawElement[];
        files: BinaryFiles | null;
    }>;
}
export declare const convertMermaidToExcalidraw: ({ canvasRef, mermaidToExcalidrawLib, mermaidDefinition, setError, data, }: ConvertMermaidToExcalidrawFormatProps) => Promise<void>;
export declare const saveMermaidDataToStorage: (mermaidDefinition: string) => void;
export declare const insertToEditor: ({ app, data, text, shouldSaveMermaidDataToStorage, }: {
    app: AppClassProperties;
    data: React.MutableRefObject<{
        elements: readonly NonDeletedExcalidrawElement[];
        files: BinaryFiles | null;
    }>;
    text?: string | undefined;
    shouldSaveMermaidDataToStorage?: boolean | undefined;
}) => void;
export {};
