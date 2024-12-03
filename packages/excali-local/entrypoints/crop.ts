export default defineUnlistedScript(() => {
  selectAreaOnPage();
});

const selectionId = "8ae3e065-e673-420d-a56f-6494523af2fb";
let startX: number;
let startY: number;
let endX: number;
let endY: number;
let cleanOverlay: () => void;

function selectAreaOnPage() {
  cleanOverlay = addOverlay();
  document.addEventListener("mousedown", startSelection);
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
  selection.id = selectionId;
  overlay.appendChild(selection);

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
    }
  }


  setTimeout(() => {
    requestAnimationFrame(() => {
      browser.runtime.sendMessage({ type: "CAPTURE_SELECT_AREA_END", area });
    });
  }, 150);
}
