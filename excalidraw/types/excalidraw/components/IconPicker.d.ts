import "./IconPicker.scss";
export declare function IconPicker<T>({ value, label, options, onChange, group, }: {
    label: string;
    value: T;
    options: readonly {
        value: T;
        text: string;
        icon: JSX.Element;
        keyBinding: string | null;
        showInPicker?: boolean;
    }[];
    onChange: (value: T) => void;
    group?: string;
}): JSX.Element;
