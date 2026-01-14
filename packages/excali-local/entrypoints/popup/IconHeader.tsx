import { Icon } from "@tabler/icons-react";

interface IconHeaderProps {
  icon: Icon;
  label: string;
}
const IconHeader = ({ icon: IconComp, label }: IconHeaderProps) => {
  return (
    <div className="flex flex-row items-center p-2 w-fit border-b border-gray-200 dark:border-gray-800">
      <IconComp className="mr-4 size-6 dark:text-gray-200" />
      <p className="font-medium text-lg dark:text-gray-100">{label}</p>
    </div>
  );
};

export default IconHeader;
