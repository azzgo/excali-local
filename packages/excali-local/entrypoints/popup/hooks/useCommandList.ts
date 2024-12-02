import { useState } from "react";
export function useCommandList() {
  const [commandList, updateCommandList] = useState<Record<string, string>>({});

  useEffect(() => {
    chrome?.commands.getAll((commands) => {
      updateCommandList(
        commands.reduce((acc, command) => {
          acc[command.name!] = command.shortcut!;
          return acc;
        }, {} as Record<string, string>)
      );
    });
  }, []);

  return commandList;
}
