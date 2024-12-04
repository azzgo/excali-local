export declare const TTDDialogTabTrigger: {
    ({ children, tab, onSelect, ...rest }: {
        children: React.ReactNode;
        tab: string;
        onSelect?: React.ReactEventHandler<HTMLButtonElement> | undefined;
    } & Omit<import("react").HTMLAttributes<HTMLButtonElement>, "onSelect">): JSX.Element;
    displayName: string;
};
