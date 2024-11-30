import { Icon } from "@tabler/icons-react";

interface IconHeaderProps {
  icon: Icon;
  label: string;
}
const IconHeader = ({ icon: IconComp, label }: IconHeaderProps) => {
  return (
    <div className="flex flex-row items-center p-2 w-fit border-b border-gray-200">
      <IconComp className="mr-4 size-6" />
      <p class="font-medium text-lg">{label}</p>
    </div>
  );
};

export default IconHeader;
