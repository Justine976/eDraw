export class PoseManager {
  constructor(anchorManager) {
    this.anchors = anchorManager;
  }

  syncFromTransform(transform) {
    this.anchors.update({
      x: transform.x,
      y: transform.y,
      rotation: transform.rotation,
      scale: transform.scale,
      opacity: transform.opacity,
      locked: transform.locked,
    });
  }

  applyToTransform(transform) {
    const pose = this.anchors.pose;

    if (!pose) {
      return transform;
    }

    return {
      ...transform,
      x: pose.x,
      y: pose.y,
      rotation: pose.rotation,
    };
  }
}
