export class CameraFallbackTracker {
  constructor() {
    this.startedAt = 0;
    this.video = null;
    this.anchors = new Map();
  }

  async init({ video } = {}) {
    this.video = video;
  }

  start() {
    this.startedAt = performance.now();
  }

  stop() {
    this.anchors.clear();
  }

  updateFrame() {
    return this.detectSurface();
  }

  detectSurface() {
    const elapsed = performance.now() - this.startedAt;
    const hasVideo = this.video?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    const confidence = Math.min(1, elapsed / 1300);

    return {
      available: hasVideo ? confidence > 0.62 : confidence > 0.35,
      confidence,
      mode: "fallback",
    };
  }

  createAnchor(point) {
    const id = `anchor-${Date.now()}`;
    const anchor = {
      id,
      pose: {
        x: point.x,
        y: point.y,
        rotation: 0,
      },
    };

    this.anchors.set(id, anchor);
    return anchor;
  }

  updateAnchor(id, pose) {
    const anchor = this.anchors.get(id);

    if (!anchor) {
      return;
    }

    anchor.pose = { ...anchor.pose, ...pose };
  }

  getPose(id) {
    return this.anchors.get(id)?.pose || null;
  }

  getCapabilities() {
    return {
      name: "Preview mode",
      mode: "fallback",
      needsCamera: true,
      worldAnchors: false,
      active: true,
    };
  }
}
