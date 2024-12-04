import "./MagicSettings.scss";
export declare const MagicSettings: (props: {
    openAIKey: string | null;
    isPersisted: boolean;
    onChange: (key: string, shouldPersist: boolean) => void;
    onConfirm: (key: string, shouldPersist: boolean) => void;
    onClose: () => void;
}) => JSX.Element | null;
