import { ExcalidrawElement, ExcalidrawLinearElement } from "../element/types";
import { AppState } from "../types";
import { Mutable } from "../utility-types";
export declare const actionUnbindText: {
    name: "unbindText";
    contextItemLabel: string;
    trackEvent: {
        category: "element";
    };
    predicate: (elements: readonly ExcalidrawElement[], appState: AppState, _: import("../types").ExcalidrawProps, app: import("../types").AppClassProperties) => boolean;
    perform: (elements: readonly ExcalidrawElement[], appState: Readonly<AppState>, _: any, app: import("../types").AppClassProperties) => {
        elements: readonly ExcalidrawElement[];
        appState: Readonly<AppState>;
        commitToHistory: true;
    };
} & {
    keyTest?: undefined;
};
export declare const actionBindText: {
    name: "bindText";
    contextItemLabel: string;
    trackEvent: {
        category: "element";
    };
    predicate: (elements: readonly ExcalidrawElement[], appState: AppState, _: import("../types").ExcalidrawProps, app: import("../types").AppClassProperties) => boolean;
    perform: (elements: readonly ExcalidrawElement[], appState: Readonly<AppState>, _: any, app: import("../types").AppClassProperties) => {
        elements: ExcalidrawElement[];
        appState: {
            selectedElementIds: {
                [x: string]: true;
            };
            contextMenu: {
                items: import("../components/ContextMenu").ContextMenuItems;
                top: number;
                left: number;
            } | null;
            showWelcomeScreen: boolean;
            isLoading: boolean;
            errorMessage: import("react").ReactNode;
            activeEmbeddable: {
                element: import("../element/types").NonDeletedExcalidrawElement;
                state: "active" | "hover";
            } | null;
            draggingElement: import("../element/types").NonDeletedExcalidrawElement | null;
            resizingElement: import("../element/types").NonDeletedExcalidrawElement | null;
            multiElement: import("../element/types").NonDeleted<ExcalidrawLinearElement> | null;
            selectionElement: import("../element/types").NonDeletedExcalidrawElement | null;
            isBindingEnabled: boolean;
            startBoundElement: import("../element/types").NonDeleted<import("../element/types").ExcalidrawBindableElement> | null;
            suggestedBindings: import("../element/binding").SuggestedBinding[];
            frameToHighlight: import("../element/types").NonDeleted<import("../element/types").ExcalidrawFrameLikeElement> | null;
            frameRendering: {
                enabled: boolean;
                name: boolean;
                outline: boolean;
                clip: boolean;
            };
            editingFrame: string | null;
            elementsToHighlight: import("../element/types").NonDeleted<ExcalidrawElement>[] | null;
            editingElement: import("../element/types").NonDeletedExcalidrawElement | null;
            editingLinearElement: import("../element/linearElementEditor").LinearElementEditor | null;
            activeTool: {
                lastActiveTool: import("../types").ActiveTool | null;
                locked: boolean;
            } & import("../types").ActiveTool;
            penMode: boolean;
            penDetected: boolean;
            exportBackground: boolean;
            exportEmbedScene: boolean;
            exportWithDarkMode: boolean;
            exportScale: number;
            currentItemStrokeColor: string;
            currentItemBackgroundColor: string;
            currentItemFillStyle: import("../element/types").FillStyle;
            currentItemStrokeWidth: number;
            currentItemStrokeStyle: import("../element/types").StrokeStyle;
            currentItemRoughness: number;
            currentItemOpacity: number;
            currentItemFontFamily: number;
            currentItemFontSize: number;
            currentItemTextAlign: string;
            currentItemStartArrowhead: import("../element/types").Arrowhead | null;
            currentItemEndArrowhead: import("../element/types").Arrowhead | null;
            currentItemRoundness: import("../element/types").StrokeRoundness;
            viewBackgroundColor: string;
            scrollX: number;
            scrollY: number;
            cursorButton: "up" | "down";
            scrolledOutside: boolean;
            name: string;
            isResizing: boolean;
            isRotating: boolean;
            zoom: Readonly<{
                value: import("../types").NormalizedZoomValue;
            }>;
            openMenu: "canvas" | "shape" | null;
            openPopup: "canvasBackground" | "elementBackground" | "elementStroke" | null;
            openSidebar: {
                name: string;
                tab?: string | undefined;
            } | null;
            openDialog: {
                name: "imageExport" | "help" | "jsonExport";
            } | {
                name: "settings";
                source: "settings" | "tool" | "generation";
                tab: "text-to-diagram" | "diagram-to-code";
            } | {
                name: "ttd";
                tab: "mermaid" | "text-to-diagram";
            } | null;
            defaultSidebarDockedPreference: boolean;
            lastPointerDownWith: import("../element/types").PointerType;
            previousSelectedElementIds: {
                [id: string]: true;
            };
            selectedElementsAreBeingDragged: boolean;
            shouldCacheIgnoreZoom: boolean;
            toast: {
                message: string;
                closable?: boolean | undefined;
                duration?: number | undefined;
            } | null;
            zenModeEnabled: boolean;
            theme: import("../element/types").Theme;
            gridSize: number | null;
            viewModeEnabled: boolean;
            selectedGroupIds: {
                [groupId: string]: boolean;
            };
            editingGroupId: string | null;
            width: number;
            height: number;
            offsetTop: number;
            offsetLeft: number;
            fileHandle: import("browser-fs-access").FileSystemHandle | null;
            collaborators: Map<import("../types").SocketId, Readonly<{
                pointer?: import("../types").CollaboratorPointer | undefined;
                button?: "up" | "down" | undefined;
                selectedElementIds?: Readonly<{
                    [id: string]: true;
                }> | undefined;
                username?: string | null | undefined;
                userState?: import("../types").UserIdleState | undefined;
                color?: {
                    background: string;
                    stroke: string;
                } | undefined;
                avatarUrl?: string | undefined;
                id?: string | undefined;
                socketId?: import("../types").SocketId | undefined;
                isCurrentUser?: boolean | undefined;
            }>>;
            showStats: boolean;
            currentChartType: import("../element/types").ChartType;
            pasteDialog: {
                shown: false;
                data: null;
            } | {
                shown: true;
                data: import("../charts").Spreadsheet;
            };
            pendingImageElementId: string | null;
            showHyperlinkPopup: false | "editor" | "info";
            selectedLinearElement: import("../element/linearElementEditor").LinearElementEditor | null;
            snapLines: readonly import("../snapping").SnapLine[];
            originSnapOffset: {
                x: number;
                y: number;
            } | null;
            objectsSnapModeEnabled: boolean;
            userToFollow: import("../types").UserToFollow | null;
            followedBy: Set<import("../types").SocketId>;
        };
        commitToHistory: true;
    };
} & {
    keyTest?: undefined;
};
export declare const actionWrapTextInContainer: {
    name: "wrapTextInContainer";
    contextItemLabel: string;
    trackEvent: {
        category: "element";
    };
    predicate: (elements: readonly ExcalidrawElement[], appState: AppState, _: import("../types").ExcalidrawProps, app: import("../types").AppClassProperties) => boolean;
    perform: (elements: readonly ExcalidrawElement[], appState: Readonly<AppState>, _: any, app: import("../types").AppClassProperties) => {
        elements: readonly ExcalidrawElement[];
        appState: {
            selectedElementIds: Mutable<Readonly<{
                [id: string]: true;
            }>>;
            contextMenu: {
                items: import("../components/ContextMenu").ContextMenuItems;
                top: number;
                left: number;
            } | null;
            showWelcomeScreen: boolean;
            isLoading: boolean;
            errorMessage: import("react").ReactNode;
            activeEmbeddable: {
                element: import("../element/types").NonDeletedExcalidrawElement;
                state: "active" | "hover";
            } | null;
            draggingElement: import("../element/types").NonDeletedExcalidrawElement | null;
            resizingElement: import("../element/types").NonDeletedExcalidrawElement | null;
            multiElement: import("../element/types").NonDeleted<ExcalidrawLinearElement> | null;
            selectionElement: import("../element/types").NonDeletedExcalidrawElement | null;
            isBindingEnabled: boolean;
            startBoundElement: import("../element/types").NonDeleted<import("../element/types").ExcalidrawBindableElement> | null;
            suggestedBindings: import("../element/binding").SuggestedBinding[];
            frameToHighlight: import("../element/types").NonDeleted<import("../element/types").ExcalidrawFrameLikeElement> | null;
            frameRendering: {
                enabled: boolean;
                name: boolean;
                outline: boolean;
                clip: boolean;
            };
            editingFrame: string | null;
            elementsToHighlight: import("../element/types").NonDeleted<ExcalidrawElement>[] | null;
            editingElement: import("../element/types").NonDeletedExcalidrawElement | null;
            editingLinearElement: import("../element/linearElementEditor").LinearElementEditor | null;
            activeTool: {
                lastActiveTool: import("../types").ActiveTool | null;
                locked: boolean;
            } & import("../types").ActiveTool;
            penMode: boolean;
            penDetected: boolean;
            exportBackground: boolean;
            exportEmbedScene: boolean;
            exportWithDarkMode: boolean;
            exportScale: number;
            currentItemStrokeColor: string;
            currentItemBackgroundColor: string;
            currentItemFillStyle: import("../element/types").FillStyle;
            currentItemStrokeWidth: number;
            currentItemStrokeStyle: import("../element/types").StrokeStyle;
            currentItemRoughness: number;
            currentItemOpacity: number;
            currentItemFontFamily: number;
            currentItemFontSize: number;
            currentItemTextAlign: string;
            currentItemStartArrowhead: import("../element/types").Arrowhead | null;
            currentItemEndArrowhead: import("../element/types").Arrowhead | null;
            currentItemRoundness: import("../element/types").StrokeRoundness;
            viewBackgroundColor: string;
            scrollX: number;
            scrollY: number;
            cursorButton: "up" | "down";
            scrolledOutside: boolean;
            name: string;
            isResizing: boolean;
            isRotating: boolean;
            zoom: Readonly<{
                value: import("../types").NormalizedZoomValue;
            }>;
            openMenu: "canvas" | "shape" | null;
            openPopup: "canvasBackground" | "elementBackground" | "elementStroke" | null;
            openSidebar: {
                name: string;
                tab?: string | undefined;
            } | null;
            openDialog: {
                name: "imageExport" | "help" | "jsonExport";
            } | {
                name: "settings";
                source: "settings" | "tool" | "generation";
                tab: "text-to-diagram" | "diagram-to-code";
            } | {
                name: "ttd";
                tab: "mermaid" | "text-to-diagram";
            } | null;
            defaultSidebarDockedPreference: boolean;
            lastPointerDownWith: import("../element/types").PointerType;
            previousSelectedElementIds: {
                [id: string]: true;
            };
            selectedElementsAreBeingDragged: boolean;
            shouldCacheIgnoreZoom: boolean;
            toast: {
                message: string;
                closable?: boolean | undefined;
                duration?: number | undefined;
            } | null;
            zenModeEnabled: boolean;
            theme: import("../element/types").Theme;
            gridSize: number | null;
            viewModeEnabled: boolean;
            selectedGroupIds: {
                [groupId: string]: boolean;
            };
            editingGroupId: string | null;
            width: number;
            height: number;
            offsetTop: number;
            offsetLeft: number;
            fileHandle: import("browser-fs-access").FileSystemHandle | null;
            collaborators: Map<import("../types").SocketId, Readonly<{
                pointer?: import("../types").CollaboratorPointer | undefined;
                button?: "up" | "down" | undefined;
                selectedElementIds?: Readonly<{
                    [id: string]: true;
                }> | undefined;
                username?: string | null | undefined;
                userState?: import("../types").UserIdleState | undefined;
                color?: {
                    background: string;
                    stroke: string;
                } | undefined;
                avatarUrl?: string | undefined;
                id?: string | undefined;
                socketId?: import("../types").SocketId | undefined;
                isCurrentUser?: boolean | undefined;
            }>>;
            showStats: boolean;
            currentChartType: import("../element/types").ChartType;
            pasteDialog: {
                shown: false;
                data: null;
            } | {
                shown: true;
                data: import("../charts").Spreadsheet;
            };
            pendingImageElementId: string | null;
            showHyperlinkPopup: false | "editor" | "info";
            selectedLinearElement: import("../element/linearElementEditor").LinearElementEditor | null;
            snapLines: readonly import("../snapping").SnapLine[];
            originSnapOffset: {
                x: number;
                y: number;
            } | null;
            objectsSnapModeEnabled: boolean;
            userToFollow: import("../types").UserToFollow | null;
            followedBy: Set<import("../types").SocketId>;
        };
        commitToHistory: true;
    };
} & {
    keyTest?: undefined;
};
