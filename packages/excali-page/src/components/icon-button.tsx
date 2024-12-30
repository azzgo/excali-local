import { cn } from "@/lib/utils";

interface IconBarButtonProps {
  icon: React.ReactNode;
  active?: boolean;
  className?: string;
  title?: string;
  onClick?: () => void;
}
const IconButton = ({
  icon,
  active = false,
  title,
  className,
  onClick,
}: IconBarButtonProps) => {
  return (
    <div
      title={title}
      role="button"
      className={cn(
        "cursor-pointer size-9 [&_svg]:size-4 box-border flex items-center justify-center text-[var(--icon-fill-color)] rounded-[0.5rem] bg-[hsl(240,25%,96%)] ",
        active
          ? "bg-[var(--button-selected-hover-bg,var(--color-surface-primary-container))]"
          : "hover:bg-[var(--button-hover-bg)]",
        className
      )}
      onClick={onClick}
    >
      {icon}
    </div>
  );
};

export default IconButton;
