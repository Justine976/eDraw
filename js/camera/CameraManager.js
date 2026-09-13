export class CameraManager {
  constructor(videoElement) {
    this.video = videoElement;
    this.stream = null;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access is not available in this browser.");
    }

    this.stop();

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
    } catch (error) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: true,
      });
    }

    this.video.srcObject = this.stream;
    this.video.classList.remove("is-unavailable");
    await this.video.play();

    return {
      stream: this.stream,
      label: this.getActiveTrackLabel(),
    };
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
    }

    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
  }

  get isActive() {
    return Boolean(this.stream?.active);
  }

  getActiveTrackLabel() {
    return this.stream?.getVideoTracks()[0]?.label || "Camera";
  }
}
