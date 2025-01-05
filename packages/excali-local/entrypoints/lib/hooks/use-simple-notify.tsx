import { IconCheck, IconInfoCircle, IconX } from "@tabler/icons-react";
import { cn } from "../utils";

interface NotifyItem {
  type: "success" | "error" | "info";
  title: string;
  message?: string;
}

interface UseSimpleNotifyProps {
  timeout?: number;
}

const NotifyTypeIconMap = {
  success: IconCheck,
  error: IconX,
  info: IconInfoCircle,
};

export function useSimpleNotify({ timeout = 3000 }: UseSimpleNotifyProps = {}) {
  const [notifyItem, setNotify] = useState<NotifyItem | null>(null);

  const notifyTimeoutRef = useRef<Timer | null>(null);

  const notify = useCallback((notifyItem: NotifyItem) => {
    setNotify({ ...notifyItem });
    if (notifyTimeoutRef.current) {
      clearTimeout(notifyTimeoutRef.current);
    }
    notifyTimeoutRef.current = setTimeout(() => {
      notifyTimeoutRef.current && clearTimeout(notifyTimeoutRef.current);
      setNotify(null);
    }, timeout);
  }, []);

  const clearNotify = useCallback(() => {
    if (notifyTimeoutRef.current) {
      clearTimeout(notifyTimeoutRef.current);
    }
    setNotify(null);
  }, []);

  const NotifyIcon = notifyItem?.type && NotifyTypeIconMap[notifyItem.type];

  const Notify = () => {
    return (
      <div
        role="alert"
        className={cn(
          "absolute top-6 right-6 rounded-xl border border-gray-100 bg-white p-4",
          notifyItem == null && "hidden"
        )}
      >
        <div className="flex items-start gap-4">
          {NotifyIcon && (
            <NotifyIcon
              className={cn("size-4", {
                "text-green-500": notifyItem.type === "success",
                "text-red-500": notifyItem.type === "error",
                "text-blue-500": notifyItem.type === "info",
              })}
            />
          )}
          <div className="flex-1">
            <strong className="block font-medium text-gray-900">
              {notifyItem?.title}
            </strong>

            <p className="mt-1 text-sm text-gray-700">{notifyItem?.message}</p>
          </div>

          <button className="text-gray-500 transition hover:text-gray-600">
            <span className="sr-only">Dismiss popup</span>
            <IconX className="size-4" onClick={clearNotify} />
          </button>
        </div>
      </div>
    );
  };

  return {
    notify,
    clearNotify,
    Notify,
  };
}
