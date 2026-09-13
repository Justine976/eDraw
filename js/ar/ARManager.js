import { AnchorManager } from "./AnchorManager.js";
import { PoseManager } from "./PoseManager.js";
import { SurfaceDetector } from "./SurfaceDetector.js";
import { TrackingManager } from "./TrackingManager.js";
import {
  angleBetween,
  clamp,
  createTransform,
  degreesToRadians,
  distanceBetween,
  getCanvasPoint,
  getTemplateDimensions,
  midpoint,
  normalizeDegrees,
  radiansToDegrees,
} from "../template/TemplateTransform.js";

export class ARManager {
  constructor({ root, video, canvas, reticle, reticleLabel, statusText, trackingBadge }) {
    this.root = root || canvas.closest(".ar-screen");
    this.video = video;
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.reticle = reticle;
    this.reticleLabel = reticleLabel;
    this.statusText = statusText;
    this.trackingBadge = trackingBadge;
    this.tracking = new TrackingManager();
    this.surfaceDetector = new SurfaceDetector(this.tracking);
    this.anchorManager = new AnchorManager(this.tracking);
    this.poseManager = new PoseManager(this.anchorManager);
    this.transform = createTransform();
    this.activeTemplate = null;
    this.activeImage = null;
    this.lastEditOpacity = this.transform.opacity;
    this.listeners = new Set();
    this.pointers = new Map();
    this.gesture = null;
    this.running = false;
    this.initialized = false;
    this.cameraActive = false;
    this.worldTrackingActive = false;
    this.canPlace = false;
    this.animationFrame = 0;

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.renderFrame = this.renderFrame.bind(this);
    this.handleTrackingEnded = this.handleTrackingEnded.bind(this);
  }

  init({ cameraActive = false, overlayRoot = document.body, forceFallback = false } = {}) {
    this.cameraActive = cameraActive;
    const capabilities = this.tracking.init({
      video: this.video,
      canvas: this.canvas,
      overlayRoot,
      forceFallback,
      onWorldSelect: (point) => {
        if (!this.transform.placed) {
          this.place(point);
        }
      },
      onSessionEnded: this.handleTrackingEnded,
    });

    this.trackingBadge.textContent = capabilities.name;

    if (!this.initialized) {
      this.canvas.addEventListener("pointerdown", this.handlePointerDown);
      this.canvas.addEventListener("pointermove", this.handlePointerMove);
      this.canvas.addEventListener("pointerup", this.handlePointerUp);
      this.canvas.addEventListener("pointercancel", this.handlePointerUp);
      window.addEventListener("resize", () => this.resizeCanvas());
      this.initialized = true;
    }

    return capabilities;
  }

  async start(options = {}) {
    this.running = true;
    const capabilities = await this.tracking.start(options);
    this.cameraActive = this.cameraActive || !capabilities.needsCamera;
    this.updateTrackingClasses(capabilities);
    this.trackingBadge.textContent = capabilities.name;
    this.resizeCanvas();
    this.animationFrame = requestAnimationFrame(this.renderFrame);
    this.emit();
    return capabilities;
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
    this.tracking.stop();
    this.anchorManager.clear();
    this.pointers.clear();
    this.gesture = null;
    this.updateTrackingClasses({ mode: "fallback" });
  }

  onStateChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setTemplate(template, image) {
    this.activeTemplate = template;
    this.activeImage = image;
    this.tracking.setTemplateImage(image);

    if (this.running && this.transform.placed) {
      this.statusText.textContent = `${template.name} selected.`;
    }

    this.emit();
  }

  setCameraActive(cameraActive) {
    this.cameraActive = cameraActive;
  }

  getCapabilities() {
    return this.tracking.getCapabilities();
  }

  async getWorldReadiness() {
    return this.tracking.getWorldReadiness();
  }

  place(point) {
    if (!this.activeImage) {
      this.statusText.textContent = "Select a template first.";
      return;
    }

    if (this.transform.placed && this.transform.locked) {
      this.statusText.textContent = "Unlock before moving.";
      return;
    }

    const surface = this.surfaceDetector.update();

    if (!surface.available) {
      if (this.worldTrackingActive && this.tracking.queuePlacement()) {
        this.statusText.textContent = "Placement armed. Point the reticle at the paper.";
        return;
      }

      this.statusText.textContent = this.worldTrackingActive
        ? "Move slowly until World AR finds the paper."
        : "Keep the paper in view.";
      return;
    }

    const targetPoint = point || surface.point || { x: 0.5, y: 0.5 };
    const anchor = this.anchorManager.create(targetPoint);
    this.transform = createTransform({
      ...this.transform,
      x: anchor.pose.x,
      y: anchor.pose.y,
      placed: true,
      locked: false,
    });
    this.poseManager.syncFromTransform(this.transform);
    this.statusText.textContent = this.worldTrackingActive ? "Template anchored to world." : "Preview template placed.";
    this.emit();
  }

  nudge(deltaX, deltaY) {
    if (!this.transform.placed || this.transform.locked) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const step = 12;

    this.transform = {
      ...this.transform,
      x: clamp(this.transform.x + (deltaX * step) / rect.width, 0.08, 0.92),
      y: clamp(this.transform.y + (deltaY * step) / rect.height, 0.08, 0.92),
    };
    this.poseManager.syncFromTransform(this.transform);
    this.statusText.textContent = "Calibration adjusted.";
    this.emit();
  }

  rotateBy(degrees) {
    if (!this.transform.placed || this.transform.locked) {
      return;
    }

    this.setRotation(this.transform.rotation + degrees);
  }

  scaleBy(amount) {
    if (!this.transform.placed || this.transform.locked) {
      return;
    }

    this.setScale(this.transform.scale + amount);
  }

  confirmPlacement() {
    if (!this.transform.placed) {
      this.statusText.textContent = "Place a template first.";
      return;
    }

    this.transform = {
      ...this.transform,
      locked: true,
    };
    this.poseManager.syncFromTransform(this.transform);
    this.statusText.textContent = "Calibration confirmed.";
    this.emit();
  }

  handleTrackingEnded() {
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
    this.anchorManager.clear();
    this.pointers.clear();
    this.gesture = null;
    this.updateTrackingClasses({ mode: "fallback" });
    this.statusText.textContent = "WebXR session ended.";
    this.emit();
  }

  reset() {
    this.anchorManager.clear();
    this.transform = createTransform({
      opacity: this.lastEditOpacity,
    });
    this.statusText.textContent = "Point at the paper, then place the template.";
    this.emit();
  }

  setOpacity(opacity) {
    const nextOpacity = clamp(opacity, 0.15, 1);
    this.lastEditOpacity = nextOpacity;
    this.transform = {
      ...this.transform,
      opacity: nextOpacity,
      tracing: false,
    };
    this.poseManager.syncFromTransform(this.transform);
    this.emit();
  }

  setScale(scale) {
    this.transform = {
      ...this.transform,
      scale: clamp(scale, 0.35, 2.2),
    };
    this.poseManager.syncFromTransform(this.transform);
    this.emit();
  }

  setRotation(degrees) {
    this.transform = {
      ...this.transform,
      rotation: normalizeDegrees(degrees),
    };
    this.poseManager.syncFromTransform(this.transform);
    this.emit();
  }

  toggleTracing() {
    if (!this.transform.placed) {
      this.place();

      if (!this.transform.placed) {
        return;
      }
    }

    const tracing = !this.transform.tracing;

    this.transform = {
      ...this.transform,
      tracing,
      opacity: tracing ? 0.3 : this.lastEditOpacity,
      locked: tracing ? true : this.transform.locked,
    };
    this.poseManager.syncFromTransform(this.transform);
    this.statusText.textContent = tracing ? "Tracing mode active." : "Tracing mode off.";
    this.emit();
  }

  toggleLock() {
    if (!this.transform.placed) {
      this.place();

      if (!this.transform.placed) {
        return;
      }
    }

    this.transform = {
      ...this.transform,
      locked: !this.transform.locked,
    };
    this.poseManager.syncFromTransform(this.transform);
    this.statusText.textContent = this.transform.locked ? "Template locked." : "Template unlocked.";
    this.emit();
  }

  handlePointerDown(event) {
    const point = getCanvasPoint(event, this.canvas);
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, point);

    if (!this.transform.placed) {
      this.place(point);
      return;
    }

    if (this.transform.locked || !this.isPointInsideTemplate(point)) {
      return;
    }

    if (this.pointers.size === 1) {
      this.gesture = {
        type: "drag",
        startPoint: point,
        startTransform: { ...this.transform },
      };
    }

    if (this.pointers.size >= 2) {
      this.startPinchGesture();
    }
  }

  handlePointerMove(event) {
    if (!this.pointers.has(event.pointerId)) {
      return;
    }

    this.pointers.set(event.pointerId, getCanvasPoint(event, this.canvas));

    if (this.transform.locked || !this.gesture) {
      return;
    }

    if (this.gesture.type === "drag" && this.pointers.size === 1) {
      const point = this.pointers.get(event.pointerId);
      const deltaX = point.x - this.gesture.startPoint.x;
      const deltaY = point.y - this.gesture.startPoint.y;

      this.transform = {
        ...this.transform,
        x: clamp(this.gesture.startTransform.x + deltaX, 0.08, 0.92),
        y: clamp(this.gesture.startTransform.y + deltaY, 0.08, 0.92),
      };
      this.poseManager.syncFromTransform(this.transform);
      this.emit();
      return;
    }

    if (this.pointers.size >= 2) {
      if (this.gesture.type !== "pinch") {
        this.startPinchGesture();
      }

      const [first, second] = [...this.pointers.values()];
      const currentDistance = distanceBetween(first, second);
      const currentAngle = angleBetween(first, second);
      const currentMidpoint = midpoint(first, second);
      const scaleFactor = currentDistance / this.gesture.startDistance;

      this.transform = {
        ...this.transform,
        x: clamp(this.gesture.startTransform.x + currentMidpoint.x - this.gesture.startMidpoint.x, 0.08, 0.92),
        y: clamp(this.gesture.startTransform.y + currentMidpoint.y - this.gesture.startMidpoint.y, 0.08, 0.92),
        scale: clamp(this.gesture.startTransform.scale * scaleFactor, 0.35, 2.2),
        rotation: normalizeDegrees(
          this.gesture.startTransform.rotation + radiansToDegrees(currentAngle - this.gesture.startAngle),
        ),
      };
      this.poseManager.syncFromTransform(this.transform);
      this.emit();
    }
  }

  handlePointerUp(event) {
    this.pointers.delete(event.pointerId);

    if (this.pointers.size >= 2) {
      this.startPinchGesture();
      return;
    }

    this.gesture = null;
  }

  startPinchGesture() {
    const [first, second] = [...this.pointers.values()];

    if (!first || !second) {
      return;
    }

    this.gesture = {
      type: "pinch",
      startDistance: Math.max(0.001, distanceBetween(first, second)),
      startAngle: angleBetween(first, second),
      startMidpoint: midpoint(first, second),
      startTransform: { ...this.transform },
    };
  }

  renderFrame(time) {
    if (!this.running) {
      return;
    }

    this.resizeCanvas();
    this.tracking.updateFrame(time);
    const surface = this.surfaceDetector.update();
    this.draw(surface);
    this.updateOverlay(surface);
    this.animationFrame = requestAnimationFrame(this.renderFrame);
  }

  resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * pixelRatio));
    const height = Math.max(1, Math.round(rect.height * pixelRatio));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  draw(surface) {
    const { width, height } = this.canvas;
    this.context.clearRect(0, 0, width, height);

    if (!this.cameraActive && !this.worldTrackingActive) {
      this.drawCameraPlaceholder(width, height);
    }

    if (!this.activeImage || !this.transform.placed) {
      if (!this.worldTrackingActive) {
        this.drawSurfaceGuide(surface);
      }
      return;
    }

    this.transform = this.poseManager.applyToTransform(this.transform);

    if (this.worldTrackingActive) {
      return;
    }

    this.drawTemplate();
  }

  drawCameraPlaceholder(width, height) {
    const gradient = this.context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "rgba(79, 209, 191, 0.18)");
    gradient.addColorStop(0.55, "rgba(17, 20, 24, 0.82)");
    gradient.addColorStop(1, "rgba(255, 125, 99, 0.15)");

    this.context.fillStyle = gradient;
    this.context.fillRect(0, 0, width, height);
    this.context.strokeStyle = "rgba(255, 255, 255, 0.12)";
    this.context.lineWidth = 1;

    const gap = 42;
    for (let x = 0; x < width; x += gap) {
      this.context.beginPath();
      this.context.moveTo(x, 0);
      this.context.lineTo(x, height);
      this.context.stroke();
    }

    for (let y = 0; y < height; y += gap) {
      this.context.beginPath();
      this.context.moveTo(0, y);
      this.context.lineTo(width, y);
      this.context.stroke();
    }
  }

  drawSurfaceGuide(surface) {
    const { width, height } = this.canvas;
    const centerX = width / 2;
    const centerY = height / 2;
    const guideWidth = Math.min(width * 0.48, 260);
    const guideHeight = guideWidth * 0.62;

    this.context.save();
    this.context.translate(centerX, centerY);
    this.context.strokeStyle = surface.available ? "rgba(79, 209, 191, 0.92)" : "rgba(241, 200, 91, 0.74)";
    this.context.lineWidth = 3;
    this.context.setLineDash([12, 10]);
    this.context.strokeRect(-guideWidth / 2, -guideHeight / 2, guideWidth, guideHeight);
    this.context.restore();
  }

  drawTemplate() {
    const { width, height } = this.canvas;
    const centerX = this.transform.x * width;
    const centerY = this.transform.y * height;
    const dimensions = getTemplateDimensions(this.canvas, this.activeImage, this.transform);

    this.context.save();
    this.context.translate(centerX, centerY);
    this.context.rotate(degreesToRadians(this.transform.rotation));
    this.context.globalAlpha = this.transform.opacity;
    this.context.shadowColor = "rgba(255, 255, 255, 0.88)";
    this.context.shadowBlur = 2;
    this.context.drawImage(
      this.activeImage,
      -dimensions.width / 2,
      -dimensions.height / 2,
      dimensions.width,
      dimensions.height,
    );
    this.context.shadowBlur = 0;
    this.context.globalAlpha = 1;

    if (!this.transform.locked) {
      this.context.strokeStyle = "rgba(79, 209, 191, 0.95)";
      this.context.lineWidth = 2;
      this.context.setLineDash([10, 8]);
      this.context.strokeRect(-dimensions.width / 2, -dimensions.height / 2, dimensions.width, dimensions.height);
    }

    this.context.restore();
  }

  updateOverlay(surface) {
    const canPlace = !this.transform.placed && surface.available && this.activeImage;
    this.setCanPlace(canPlace);
    this.reticle.classList.toggle("is-ready", Boolean(canPlace));
    this.reticle.classList.toggle("is-hidden", this.transform.placed);
    this.reticleLabel.textContent = canPlace ? "Place" : "Scan";
    this.canvas.classList.toggle("is-locked", this.transform.locked);
    this.canvas.classList.toggle("is-editable", this.transform.placed && !this.transform.locked);

    if (this.transform.placed) {
      return;
    }

    this.statusText.textContent = canPlace ? "Tap the paper to place." : "Point at the paper.";
  }

  updateTrackingClasses(capabilities) {
    const isXR = capabilities.mode === "webxr" && capabilities.active !== false;
    this.worldTrackingActive = isXR;
    this.root?.classList.toggle("is-xr-session", isXR);
    this.canvas.classList.toggle("is-xr-session", isXR);
  }

  setCanPlace(canPlace) {
    if (this.canPlace === canPlace) {
      return;
    }

    this.canPlace = canPlace;
    this.emit();
  }

  isPointInsideTemplate(point) {
    if (!this.activeImage || !this.transform.placed) {
      return false;
    }

    const dimensions = getTemplateDimensions(this.canvas, this.activeImage, this.transform);
    const dx = point.x * this.canvas.width - this.transform.x * this.canvas.width;
    const dy = point.y * this.canvas.height - this.transform.y * this.canvas.height;
    const rotation = -degreesToRadians(this.transform.rotation);
    const localX = dx * Math.cos(rotation) - dy * Math.sin(rotation);
    const localY = dx * Math.sin(rotation) + dy * Math.cos(rotation);

    return Math.abs(localX) <= dimensions.width / 2 && Math.abs(localY) <= dimensions.height / 2;
  }

  emit() {
    const state = {
      transform: { ...this.transform },
      hasTemplate: Boolean(this.activeImage),
      placed: this.transform.placed,
      canPlace: this.canPlace,
      locked: this.transform.locked,
      tracing: this.transform.tracing,
      worldTrackingActive: this.worldTrackingActive,
    };

    this.listeners.forEach((listener) => listener(state));
  }
}
