import { fontList } from "@/entrypoints/lib/utils";

export function useFontList() {
  const [fonts, setFonts] = useState<string[]>([]);
  useEffect(() => {
    fontList().then(setFonts);
  }, []);

  return fonts;
}
