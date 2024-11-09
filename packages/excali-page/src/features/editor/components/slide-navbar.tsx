import { useAtom, useAtomValue } from "jotai";
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
import { useEffect, useRef } from "react";
import { createSwapy } from "swapy";

interface SlideQuickNavbarProps {
  excalidrawApi: ExcalidrawImperativeAPI | null;
}

const SlideNavbar = ({ excalidrawApi }: SlideQuickNavbarProps) => {
  const isSwapping = useRef(false);
  const domEl = useRef<HTMLDivElement | null>(null);
  const [showSlideQuickNav, updateShowSlideQuickNav] = useAtom(
    showSlideQuickNavAtom
  );
  const orderedSlides = useAtomValue(orderedSlidesAtom);
  const { scrollToSlide } = useSlide(excalidrawApi);

  useEffect(() => {
    if (showSlideQuickNav && domEl.current) {
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
  }, [showSlideQuickNav]);

  return (
    <div ref={domEl}>
      {showSlideQuickNav && (
        <div className="flex h-80 z-20 relative border-t pt-4">
          <div className="absolute w-fit top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2 h-8 z-10">
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => updateShowSlideQuickNav(false)}
            >
              <IconChevronDown className="size-4" />
            </Button>
          </div>
          <div className="h-full overflow-y-auto">
            <ScrollArea className="h-full slide-navbar">
              <div className="w-max h-full space-x-8 p-4 flex">
                {orderedSlides?.map((slide) => (
                  <div key={slide.id} data-swapy-slot={slide.id}>
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
                          className="max-h-48 object-cover aspect-video"
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
      )}
    </div>
  );
};

export default SlideNavbar;
