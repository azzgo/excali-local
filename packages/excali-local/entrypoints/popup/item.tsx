import { Icon } from "@tabler/icons-react";

interface ItemProps {
  icon: Icon;
  label: string;
  onClick: () => void;
}
const Item: React.FC<ItemProps> = ({ icon: IconComp, label, onClick }) => {
  return (
    <div
      className="flex flex-col items-center gap-2 p-4 bg-gray-100 border border-gray-300 cursor-pointer hover:bg-gray-200 transition rounded shadow-sm"
      onClick={onClick}
    >
      <IconComp />
      <span className="text-sm text-gray-600">{label}</span>
    </div>
  );
};

export default Item;
