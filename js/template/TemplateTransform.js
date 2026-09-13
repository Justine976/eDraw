export const DEFAULT_TRANSFORM = Object.freeze({
  x: 0.5,
  y: 0.5,
  width: 0.58,
  scale: 1,
  rotation: 0,
  opacity: 0.82,
  locked: false,
  tracing: false,
  placed: false,
});

export function createTransform(overrides = {}) {
  return { ...DEFAULT_TRANSFORM, ...overrides };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function degreesToRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

export function radiansToDegrees(radians) {
  return (radians * 180) / Math.PI;
}

export function normalizeDegrees(degrees) {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

export function getCanvasPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);

  return {
    x,
    y,
    pixelX: x * canvas.width,
    pixelY: y * canvas.height,
  };
}

export function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function angleBetween(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

export function getTemplateDimensions(canvas, image, transform) {
  const naturalWidth = image?.naturalWidth || 4;
  const naturalHeight = image?.naturalHeight || 3;
  const baseWidth = Math.min(canvas.width, canvas.height) * transform.width * transform.scale;

  return {
    width: baseWidth,
    height: baseWidth * (naturalHeight / naturalWidth),
  };
}
