import ColorButton from "@/components/color-button";
import IconButton from "@/components/icon-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sidebar, useI18n } from "@excalidraw/excalidraw";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/excalidraw/types";
import {
  IconArrowNarrowRight,
  IconCircleNumber1,
  IconLineDashed,
  IconLineDotted,
  IconSlash,
} from "@tabler/icons-react";
import { useCallback, useState } from "react";
import { useMarker } from "../hooks/use-marker";
import { StrokeStyle } from "@excalidraw/excalidraw/types/excalidraw/element/types";
import { useTranslation } from "react-i18next";
import { Separator } from "@/components/ui/separator";

const strokeColorList = [
  "#1e1e1e",
  "#e03131",
  "#2f9e44",
  "#1971c2",
  "#f08c00",
  "#0c8599",
  "transparent",
];

const backgroundColorList = [
  "#ffc9c9",
  "#b2f2bb",
  "#a5d8ff",
  "#ffec99",
  "#eebefa",
  "#e9ecef",
  "transparent",
];

interface QuickMarkSidebarProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}
const QuickMarkSidebar = ({ excalidrawAPI }: QuickMarkSidebarProps) => {
  const [docked, setDocked] = useState(false);
  const libI18n = useI18n();
  const { isMarkerMode, toggleMarkerMode } = useMarker(excalidrawAPI);

  const handleDockedChange = useCallback(
    (docked: boolean) => {
      if (docked) {
        excalidrawAPI?.updateScene({
          appState: {
            zenModeEnabled: true,
          },
        });
      } else {
        excalidrawAPI?.updateScene({
          appState: {
            zenModeEnabled: false,
          },
        });
      }
      setDocked(docked);
    },
    [excalidrawAPI]
  );
  const handleStateChange = useCallback(
    (state: { name: string; tab?: string } | null) => {
      if (state === null) {
        excalidrawAPI?.updateScene({
          appState: {
            zenModeEnabled: false,
          },
        });
      } else if (state.name === "marker") {
        if (docked) {
          excalidrawAPI?.updateScene({
            appState: {
              zenModeEnabled: true,
            },
          });
        }
        forceUpdate({});
      }
    },
    [excalidrawAPI, docked]
  );

  const appState = excalidrawAPI?.getAppState();
  const currentTool = appState?.activeTool?.type;
  const currentStrokeColor = appState?.currentItemStrokeColor;
  const currentBackgroundColor = appState?.currentItemBackgroundColor;
  const currentStorkeStyle = appState?.currentItemStrokeStyle;
  // trick to update component
  const [, forceUpdate] = useState({});

  const updateStrokeColor = (color: string) => {
    excalidrawAPI?.updateScene({
      appState: {
        currentItemStrokeColor: color,
      },
    });
    forceUpdate({});
  };

  const updateBackgroundColor = (color: string) => {
    excalidrawAPI?.updateScene({
      appState: {
        currentItemBackgroundColor: color,
      },
    });
    forceUpdate({});
  };

  const chooseArrow = () => {
    excalidrawAPI?.updateScene({
      appState: {
        currentItemStrokeStyle: "solid",
        currentItemStartArrowhead: null,
        currentItemEndArrowhead: "arrow",
      },
    });
    toggleMarkerMode(false);
    excalidrawAPI?.setActiveTool({ type: "arrow" });
    forceUpdate({});
  };

  const chooseLine = () => {
    toggleMarkerMode(false);
    excalidrawAPI?.setActiveTool({ type: "line" });
    forceUpdate({});
  };

  const changeLineType = (lineType: StrokeStyle) => {
    excalidrawAPI?.updateScene({
      appState: {
        currentItemStrokeStyle: lineType,
      },
    });
    forceUpdate({});
  };
  const [t] = useTranslation();

  return (
    <Sidebar
      name="marker"
      docked={docked}
      onDock={handleDockedChange}
      onStateChange={handleStateChange}
    >
      <Sidebar.Header>
        <div className="text-[var(--color-primary)] text-[1.2em] bold text-ellipsis overflow-hidden whitespace-nowrap pr-[1em]">
          {t("Quick Marker")}
        </div>
      </Sidebar.Header>
      <ScrollArea>
        <div className="p-3 flex flex-col gap-y-2">
          <div className="grid grid-cols-6">
            <IconButton
              title="marker"
              active={currentTool === "custom" && isMarkerMode}
              onClick={toggleMarkerMode}
              icon={<IconCircleNumber1 />}
            />
            <IconButton
              active={currentTool === "arrow"}
              onClick={chooseArrow}
              title="arrow"
              icon={<IconArrowNarrowRight />}
            />
            <IconButton
              active={currentTool === "line"}
              onClick={chooseLine}
              title="line"
              icon={<IconSlash />}
            />
          </div>
          <div>
            <h3 className="mb-2 text-xs">{libI18n.t("labels.stroke")}</h3>
            <div className="flex box-border gap-2">
              {strokeColorList.map((color) => (
                <ColorButton
                  active={color === currentStrokeColor}
                  key={color}
                  color={color}
                  onClick={() => updateStrokeColor(color)}
                />
              ))}
              <div className="flex flex-row gap-x-2">
                <Separator orientation="vertical" />
                <ColorButton readonly color={currentStrokeColor as string} />
              </div>
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-xs">{libI18n.t("labels.background")}</h3>
            <div className="flex box-border gap-2">
              {backgroundColorList.map((color) => (
                <ColorButton
                  active={color === currentBackgroundColor}
                  key={color}
                  color={color}
                  onClick={() => updateBackgroundColor(color)}
                />
              ))}
              <div className="flex flex-row gap-x-2">
                <Separator orientation="vertical" />
                <ColorButton
                  readonly
                  color={currentBackgroundColor as string}
                />
              </div>
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-xs">{libI18n.t("labels.strokeStyle")}</h3>
            <div className="flex box-border gap-2">
              <IconButton
                active={currentStorkeStyle === "solid"}
                onClick={() => changeLineType("solid")}
                title={libI18n.t("labels.strokeStyle_solid")}
                icon={<IconSlash />}
              />
              <IconButton
                active={currentStorkeStyle === "dashed"}
                onClick={() => changeLineType("dashed")}
                title={libI18n.t("labels.strokeStyle_dashed")}
                icon={<IconLineDashed />}
              />
              <IconButton
                active={currentStorkeStyle === "dotted"}
                onClick={() => changeLineType("dotted")}
                title={libI18n.t("labels.strokeStyle_dotted")}
                icon={<IconLineDotted />}
              />
            </div>
          </div>
        </div>
      </ScrollArea>
    </Sidebar>
  );
};

export default QuickMarkSidebar;
