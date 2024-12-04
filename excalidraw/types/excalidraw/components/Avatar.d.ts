import "./Avatar.scss";
import React from "react";
type AvatarProps = {
    onClick: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
    color: string;
    name: string;
    src?: string;
    isBeingFollowed?: boolean;
    isCurrentUser: boolean;
};
export declare const Avatar: ({ color, onClick, name, src, isBeingFollowed, isCurrentUser, }: AvatarProps) => JSX.Element;
export {};
