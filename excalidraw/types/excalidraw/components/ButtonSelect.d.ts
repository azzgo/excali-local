export declare const ButtonSelect: <T extends Object>({ options, value, onChange, group, }: {
    options: {
        value: T;
        text: string;
    }[];
    value: T | null;
    onChange: (value: T) => void;
    group: string;
}) => JSX.Element;
