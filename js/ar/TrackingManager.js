import { CameraFallbackTracker } from "./CameraFallbackTracker.js";
import { WebXRTracker } from "./WebXRTracker.js";

export class TrackingManager {
  constructor() {
    this.context = {};
    this.backend = new CameraFallbackTracker();
    this.webXRAvailable = WebXRTracker.canAttempt();
    this.fallbackReason = "";
    this.templateImage = null;
  }

  init(context = {}) {
    this.context = context;
    this.webXRAvailable = WebXRTracker.canAttempt();
    this.backend = this.webXRAvailable && !context.forceFallback ? new WebXRTracker() : new CameraFallbackTracker();
    this.backend.init(context);
    this.backend.setTemplateImage?.(this.templateImage);
    return this.getCapabilities();
  }

  async start({ allowFallback = true } = {}) {
    if (!allowFallback && this.backend instanceof CameraFallbackTracker) {
      throw new Error("World AR requires a WebXR AR-capable browser on a secure origin. Use Android Chrome with ARCore, or open Preview for non-anchored testing.");
    }

    try {
      await this.backend.start();
    } catch (error) {
      if (!allowFallback || !this.webXRAvailable) {
        throw error;
      }

      this.fallbackReason = error.message;
      this.backend = new CameraFallbackTracker();
      this.backend.init(this.context);
      this.backend.setTemplateImage?.(this.templateImage);
      this.backend.start();
    }

    return this.getCapabilities();
  }

  setTemplateImage(image) {
    this.templateImage = image;
    this.backend.setTemplateImage?.(image);
  }

  queuePlacement() {
    return Boolean(this.backend.queuePlacement?.());
  }

  stop() {
    this.backend.stop();
  }

  updateFrame(time) {
    return this.backend.updateFrame(time);
  }

  detectSurface() {
    return this.backend.detectSurface();
  }

  createAnchor(point) {
    return this.backend.createAnchor(point);
  }

  updateAnchor(id, pose) {
    this.backend.updateAnchor(id, pose);
  }

  getPose(id) {
    return this.backend.getPose(id);
  }

  getCapabilities() {
    return {
      ...this.backend.getCapabilities(),
      webXRAvailable: this.webXRAvailable,
      fallbackReason: this.fallbackReason,
    };
  }

  async getWorldReadiness() {
    return WebXRTracker.getReadiness();
  }
}
