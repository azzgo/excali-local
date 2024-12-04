import { ReactNode } from "react";
declare const TTDDialogTabs: {
    (props: {
        children: ReactNode;
    } & ({
        dialog: "ttd";
        tab: "text-to-diagram" | "mermaid";
    } | {
        dialog: "settings";
        tab: "text-to-diagram" | "diagram-to-code";
    })): JSX.Element;
    displayName: string;
};
export default TTDDialogTabs;
