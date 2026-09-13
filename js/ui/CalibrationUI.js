export class CalibrationUI {
  static cameraStarted(label) {
    return label ? `Using ${label}.` : "Camera started.";
  }

  static cameraFallback() {
    return "Camera unavailable. Preview workspace active.";
  }

  static webXRStarted() {
    return "Move your phone to scan the paper.";
  }

  static webXRFallback() {
    return "World AR unavailable. Starting preview mode.";
  }

  static templateSelected(name) {
    return `${name} selected.`;
  }
}
