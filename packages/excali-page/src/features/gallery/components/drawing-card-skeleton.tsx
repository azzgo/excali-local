import { Skeleton } from "@/components/ui/skeleton";

const DrawingCardSkeleton = () => {
  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg bg-[var(--color-surface-primary)]">
      <Skeleton className="w-full aspect-video rounded-md" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
};

export default DrawingCardSkeleton;
