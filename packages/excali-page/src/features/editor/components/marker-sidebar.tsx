import ColorButton from "@/components/color-button";
import IconButton from "@/components/icon-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sidebar, useI18n } from "@excalidraw/excalidraw";
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/dist/types/excalidraw/types";
import {
  IconArrowNarrowRight,
  IconCircleNumber1,
  IconLineDashed,
  IconLineDotted,
  IconBorderRadius,
  IconMinus,
  IconPencil,
  IconLetterA,
  IconCode,
} from "@tabler/icons-react";
import { useCallback, useMemo, useState } from "react";
import { useMarker } from "../hooks/use-marker";
import {
  StrokeStyle,
  RoundnessType,
} from "@excalidraw/excalidraw/dist/types/element/src/types";
import { useTranslation } from "react-i18next";
import { Separator } from "@/components/ui/separator";
import {
  EdgeSharpIcon,
  elbowArrowIcon,
  FontSizeExtraLargeIcon,
  FontSizeLargeIcon,
  FontSizeMediumIcon,
  FontSizeSmallIcon,
  roundArrowIcon,
  sharpArrowIcon,
  SloppinessArchitectIcon,
  SloppinessArtistIcon,
  SloppinessCartoonistIcon,
} from "@/components/SvgIcons";
import { Slider } from "@/components/ui/slider";

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
      setDocked(docked);
    },
    [excalidrawAPI],
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
        excalidrawAPI?.updateScene({
          appState: {
            zenModeEnabled: true,
          },
        });
        forceUpdate({});
      }
    },
    [excalidrawAPI, docked],
  );

  const appState = excalidrawAPI?.getAppState();
  const currentTool = appState?.activeTool?.type;
  const currentStrokeColor = appState?.currentItemStrokeColor;
  const currentBackgroundColor = appState?.currentItemBackgroundColor;
  const currentStorkeStyle = appState?.currentItemStrokeStyle;
  const currentStrokeWidth = appState?.currentItemStrokeWidth;
  const currentItemRoughness = appState?.currentItemRoughness;
  const currentRoundness = appState?.currentItemRoundness;
  const currentStartArrowhead = appState?.currentItemStartArrowhead;
  const currentEndArrowhead = appState?.currentItemEndArrowhead;
  const currentFontFamily = appState?.currentItemFontFamily;
  const currentFontSize = appState?.currentItemFontSize;
  const currentOpacity = appState?.currentItemOpacity;
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

  const enterMarkerMode = () => {
    toggleMarkerMode(true);
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

  const changeSloppiness = (sloppiness: number) => {
    excalidrawAPI?.updateScene({
      appState: {
        currentItemRoughness: sloppiness,
      },
    });
    forceUpdate({});
  };

  const changeStrokeWidth = (width: number) => {
    excalidrawAPI?.updateScene({
      appState: {
        currentItemStrokeWidth: width,
      },
    });
    forceUpdate({});
  };

  const changeRoundness = (roundness: RoundnessType) => {
    excalidrawAPI?.updateScene({
      appState: {
        currentItemRoundness: roundness,
      },
    });
    forceUpdate({});
  };

  const changeArrowType = (type: "sharp" | "round" | "elbow") => {
    excalidrawAPI?.updateScene({
      appState: {
        currentItemArrowType: type,
      },
    });
    forceUpdate({});
  };

  const changeFontFamily = (fontFamily: number) => {
    excalidrawAPI?.updateScene({
      appState: {
        currentItemFontFamily: fontFamily,
      },
    });
    forceUpdate({});
  };

  const changeFontSize = (fontSize: number) => {
    excalidrawAPI?.updateScene({
      appState: {
        currentItemFontSize: fontSize,
      },
    });
    forceUpdate({});
  };

  const changeOpacity = (opacity: number) => {
    excalidrawAPI?.updateScene({
      appState: {
        currentItemOpacity: opacity,
      },
    });
    forceUpdate({});
  };

  const [t] = useTranslation();
  const showConfiguration = useMemo(() => {
    return (
      ["arrow", "line"].includes(currentTool!) ||
      (currentTool === "custom" && isMarkerMode)
    );
  }, [isMarkerMode, currentTool]);

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
      <ScrollArea className=" p-3 h-[calc(100vh-68px)]">
        <div className="grid grid-cols-6 mb-4">
          <IconButton
            title="marker"
            active={currentTool === "custom" && isMarkerMode}
            onClick={enterMarkerMode}
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
            icon={<IconMinus />}
          />
        </div>
        {showConfiguration ? (
          <div className="gap-y-2 flex flex-col">
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
              <h3 className="mb-2 text-xs">
                {libI18n.t("labels.strokeWidth")}
              </h3>
              <div className="flex box-border gap-2">
                <IconButton
                  active={currentStrokeWidth === 1}
                  onClick={() => changeStrokeWidth(1)}
                  title={libI18n.t("labels.thin")}
                  icon={<IconMinus className="stroke-[1]" />}
                />
                <IconButton
                  active={currentStrokeWidth === 2}
                  onClick={() => changeStrokeWidth(2)}
                  title={libI18n.t("labels.bold")}
                  icon={<IconMinus className="stroke-[3]" />}
                />
                <IconButton
                  active={currentStrokeWidth === 4}
                  onClick={() => changeStrokeWidth(4)}
                  title={libI18n.t("labels.extraBold")}
                  icon={<IconMinus className="stroke-[5]" />}
                />
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-xs">
                {libI18n.t("labels.strokeStyle")}
              </h3>
              <div className="flex box-border gap-2">
                <IconButton
                  active={currentStorkeStyle === "solid"}
                  onClick={() => changeLineType("solid")}
                  title={libI18n.t("labels.strokeStyle_solid")}
                  icon={<IconMinus />}
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
            <div>
              <h3 className="mb-2 text-xs">{libI18n.t("labels.sloppiness")}</h3>
              <div className="flex box-border gap-2">
                <IconButton
                  active={currentItemRoughness === 0}
                  onClick={() => changeSloppiness(0)}
                  title={libI18n.t("labels.architect")}
                  icon={SloppinessArchitectIcon}
                />
                <IconButton
                  active={currentItemRoughness === 1}
                  onClick={() => changeSloppiness(1)}
                  title={libI18n.t("labels.artist")}
                  icon={SloppinessArtistIcon}
                />
                <IconButton
                  active={currentItemRoughness === 2}
                  onClick={() => changeSloppiness(2)}
                  title={libI18n.t("labels.cartoonist")}
                  icon={SloppinessCartoonistIcon}
                />
              </div>
            </div>
            {isMarkerMode && (
              <div>
                <h3 className="mb-2 text-xs">
                  {libI18n.t("labels.fontFamily")}
                </h3>
                <div className="flex box-border gap-2">
                  <IconButton
                    active={currentFontFamily === 5}
                    onClick={() => changeFontFamily(5)}
                    title={libI18n.t("labels.handDrawn")}
                    icon={<IconPencil />}
                  />
                  <IconButton
                    active={currentFontFamily === 6}
                    onClick={() => changeFontFamily(6)}
                    title={libI18n.t("labels.normal")}
                    icon={<IconLetterA />}
                  />
                  <IconButton
                    active={currentFontFamily === 8}
                    onClick={() => changeFontFamily(8)}
                    title={libI18n.t("labels.code")}
                    icon={<IconCode />}
                  />
                </div>
              </div>
            )}
            {isMarkerMode && (
              <div>
                <h3 className="mb-2 text-xs">{libI18n.t("labels.fontSize")}</h3>
                <div className="flex box-border gap-2">
                  <IconButton
                    active={currentFontSize === 16}
                    onClick={() => changeFontSize(16)}
                    title={libI18n.t("labels.small")}
                    icon={FontSizeSmallIcon}
                  />
                  <IconButton
                    active={currentFontSize === 20}
                    onClick={() => changeFontSize(20)}
                    title={libI18n.t("labels.medium")}
                    icon={FontSizeMediumIcon}
                  />
                  <IconButton
                    active={currentFontSize === 28}
                    onClick={() => changeFontSize(28)}
                    title={libI18n.t("labels.large")}
                    icon={FontSizeLargeIcon}
                  />
                  <IconButton
                    active={currentFontSize === 36}
                    onClick={() => changeFontSize(36)}
                    title={libI18n.t("labels.veryLarge")}
                    icon={FontSizeExtraLargeIcon}
                  />
                </div>
              </div>
            )}
            {/* 边角 - 只在 line 模式下显示 */}
            {currentTool === "line" && (
              <div>
                <h3 className="mb-2 text-xs">{libI18n.t("labels.edges")}</h3>
                <div className="flex box-border gap-2">
                  <IconButton
                    active={currentRoundness === "sharp"}
                    onClick={() => changeRoundness("sharp")}
                    title={libI18n.t("labels.sharp")}
                    icon={EdgeSharpIcon}
                  />
                  <IconButton
                    active={currentRoundness === "round"}
                    onClick={() => changeRoundness("round")}
                    title={libI18n.t("labels.round")}
                    icon={<IconBorderRadius />}
                  />
                </div>
              </div>
            )}
            {/* 箭头类型 - 只在 arrow 模式下显示 */}
            {currentTool === "arrow" && (
              <div>
                <h3 className="mb-2 text-xs">
                  {libI18n.t("labels.arrowtypes")}
                </h3>
                <div className="flex box-border gap-2">
                  <IconButton
                    active={
                      currentStartArrowhead === null &&
                      currentEndArrowhead === "arrow"
                    }
                    onClick={() => changeArrowType("sharp")}
                    title={libI18n.t("labels.arrowtype_sharp")}
                    icon={sharpArrowIcon}
                  />
                  <IconButton
                    active={
                      currentStartArrowhead === "arrow" &&
                      currentEndArrowhead === "arrow"
                    }
                    onClick={() => changeArrowType("round")}
                    title={libI18n.t("labels.arrowtype_round")}
                    icon={elbowArrowIcon}
                  />
                  <IconButton
                    active={
                      currentStartArrowhead === null &&
                      currentEndArrowhead === "dot"
                    }
                    onClick={() => changeArrowType("elbow")}
                    title={libI18n.t("labels.arrowtype_elbowed")}
                    icon={roundArrowIcon}
                  />
                </div>
              </div>
            )}
            <div className="mb-6">
              <div className="mb-2 flex flex-row justify-between">
                <h3 className=" text-xs">{libI18n.t("labels.opacity")}</h3>
                <span>{currentOpacity}</span>
              </div>
              <div className="flex box-border gap-2">
                <Slider
                  value={[currentOpacity || 100]}
                  min={0}
                  max={100}
                  step={1}
                  defaultValue={[100]}
                  onValueChange={([opacity]) => changeOpacity(opacity)}
                />
              </div>
            </div>
          </div>
        ) : (
          <Empty className="h-[calc(100vh-120px)]">
            <EmptyContent>
              <EmptyTitle>{t("Select a tool")}</EmptyTitle>
              <EmptyDescription>
                {t("Markder Sidebar Empty Tip")}
              </EmptyDescription>
            </EmptyContent>
          </Empty>
        )}
      </ScrollArea>
    </Sidebar>
  );
};

export default QuickMarkSidebar;
