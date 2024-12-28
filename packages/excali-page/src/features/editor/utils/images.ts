import { PromsieWithResolve } from "../utils/promise";

type Area = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function getSizeOfDataImage(dataUrl: string, area?: Area) {
  const mimeType = dataUrl.split(",")[0].split(":")[1].split(";")[0];
  const { promise, resolve } = PromsieWithResolve<{
    width: number;
    height: number;
    mimeType: string;
    imageUrl: string;
  }>();

  if (area) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2d context");
    }
    const image = new Image();
    image.onload = () => {
      canvas.width = area.width;
      canvas.height = area.height;
      canvas.style.position = "absolute";
      canvas.style.top = "-10000px";
      ctx.drawImage(
        image,
        area.x,
        area.y,
        area.width,
        area.height,
        0,
        0,
        area.width,
        area.height
      );
      resolve({
        width: area.width,
        height: area.height,
        mimeType,
        imageUrl: canvas.toDataURL(),
      });
      canvas.remove();
    };
    image.src = dataUrl;
    document.body.appendChild(canvas);
    return promise;
  } else {
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.width,
        height: image.height,
        mimeType,
        imageUrl: dataUrl,
      });
      image.remove();
    };
    image.style.position = "absolute";
    image.style.top = "-10000px";
    image.src = dataUrl;
    document.body.appendChild(image);
  }
  return promise;
}
