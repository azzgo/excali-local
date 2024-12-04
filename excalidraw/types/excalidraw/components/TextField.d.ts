import { KeyboardEvent } from "react";
import "./TextField.scss";
type TextFieldProps = {
    value?: string;
    onChange?: (value: string) => void;
    onClick?: () => void;
    onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
    readonly?: boolean;
    fullWidth?: boolean;
    selectOnRender?: boolean;
    label?: string;
    placeholder?: string;
    isRedacted?: boolean;
};
export declare const TextField: import("react").ForwardRefExoticComponent<TextFieldProps & import("react").RefAttributes<HTMLInputElement>>;
export {};
