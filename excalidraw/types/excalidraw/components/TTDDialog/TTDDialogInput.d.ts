import { ChangeEventHandler } from "react";
interface TTDDialogInputProps {
    input: string;
    placeholder: string;
    onChange: ChangeEventHandler<HTMLTextAreaElement>;
    onKeyboardSubmit?: () => void;
}
export declare const TTDDialogInput: ({ input, placeholder, onChange, onKeyboardSubmit, }: TTDDialogInputProps) => JSX.Element;
export {};
