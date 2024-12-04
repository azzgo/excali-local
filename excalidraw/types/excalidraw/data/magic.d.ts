import { Theme } from "../element/types";
import { DataURL } from "../types";
import { OpenAIOutput } from "./ai/types";
export type MagicCacheData = {
    status: "pending";
} | {
    status: "done";
    html: string;
} | {
    status: "error";
    message?: string;
    code: "ERR_GENERATION_INTERRUPTED" | string;
};
export declare function diagramToHTML({ image, apiKey, text, theme, }: {
    image: DataURL;
    apiKey: string;
    text: string;
    theme?: Theme;
}): Promise<({
    ok: true;
} & OpenAIOutput.ChatCompletion) | ({
    ok: false;
} & OpenAIOutput.APIError)>;
