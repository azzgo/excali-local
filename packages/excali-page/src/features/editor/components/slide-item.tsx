import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Slide } from "../type";

interface SlideItemProps {
  id: string;
  onClick: () => void;
  slide: Slide;
}
const SlideItem = ({ id, onClick, slide }: SlideItemProps) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div className="shrink-0 flex flex-col space-y-4 items-center h-full">
        <div
          className="cursor-pointer p-4 border rounded-sm bg-gray-50 hover:opacity-75"
          onClick={onClick}
        >
          <img
            draggable={false}
            src={slide.thumbnail}
            className="h-48 object-cover aspect-video"
          />
        </div>
        <div className="text-sm">{slide.name}</div>
      </div>
    </div>
  );
};

export default SlideItem;
