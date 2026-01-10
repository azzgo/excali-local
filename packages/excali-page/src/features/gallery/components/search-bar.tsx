import { useAtom } from "jotai";
import { searchQueryAtom } from "../store/gallery-atoms";
import { IconSearch, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const SearchBar = () => {
  const [query, setQuery] = useAtom(searchQueryAtom);

  return (
    <div className="relative w-full">
      <div className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-secondary-color)] pointer-events-none">
        <IconSearch className="h-4 w-4" />
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search drawings..."
        className={cn(
          "w-full h-8 pl-8 pr-8 text-xs rounded-md bg-[var(--color-surface-low)]",
          "border border-transparent hover:border-[var(--color-primary)]",
          "text-[var(--text-primary-color)] placeholder:text-[var(--text-secondary-color)]",
          "outline-none transition-colors",
          "focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
        )}
      />
      {query && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-0 top-0 h-8 w-8 text-[var(--text-secondary-color)] hover:text-[var(--text-primary-color)]"
          onClick={() => setQuery("")}
        >
          <IconX className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
};

export default SearchBar;
