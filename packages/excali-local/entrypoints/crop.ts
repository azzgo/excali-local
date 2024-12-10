export default defineUnlistedScript(() => {
  selectAreaOnPage();
});

const selectionId = "8ae3e065-e673-420d-a56f-6494523af2fb";
const haloId = "920f1e34-4d16-46a4-ba7a-0976d388185a";
let startX: number;
let startY: number;
let endX: number;
let endY: number;
let cleanOverlay: () => void;

function selectAreaOnPage() {
  cleanOverlay = addOverlay();
  document.addEventListener("mousedown", startSelection);
  document.addEventListener("keydown", onKeyDownCancelSelection);
  document.addEventListener("contextmenu", onRightClickCancelSelection);
  document.addEventListener("mousemove", cursorFollowEffect);
}

function cleanListeners() {
  document.removeEventListener("mousedown", startSelection);
  document.removeEventListener("mousemove", moveSelection);
  document.removeEventListener("mouseup", endSelection);
  document.removeEventListener("keydown", onKeyDownCancelSelection);
  document.removeEventListener("contextmenu", onRightClickCancelSelection);
  document.removeEventListener("mousemove", cursorFollowEffect);
}

function cancelSelection() {
  cleanOverlay();
  cleanListeners();
}

function cursorFollowEffect(event: MouseEvent) {
  const halo = document.getElementById(haloId);
  if (!halo) {
    return;
  }
  halo.style.left = `${event.clientX - 5}px`;
  halo.style.top = `${event.clientY - 5}px`;
}

function onKeyDownCancelSelection(event: KeyboardEvent) {
  if (event.key === "Escape") {
    cancelSelection();
  }
}

function onRightClickCancelSelection(event: MouseEvent) {
  if (event.button === 2) {
    cancelSelection();
  }
}

function addOverlay() {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.width = window.innerWidth + "px";
  overlay.style.height = window.innerHeight + "px";
  overlay.style.margin = "0";
  overlay.style.padding = "0";
  overlay.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
  overlay.style.zIndex = Number.MAX_SAFE_INTEGER.toString();
  overlay.style.cursor = "crosshair";

  const selection = document.createElement("div");
  selection.style.position = "absolute";
  selection.style.border = "1px dashed #fff";
  selection.style.backgroundColor = "rgba(100, 100, 100, 0.5)";
  selection.style.pointerEvents = "none";
  selection.style.margin = "0";
  selection.style.padding = "0";
  selection.style.zIndex = "99";
  selection.id = selectionId;
  overlay.appendChild(selection);

  const halo = document.createElement("div");
  halo.style.position = "absolute";
  halo.style.width = "10px";
  halo.style.height = "10px";
  halo.style.boxSizing = "border-box";
  halo.style.borderRadius = "50%";
  halo.style.top = "-1000px";
  halo.style.background = "rgba(255, 255, 255, 0.3)";
  halo.style.border = "2px solid rgba(244, 0, 0, 0.7)";
  halo.style.boxShadow = "0 0 10px 5px rgba(244, 0, 0, 0.7)";
  
  halo.style.pointerEvents = "none";
  halo.style.zIndex = "9";
  halo.id = haloId;
  overlay.appendChild(halo);

  document.documentElement.appendChild(overlay);

  return () => {
    overlay?.remove();
  };
}

function startSelection(event: MouseEvent) {
  startX = event.clientX;
  startY = event.clientY;

  document.addEventListener("mousemove", moveSelection);
  document.addEventListener("mouseup", endSelection);
}

function moveSelection(event: MouseEvent) {
  endX = event.clientX;
  endY = event.clientY;
  const selection = document.getElementById(selectionId);
  if (!selection) {
    return;
  }
  selection.style.left = `${Math.min(startX, endX)}px`;
  selection.style.top = `${Math.min(startY, endY)}px`;
  selection.style.width = `${Math.abs(endX - startX)}px`;
  selection.style.height = `${Math.abs(endY - startY)}px`;
}

function endSelection(event: MouseEvent) {
  endX = event.clientX;
  endY = event.clientY;
  document.removeEventListener("mousemove", moveSelection);
  document.removeEventListener("mouseup", endSelection);
  document.removeEventListener("mousedown", startSelection);
  cleanOverlay();
  let area = {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };

  if (area.width < 10 || area.height < 10) {
    area = {
      x: event.clientX - 50,
      y: event.clientY - 50,
      width: 100,
      height: 100,
    };
  }

  setTimeout(() => {
    requestAnimationFrame(() => {
      browser.runtime.sendMessage({ type: "CAPTURE_SELECT_AREA_END", area });
    });
  }, 150);
}
