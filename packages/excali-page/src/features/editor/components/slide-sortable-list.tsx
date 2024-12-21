import { useRef, useState } from "react";
import { Slide } from "../type";
import { DndContext } from "@dnd-kit/core";
import { slideIdOrderListRef } from "../store/presentation";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import SlideItem from "./slide-item";

interface SlideSortableListProps {
  initialSlides: Slide[];
  onSlideClick?: (slide: Slide) => void;
}
const SlideSortableList = ({
  initialSlides,
  onSlideClick,
}: SlideSortableListProps) => {
  const isSwapping = useRef(false);
  const [localSlideList, updateLocalSlideList] = useState(initialSlides);
  return (
    <DndContext
      onDragStart={() => {
        isSwapping.current = true;
      }}
      onDragEnd={(event) => {
        setTimeout(() => {
          isSwapping.current = false;
        }, 100);
        if (event.over?.id && event.active.id !== event.over?.id) {
          const { active, over } = event;
          updateLocalSlideList((slides) => {
            const oldIndex = slides.findIndex(
              (it) => it.id === (active.id as string)
            );
            const newIndex = slides.findIndex(
              (it) => it.id === (over.id as string)
            );
            let newSlides = arrayMove(slides, oldIndex, newIndex);
            slideIdOrderListRef.current = newSlides.map((it) => it.id);
            return newSlides;
          });
        }
      }}
    >
      <SortableContext
        items={localSlideList}
        strategy={horizontalListSortingStrategy}
      >
        {localSlideList?.map((slide) => (
          <SlideItem
            onClick={() =>
              !isSwapping.current && onSlideClick && onSlideClick(slide)
            }
            key={slide.id}
            slide={slide}
            id={slide.id}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
};

export default SlideSortableList;
