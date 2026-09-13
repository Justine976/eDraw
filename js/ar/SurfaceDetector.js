export class SurfaceDetector {
  constructor(trackingManager) {
    this.tracking = trackingManager;
    this.lastSurface = {
      available: false,
      confidence: 0,
    };
  }

  update() {
    this.lastSurface = this.tracking.detectSurface();
    return this.lastSurface;
  }

  get isReady() {
    return this.lastSurface.available;
  }
}
