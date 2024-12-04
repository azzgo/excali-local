import "./UserList.scss";
import React from "react";
import { Collaborator, SocketId } from "../types";
export type GoToCollaboratorComponentProps = {
    clientId: ClientId;
    collaborator: Collaborator;
    withName: boolean;
    isBeingFollowed: boolean;
};
/** collaborator user id or socket id (fallback) */
type ClientId = string & {
    _brand: "UserId";
};
type UserListUserObject = Pick<Collaborator, "avatarUrl" | "id" | "socketId" | "username">;
type UserListProps = {
    className?: string;
    mobile?: boolean;
    collaborators: Map<SocketId, UserListUserObject>;
    userToFollow: SocketId | null;
};
export declare const UserList: React.MemoExoticComponent<({ className, mobile, collaborators, userToFollow }: UserListProps) => JSX.Element | null>;
export {};
