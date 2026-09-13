import { WebXRTracker } from "./WebXRTracker.js";

const originalStart = WebXRTracker.prototype.start;

WebXRTracker.prototype.start = async function (...args) {
  const result = await originalStart.apply(this, args);
  this.attachDomPlacementBridge();
  return result;
};

WebXRTracker.prototype.attachDomPlacementBridge = function () {
  if (this.domPlacementHandler || !this.overlayRoot) {
    return;
  }

  this.domPlacementHandler = (event) => {
    if (!this.session || !this.onWorldSelect) {
      return;
    }

    if (event.target?.closest?.("button, input, select, textarea, a")) {
      return;
    }

    if (event.pointerType && event.pointerType !== "touch" && event.pointerType !== "pen") {
      return;
    }

    event.preventDefault?.();

    // The XR hit-test loop owns the actual world point. This touch only
    // requests placement; the next valid hit automatically materializes it.
    this.pendingWorldSelect = true;
  };

  this.overlayRoot.addEventListener("pointerup", this.domPlacementHandler, true);
};

const originalCleanup = WebXRTracker.prototype.cleanup;

WebXRTracker.prototype.cleanup = function (...args) {
  if (this.overlayRoot && this.domPlacementHandler) {
    this.overlayRoot.removeEventListener("pointerup", this.domPlacementHandler, true);
  }

  this.domPlacementHandler = null;
  return originalCleanup.apply(this, args);
};
