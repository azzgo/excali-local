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
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  overlay.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
  overlay.style.zIndex = "9999";
  overlay.style.pointerEvents = "none";

  const selection = document.createElement("div");
  selection.style.position = "absolute";
  selection.style.border = "1px dashed #fff";
  selection.style.backgroundColor = "rgba(100, 100, 100, 0.5)";
  selection.style.pointerEvents = "none";
  selection.id = selectionId;
  overlay.appendChild(selection);

  document.body.appendChild(overlay);
  document.body.style.userSelect = "none";
  // prevent scroll
  const stopScroll = (event: Event) => {
    event.preventDefault();
  };
  document.body.addEventListener("scroll", stopScroll, { passive: false });

  return () => {
    document.body.style.userSelect = "";
    document.body.removeEventListener("scroll", stopScroll);
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

  const area = {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };

  setTimeout(() => {
    requestAnimationFrame(() => {
      chrome.runtime.sendMessage({ type: "CAPTURE_SELECT_AREA_END", area });
    });
  }, 150);
}
