export declare const ButtonIconCycle: <T extends unknown>({ options, value, onChange, group, }: {
    options: {
        value: T;
        text: string;
        icon: JSX.Element;
    }[];
    value: T | null;
    onChange: (value: T) => void;
    group: string;
}) => JSX.Element;
