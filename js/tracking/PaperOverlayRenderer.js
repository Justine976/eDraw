import { drawImageInQuad, orderCorners } from "./Homography.js";
import { degreesToRadians, getTemplateDimensions } from "../template/TemplateTransform.js";

export function installPaperOverlay(ar) {
  const originalDraw = ar.draw.bind(ar);

  ar.draw = (surface) => {
    if (ar.worldTrackingActive || !ar.transform.placed || !ar.activeImage || !surface?.surface?.corners) {
      originalDraw(surface);
      return;
    }

    const { width, height } = ar.canvas;
    ar.context.clearRect(0, 0, width, height);

    if (!ar.cameraActive) {
      ar.drawCameraPlaceholder(width, height);
    }

    ar.transform = ar.poseManager.applyToTransform(ar.transform);
    drawPaperTemplate(ar, surface.surface);
  };
}

function drawPaperTemplate(ar, surface) {
  const context = ar.context;
  const quad = projectCornersToCanvas(ar, surface.corners);
  const ordered = orderCorners(quad);
  const [topLeft, topRight, bottomRight, bottomLeft] = ordered;

  const widthVector = {
    x: topRight.x - topLeft.x,
    y: topRight.y - topLeft.y,
  };
  const heightVector = {
    x: bottomLeft.x - topLeft.x,
    y: bottomLeft.y - topLeft.y,
  };

  const paperWidth = Math.max(1, Math.hypot(widthVector.x, widthVector.y));
  const paperHeight = Math.max(1, Math.hypot(heightVector.x, heightVector.y));
  const widthUnit = { x: widthVector.x / paperWidth, y: widthVector.y / paperWidth };
  const heightUnit = { x: heightVector.x / paperHeight, y: heightVector.y / paperHeight };
  const paperCenter = {
    x: (topLeft.x + topRight.x + bottomRight.x + bottomLeft.x) / 4,
    y: (topLeft.y + topRight.y + bottomRight.y + bottomLeft.y) / 4,
  };

  const transformCenter = {
    x: ar.transform.x * ar.canvas.width,
    y: ar.transform.y * ar.canvas.height,
  };
  const centerOffset = {
    x: transformCenter.x - paperCenter.x,
    y: transformCenter.y - paperCenter.y,
  };

  const localCenter = {
    u: (centerOffset.x * widthUnit.x + centerOffset.y * widthUnit.y) / paperWidth,
    v: (centerOffset.x * heightUnit.x + centerOffset.y * heightUnit.y) / paperHeight,
  };

  const dimensions = getTemplateDimensions(ar.canvas, ar.activeImage, ar.transform);
  const localWidth = Math.min(0.95, Math.max(0.02, dimensions.width / paperWidth));
  const localHeight = Math.min(0.95, Math.max(0.02, dimensions.height / paperHeight));
  const rotation = degreesToRadians(ar.transform.rotation);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const points = [
    { x: -localWidth / 2, y: -localHeight / 2 },
    { x: localWidth / 2, y: -localHeight / 2 },
    { x: localWidth / 2, y: localHeight / 2 },
    { x: -localWidth / 2, y: localHeight / 2 },
  ].map((point) => {
    const rotatedU = point.x * cos - point.y * sin;
    const rotatedV = point.x * sin + point.y * cos;
    return canvasPointFromPaper(ar, paperCenter, widthVector, heightVector, localCenter.u + rotatedU, localCenter.v + rotatedV);
  });

  context.save();
  context.globalAlpha = ar.transform.opacity;
  drawImageInQuad(context, ar.activeImage, points);
  context.restore();

  if (!ar.transform.locked) {
    context.save();
    context.strokeStyle = "rgba(79, 209, 191, 0.95)";
    context.lineWidth = 2;
    context.setLineDash([10, 8]);
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index].x, points[index].y);
    }
    context.closePath();
    context.stroke();
    context.restore();
  }
}

function projectCornersToCanvas(ar, corners) {
  return corners.map((corner) => {
    const point = mapVideoPointToCanvas(ar.video, ar.canvas, corner.x, corner.y);
    return { x: point.x, y: point.y };
  });
}

function mapVideoPointToCanvas(video, canvas, normalizedX, normalizedY) {
  const videoWidth = video?.videoWidth || canvas.width;
  const videoHeight = video?.videoHeight || canvas.height;
  const canvasAspect = canvas.width / Math.max(1, canvas.height);
  const videoAspect = videoWidth / Math.max(1, videoHeight);

  let sourceX = normalizedX * videoWidth;
  let sourceY = normalizedY * videoHeight;

  if (videoAspect > canvasAspect) {
    const visibleWidth = videoHeight * canvasAspect;
    const cropX = (videoWidth - visibleWidth) / 2;
    sourceX -= cropX;
    return {
      x: (sourceX / visibleWidth) * canvas.width,
      y: normalizedY * canvas.height,
    };
  }

  const visibleHeight = videoWidth / canvasAspect;
  const cropY = (videoHeight - visibleHeight) / 2;
  sourceY -= cropY;
  return {
    x: normalizedX * canvas.width,
    y: (sourceY / visibleHeight) * canvas.height,
  };
}

function canvasPointFromPaper(ar, center, widthVector, heightVector, u, v) {
  return {
    x: center.x + widthVector.x * u + heightVector.x * v,
    y: center.y + widthVector.y * u + heightVector.y * v,
  };
}
