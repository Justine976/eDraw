import { PaperTracker } from "../tracking/PaperTracker.js";

export class CameraFallbackTracker {
  constructor() {
    this.video = null;
    this.anchors = new Map();
    this.tracker = null;
    this.started = false;
    this.lastSurface = null;
  }

  init({ video } = {}) {
    this.video = video;
    this.tracker = new PaperTracker(video);
  }

  start() {
    this.started = true;
  }

  stop() {
    this.started = false;
    this.anchors.clear();
  }

  updateFrame() {
    if (!this.started || !this.tracker) return this.detectSurface();
    this.lastSurface = this.tracker.update();
    return this.lastSurface;
  }

  detectSurface() {
    if (this.lastSurface) return this.lastSurface;

    // Manual placement must still work when the lightweight paper detector
    // cannot confidently identify the sheet. The tapped canvas position is
    // the user's explicit placement instruction; tracking can take over once
    // a valid paper candidate is found.
    return {
      available: true,
      confidence: 0.18,
      mode: "camera-tracking",
      tracking: "manual",
      point: { x: 0.5, y: 0.5 },
      surface: {
        x: 0.5,
        y: 0.5,
        width: 0.58,
        height: 0.58 / 1.414,
        aspect: 1.414,
        corners: [
          { x: 0.21, y: 0.295 },
          { x: 0.79, y: 0.295 },
          { x: 0.79, y: 0.705 },
          { x: 0.21, y: 0.705 },
        ],
        confidence: 0.18,
      },
    };
  }

  createAnchor(point) {
    const id = `anchor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const surface = this.lastSurface?.surface;
    const anchor = {
      id,
      pose: {
        x: point?.x ?? surface?.x ?? 0.5,
        y: point?.y ?? surface?.y ?? 0.5,
        rotation: 0,
        scale: 1,
      },
      referenceSurface: surface
        ? { x: surface.x, y: surface.y, width: surface.width, height: surface.height }
        : null,
    };
    this.anchors.set(id, anchor);
    return anchor;
  }

  updateAnchor(id, pose) {
    const anchor = this.anchors.get(id);
    if (!anchor) return;
    anchor.pose = { ...anchor.pose, ...pose };
  }

  getPose(id) {
    const anchor = this.anchors.get(id);
    if (!anchor) return null;

    const surface = this.lastSurface?.surface;
    if (surface && anchor.referenceSurface && this.lastSurface.tracking !== "manual") {
      const dx = surface.x - anchor.referenceSurface.x;
      const dy = surface.y - anchor.referenceSurface.y;
      const sx = surface.width / Math.max(0.001, anchor.referenceSurface.width);
      const sy = surface.height / Math.max(0.001, anchor.referenceSurface.height);
      anchor.pose = {
        ...anchor.pose,
        x: clamp01(anchor.pose.x + dx),
        y: clamp01(anchor.pose.y + dy),
        scale: anchor.pose.scale * ((sx + sy) / 2),
      };
      anchor.referenceSurface = {
        x: surface.x,
        y: surface.y,
        width: surface.width,
        height: surface.height,
      };
    }

    return anchor.pose;
  }

  getCapabilities() {
    return {
      name: "Camera Tracking",
      mode: "fallback",
      needsCamera: true,
      worldAnchors: false,
      active: this.started,
    };
  }
}

function clamp01(value) {
  return Math.min(0.92, Math.max(0.08, value));
}
