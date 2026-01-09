import { Drawing } from "../../editor/utils/indexdb";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { MouseEvent } from "react";
import { Hint } from "@/components/ui/hint";

interface DrawingCardProps {
  drawing: Drawing;
  isActive: boolean;
  onClick: (drawing: Drawing) => void;
}

const DrawingCard = ({ drawing, isActive, onClick }: DrawingCardProps) => {
  const handleClick = (e: MouseEvent) => {
    e.preventDefault();
    onClick(drawing);
  };

  return (
    <Hint label={`Updated: ${format(new Date(drawing.updatedAt), "PP p")}`}>
      <div
        className={cn(
          "group relative flex flex-col gap-2 p-2 rounded-lg border transition-all cursor-pointer",
          "hover:bg-[var(--button-hover-bg)] hover:border-[var(--color-primary)]",
          isActive
            ? "bg-[var(--button-hover-bg)] border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]"
            : "bg-[var(--island-bg)] border-transparent"
        )}
        onClick={handleClick}
      >
        <div className="relative aspect-video w-full overflow-hidden rounded-md bg-white/10 border border-black/5 dark:border-white/5">
          {drawing.thumbnail ? (
            <img
              src={drawing.thumbnail}
              alt={drawing.name}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground bg-muted">
              No Preview
            </div>
          )}
        </div>
        
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium truncate text-[var(--text-primary-color)]">
            {drawing.name}
          </span>
          <span className="text-xs text-[var(--text-secondary-color)]">
            {format(new Date(drawing.updatedAt), "MMM d, yyyy")}
          </span>
        </div>
      </div>
    </Hint>
  );
};

export default DrawingCard;
