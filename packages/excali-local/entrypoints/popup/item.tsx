import { Icon } from "@tabler/icons-react";

interface ItemProps {
  icon: Icon;
  label: string;
  onClick: () => void;
}
const Item: React.FC<ItemProps> = ({ icon: IconComp, label, onClick }) => {
  return (
    <div
      className="flex-1 flex flex-col items-center gap-2 p-2 border cursor-pointer hover:bg-gray-100 rounded-md"
      onClick={onClick}
    >
      <IconComp />
      <span className="text-sm text-muted">{label}</span>
    </div>
  );
};

export default Item;
