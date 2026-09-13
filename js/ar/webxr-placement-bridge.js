import { WebXRTracker } from "./WebXRTracker.js";

const originalStart = WebXRTracker.prototype.start;
const originalCleanup = WebXRTracker.prototype.cleanup;

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

    // Use the native XR hit-test immediately when one already exists.
    // Otherwise queue the request until the next valid hit arrives.
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
