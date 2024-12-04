import React from "react";
declare const DropdownMenuItem: {
    ({ icon, onSelect, children, shortcut, className, selected, ...rest }: {
        icon?: JSX.Element | undefined;
        onSelect: (event: Event) => void;
        children: React.ReactNode;
        shortcut?: string | undefined;
        selected?: boolean | undefined;
        className?: string | undefined;
    } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onSelect">): JSX.Element;
    displayName: string;
    Badge: {
        ({ children, }: {
            children: React.ReactNode;
        }): JSX.Element;
        displayName: string;
    };
};
export declare const DropDownMenuItemBadge: {
    ({ children, }: {
        children: React.ReactNode;
    }): JSX.Element;
    displayName: string;
};
export default DropdownMenuItem;
