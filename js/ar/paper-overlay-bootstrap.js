import { ARManager } from "./ARManager.js";
import { drawImageInQuad, orderCorners } from "../tracking/Homography.js";
import { degreesToRadians, getTemplateDimensions } from "../template/TemplateTransform.js";

const originalDraw = ARManager.prototype.draw;

ARManager.prototype.draw = function drawWithPaperOverlay(surface) {
  if (this.worldTrackingActive || !this.transform.placed || !this.activeImage || !surface?.surface?.corners) {
    return originalDraw.call(this, surface);
  }

  const { width, height } = this.canvas;
  this.context.clearRect(0, 0, width, height);
  if (!this.cameraActive) {
    this.drawCameraPlaceholder(width, height);
  }

  this.transform = this.poseManager.applyToTransform(this.transform);
  drawPaperTemplate(this, surface.surface);
};

function drawPaperTemplate(ar, surface) {
  const paper = orderCorners(surface.corners.map((corner) => mapVideoPointToCanvas(ar.video, ar.canvas, corner.x, corner.y)));
  const [topLeft, topRight, bottomRight, bottomLeft] = paper;
  const widthVector = { x: topRight.x - topLeft.x, y: topRight.y - topLeft.y };
  const heightVector = { x: bottomLeft.x - topLeft.x, y: bottomLeft.y - topLeft.y };
  const paperWidth = Math.max(1, Math.hypot(widthVector.x, widthVector.y));
  const paperHeight = Math.max(1, Math.hypot(heightVector.x, heightVector.y));
  const center = paper.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
  const widthUnit = { x: widthVector.x / paperWidth, y: widthVector.y / paperWidth };
  const heightUnit = { x: heightVector.x / paperHeight, y: heightVector.y / paperHeight };
  const transformCenter = { x: ar.transform.x * ar.canvas.width, y: ar.transform.y * ar.canvas.height };
  const offset = { x: transformCenter.x - center.x, y: transformCenter.y - center.y };
  const centerU = (offset.x * widthUnit.x + offset.y * widthUnit.y) / paperWidth;
  const centerV = (offset.x * heightUnit.x + offset.y * heightUnit.y) / paperHeight;
  const dimensions = getTemplateDimensions(ar.canvas, ar.activeImage, ar.transform);
  const localWidth = Math.min(0.95, Math.max(0.03, dimensions.width / paperWidth));
  const localHeight = Math.min(0.95, Math.max(0.03, dimensions.height / paperHeight));
  const rotation = degreesToRadians(ar.transform.rotation);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const quad = [
    [-localWidth / 2, -localHeight / 2],
    [localWidth / 2, -localHeight / 2],
    [localWidth / 2, localHeight / 2],
    [-localWidth / 2, localHeight / 2],
  ].map(([u, v]) => {
    const ru = u * cos - v * sin;
    const rv = u * sin + v * cos;
    return {
      x: center.x + widthVector.x * (centerU + ru) + heightVector.x * (centerV + rv),
      y: center.y + widthVector.y * (centerU + ru) + heightVector.y * (centerV + rv),
    };
  });

  ar.context.save();
  ar.context.globalAlpha = ar.transform.opacity;
  drawImageInQuad(ar.context, ar.activeImage, quad);
  ar.context.restore();

  if (!ar.transform.locked) {
    ar.context.save();
    ar.context.strokeStyle = "rgba(79, 209, 191, 0.95)";
    ar.context.lineWidth = 2;
    ar.context.setLineDash([10, 8]);
    ar.context.beginPath();
    ar.context.moveTo(quad[0].x, quad[0].y);
    quad.slice(1).forEach((point) => ar.context.lineTo(point.x, point.y));
    ar.context.closePath();
    ar.context.stroke();
    ar.context.restore();
  }
}

function mapVideoPointToCanvas(video, canvas, x, y) {
  const videoWidth = video?.videoWidth || canvas.width;
  const videoHeight = video?.videoHeight || canvas.height;
  const videoAspect = videoWidth / Math.max(1, videoHeight);
  const canvasAspect = canvas.width / Math.max(1, canvas.height);

  if (videoAspect > canvasAspect) {
    const visibleWidth = videoHeight * canvasAspect;
    const cropX = (videoWidth - visibleWidth) / 2;
    return { x: ((x * videoWidth - cropX) / visibleWidth) * canvas.width, y: y * canvas.height };
  }

  const visibleHeight = videoWidth / canvasAspect;
  const cropY = (videoHeight - visibleHeight) / 2;
  return { x: x * canvas.width, y: ((y * videoHeight - cropY) / visibleHeight) * canvas.height };
}
