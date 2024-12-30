import { cn } from "@/lib/utils";

interface ColorButtonProps {
  color: string;
  active?: boolean;
  onClick?: () => void;
}
const ColorButton = ({ color, active, onClick }: ColorButtonProps) => {
  return (
    <div
      className={cn(
        "size-5 rounded border border-[#d6d6d6] relative bg-left-center",
        "hover:after:absolute hover:after:shadow-[0_0_0_1px_#d6d6d6] hover:after:left-[-2px] hover:after:right-[-2px] hover:after:top-[-2px] hover:after:bottom-[-2px] hover:after:rounded"
      )}
      role="button"
      style={{
        backgroundColor: color,
        backgroundImage:
          color === "transparent"
            ? `url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3uCTZhw1gGGYhAGBZIA/nYDCgBDAm9BGDWAAJyRCgLaBCAAgXwixzAS0pgAAAABJRU5ErkJggg==')`
            : "",
      }}
      onClick={onClick}
    >
      {active && (
        <div className="absolute top-[-2px] left-[-2px] right-[-2px] bottom-[-2px] shadow-[0_0_0_1px_#4a47b1] rounded"></div>
      )}
    </div>
  );
};

export default ColorButton;
