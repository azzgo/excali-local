import { useAtomValue, useSetAtom } from "jotai";
import {
  orderedSlidesAtom,
  showSlideQuickNavAtom,
  slideIdOrderListAtom,
  slideIdOrderListRef,
} from "../store/presentation";
import { ScrollArea } from "@radix-ui/react-scroll-area";
import { ScrollBar } from "@/components/ui/scroll-area";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/excalidraw/types";
import { Button } from "@/components/ui/button";
import { IconChevronDown } from "@tabler/icons-react";
import { useSlide } from "../hooks/use-slide";
import { useEffect, useMemo } from "react";
import SlideSortableList from "./slide-sortable-list";

interface SlideQuickNavbarProps {
  close: () => void;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}

const SlideNavbar = ({ close, excalidrawAPI }: SlideQuickNavbarProps) => {
  const showSlideQuickNav = useAtomValue(showSlideQuickNavAtom);
  const orderedSlides = useAtomValue(orderedSlidesAtom);
  const { scrollToSlide } = useSlide(excalidrawAPI);
  const slideLength = useMemo(() => orderedSlides.length, [orderedSlides]);
  const updateSlideIdOrderList = useSetAtom(slideIdOrderListAtom);

  useEffect(() => {
    if (!showSlideQuickNav && Array.isArray(slideIdOrderListRef.current)) {
      updateSlideIdOrderList(slideIdOrderListRef.current);
    }
  }, [showSlideQuickNav, slideLength]);

  useEffect(() => {
    slideLength === 0 && close();
  }, [slideLength]);

  return (
    showSlideQuickNav && (
      <div>
        <div className="h-80 mt-4 flex z-20 relative border-t pt-4">
          <div className="absolute w-fit top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2 h-8 z-10">
            <Button variant="outline" className="rounded-full" onClick={close}>
              <IconChevronDown className="size-4" />
            </Button>
          </div>
          <div className="h-full w-full overflow-x-auto overflow-y-hidden">
            <ScrollArea className="w-full h-full">
              <div className="w-max h-full space-x-8 p-4 flex slide-navbar">
                <SlideSortableList
                  initialSlides={orderedSlides}
                  onSlideClick={(slide) => scrollToSlide({ id: slide.id })}
                />
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>
        </div>
      </div>
    )
  );
};

export default SlideNavbar;
