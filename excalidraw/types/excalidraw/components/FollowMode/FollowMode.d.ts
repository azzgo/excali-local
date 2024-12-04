import { UserToFollow } from "../../types";
import "./FollowMode.scss";
interface FollowModeProps {
    width: number;
    height: number;
    userToFollow: UserToFollow;
    onDisconnect: () => void;
}
declare const FollowMode: ({ height, width, userToFollow, onDisconnect, }: FollowModeProps) => JSX.Element;
export default FollowMode;
