import { useAtom } from "jotai";
import { useEffect, useState } from "react";
import { searchQueryAtom } from "../store/gallery-atoms";
import { IconSearch, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "react-i18next";

const SearchBar = () => {
  const [t] = useTranslation();
  const [query, setQuery] = useAtom(searchQueryAtom);
  const [inputValue, setInputValue] = useState(query);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(inputValue);
    }, 300);

    return () => clearTimeout(timer);
  }, [inputValue, setQuery]);

  useEffect(() => {
    setInputValue(query);
  }, [query]);

  const handleClear = () => {
    setInputValue("");
    setQuery("");
  };

  return (
    <div className="relative">
      <div className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-secondary-color)] pointer-events-none z-10">
        <IconSearch className="h-4 w-4" />
      </div>
      <Input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder={t("Search drawings...")}
        className={cn(
          "w-full h-9 !pl-9 pr-9 text-sm bg-[var(--color-surface-low)]",
          "border border-transparent hover:border-[var(--color-primary)]",
          "text-[var(--text-primary-color)] placeholder:text-[var(--text-secondary-color)]",
          "focus-visible:border-[var(--color-primary)] focus-visible:ring-1 focus-visible:ring-[var(--color-primary)]"
        )}
      />
      {inputValue && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-0 top-0 h-9 w-9 text-[var(--text-secondary-color)] hover:text-[var(--text-primary-color)]"
          onClick={handleClear}
        >
          <IconX className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
};

export default SearchBar;
