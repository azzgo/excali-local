import { useAtomValue } from "jotai";
import {
  orderedSlidesAtom,
  showSlideQuickNavAtom,
  slideIdOrderListRef,
} from "../store/presentation";
import { ScrollArea } from "@radix-ui/react-scroll-area";
import { ScrollBar } from "@/components/ui/scroll-area";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/types";
import { Button } from "@/components/ui/button";
import { IconChevronDown } from "@tabler/icons-react";
import { useSlide } from "../hooks/use-slide";
import { useEffect, useMemo, useRef } from "react";
import { createSwapy } from "swapy";

interface SlideQuickNavbarProps {
  close: () => void;
  excalidrawApi: ExcalidrawImperativeAPI | null;
}

const SlideNavbar = ({ close, excalidrawApi }: SlideQuickNavbarProps) => {
  const isSwapping = useRef(false);
  const domEl = useRef<HTMLDivElement | null>(null);
  const showSlideQuickNav = useAtomValue(showSlideQuickNavAtom);
  const orderedSlides = useAtomValue(orderedSlidesAtom);
  const { scrollToSlide } = useSlide(excalidrawApi);
  const slideLength = useMemo(() => orderedSlides.length, [orderedSlides]);

  useEffect(() => {
    if (showSlideQuickNav && domEl.current && slideLength > 0) {
      const container = domEl.current.querySelector(".slide-navbar");
      if (!container) {
        return;
      }
      const swapy = createSwapy(container, {
        animation: "dynamic",
      });

      swapy.onSwapStart(() => {
        isSwapping.current = true;
      });

      swapy.onSwapEnd((event) => {
        setTimeout(() => {
          isSwapping.current = false;
        }, 100);
        if (event.hasChanged) {
          slideIdOrderListRef.current = event.data.array.map(
            (it) => it.itemId!
          );
        }
      });

      swapy.enable(true);

      return () => {
        swapy.destroy();
      };
    }
  }, [showSlideQuickNav, slideLength]);

  useEffect(() => {
    slideLength === 0 && close();
  }, [slideLength]);

  return showSlideQuickNav && (
    <div ref={domEl}>
      <div className="h-80 mt-4 flex z-20 relative border-t pt-4">
        <div className="absolute w-fit top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2 h-8 z-10">
          <Button variant="outline" className="rounded-full" onClick={close}>
            <IconChevronDown className="size-4" />
          </Button>
        </div>
        <div className="h-full w-full overflow-x-auto overflow-y-hidden">
          <ScrollArea className="w-full h-full slide-navbar">
            <div className="w-max h-full space-x-8 p-4 flex">
              {orderedSlides?.map((slide, index) => (
                <div key={slide.id} data-swapy-slot={index}>
                  <div
                    className="shrink-0 flex flex-col space-y-4 items-center h-full"
                    data-swapy-item={slide.id}
                  >
                    <div
                      className="cursor-pointer p-4 border rounded-sm bg-gray-50 hover:opacity-75"
                      onClick={() =>
                        !isSwapping.current && scrollToSlide({ id: slide.id })
                      }
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
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>
      </div>
    </div>
  );
};

export default SlideNavbar;
