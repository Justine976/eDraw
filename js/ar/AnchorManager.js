export class AnchorManager {
  constructor(trackingManager) {
    this.tracking = trackingManager;
    this.activeAnchorId = null;
  }

  create(point) {
    const anchor = this.tracking.createAnchor(point);
    this.activeAnchorId = anchor.id;
    return anchor;
  }

  clear() {
    this.activeAnchorId = null;
  }

  update(pose) {
    if (this.activeAnchorId) {
      this.tracking.updateAnchor(this.activeAnchorId, pose);
    }
  }

  get pose() {
    if (!this.activeAnchorId) {
      return null;
    }

    return this.tracking.getPose(this.activeAnchorId);
  }
}
