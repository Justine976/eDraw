import { WebXRTracker } from "./WebXRTracker.js";
import { ARManager } from "./ARManager.js";

// WebXR placement should work against any hit-testable real-world surface.
// Do not constrain the hit-test request to detected planes only; some mobile
// WebXR implementations expose useful hit results without accepting the
// entityTypes filter consistently.
WebXRTracker.prototype.requestHitTestSource = async function () {
  return this.session.requestHitTestSource({
    space: this.viewerSpace,
  });
};

const originalStart = WebXRTracker.prototype.start;
const originalCleanup = WebXRTracker.prototype.cleanup;
const originalPlace = ARManager.prototype.place;

WebXRTracker.prototype.start = async function (...args) {
  const result = await originalStart.apply(this, args);
  this.attachDomPlacementBridge();
  return result;
};

WebXRTracker.prototype.attachDomPlacementBridge = function () {
  if (this.domPlacementHandler || !this.overlayRoot) {
    return;
  }

  this.lastDomPlacementAt = 0;

  const requestPlacementFromDom = (event) => {
    if (!this.session || !this.onWorldSelect) {
      return;
    }

    const target = event.target;

    if (target?.closest?.("button, input, select, textarea, a, [data-no-xr-placement]")) {
      return;
    }

    const now = performance.now();
    if (now - this.lastDomPlacementAt < 350) {
      return;
    }

    this.lastDomPlacementAt = now;
    event.preventDefault?.();
    this.queuePlacement();
  };

  this.domPlacementHandler = requestPlacementFromDom;
  this.overlayRoot.addEventListener("pointerup", this.domPlacementHandler, true);
  this.overlayRoot.addEventListener("touchend", this.domPlacementHandler, {
    capture: true,
    passive: false,
  });
};

WebXRTracker.prototype.cleanup = function (...args) {
  if (this.overlayRoot && this.domPlacementHandler) {
    this.overlayRoot.removeEventListener("pointerup", this.domPlacementHandler, true);
    this.overlayRoot.removeEventListener("touchend", this.domPlacementHandler, true);
  }

  this.domPlacementHandler = null;
  this.lastDomPlacementAt = 0;
  return originalCleanup.apply(this, args);
};

// In World AR, a Place action should arm XR placement first. When XR already
// has a hit result, the normal callback path immediately creates the anchor.
const originalWorldPlace = originalPlace;
ARManager.prototype.place = function (point) {
  if (this.worldTrackingActive && !point) {
    if (this.tracking.queuePlacement()) {
      this.statusText.textContent = "Tap a surface to place the template.";
      return;
    }
  }

  originalWorldPlace.call(this, point);
};
