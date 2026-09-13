const ANALYSIS_WIDTH = 192;
const ANALYSIS_HEIGHT = 144;

export class PaperTracker {
  constructor(video) {
    this.video = video;
    this.canvas = document.createElement("canvas");
    this.canvas.width = ANALYSIS_WIDTH;
    this.canvas.height = ANALYSIS_HEIGHT;
    this.context = this.canvas.getContext("2d", { willReadFrequently: true });
    this.last = null;
    this.stable = null;
    this.lostFrames = 0;
  }

  update() {
    if (!this.video || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !this.video.videoWidth) {
      return this.result(false, 0);
    }

    this.context.drawImage(this.video, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
    const { data } = this.context.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);

    const mask = new Uint8Array(ANALYSIS_WIDTH * ANALYSIS_HEIGHT);
    let bright = 0;

    for (let y = 1; y < ANALYSIS_HEIGHT - 1; y += 1) {
      for (let x = 1; x < ANALYSIS_WIDTH - 1; x += 1) {
        const i = (y * ANALYSIS_WIDTH + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        // Paper is normally bright and close to neutral. This intentionally
        // avoids requiring a printed marker or a particular paper color.
        if (luminance > 165 && max - min < 48) {
          mask[y * ANALYSIS_WIDTH + x] = 1;
          bright += 1;
        }
      }
    }

    if (bright < ANALYSIS_WIDTH * ANALYSIS_HEIGHT * 0.05) {
      return this.result(false, 0.05);
    }

    const component = largestComponent(mask);
    if (!component) {
      return this.result(false, 0.08);
    }

    const areaRatio = component.area / (ANALYSIS_WIDTH * ANALYSIS_HEIGHT);
    const width = component.maxX - component.minX + 1;
    const height = component.maxY - component.minY + 1;
    const aspect = width / height;
    const fill = component.area / Math.max(1, width * height);

    if (areaRatio < 0.08 || areaRatio > 0.78 || aspect < 0.45 || aspect > 2.2 || fill < 0.35) {
      return this.result(false, 0.12);
    }

    const current = {
      x: (component.minX + component.maxX) / 2 / ANALYSIS_WIDTH,
      y: (component.minY + component.maxY) / 2 / ANALYSIS_HEIGHT,
      width: width / ANALYSIS_WIDTH,
      height: height / ANALYSIS_HEIGHT,
      aspect,
      corners: [
        { x: component.minX / ANALYSIS_WIDTH, y: component.minY / ANALYSIS_HEIGHT },
        { x: component.maxX / ANALYSIS_WIDTH, y: component.minY / ANALYSIS_HEIGHT },
        { x: component.maxX / ANALYSIS_WIDTH, y: component.maxY / ANALYSIS_HEIGHT },
        { x: component.minX / ANALYSIS_WIDTH, y: component.maxY / ANALYSIS_HEIGHT },
      ],
      confidence: Math.min(1, 0.35 + areaRatio * 0.9 + fill * 0.35),
    };

    this.last = smooth(this.last, current, 0.32);
    this.stable = this.last;
    this.lostFrames = 0;
    return this.result(true, this.last.confidence, this.last);
  }

  result(available, confidence, surface = null) {
    if (!available) {
      this.lostFrames += 1;
      return {
        available: false,
        confidence,
        mode: "camera-tracking",
        tracking: "lost",
        surface: this.lostFrames < 8 ? this.stable : null,
      };
    }

    return {
      available: true,
      confidence,
      mode: "camera-tracking",
      tracking: "tracked",
      point: { x: surface.x, y: surface.y },
      surface,
    };
  }
}

function largestComponent(mask) {
  const visited = new Uint8Array(mask.length);
  let best = null;

  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index] || visited[index]) continue;

    const queue = [index];
    visited[index] = 1;
    let area = 0;
    let minX = ANALYSIS_WIDTH;
    let minY = ANALYSIS_HEIGHT;
    let maxX = 0;
    let maxY = 0;

    for (let q = 0; q < queue.length; q += 1) {
      const current = queue[q];
      const x = current % ANALYSIS_WIDTH;
      const y = Math.floor(current / ANALYSIS_WIDTH);
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighbors = [current - 1, current + 1, current - ANALYSIS_WIDTH, current + ANALYSIS_WIDTH];
      for (const next of neighbors) {
        if (next >= 0 && next < mask.length && mask[next] && !visited[next]) {
          visited[next] = 1;
          queue.push(next);
        }
      }
    }

    if (!best || area > best.area) {
      best = { area, minX, minY, maxX, maxY };
    }
  }

  return best;
}

function smooth(previous, current, amount) {
  if (!previous) return current;
  return {
    ...current,
    x: lerp(previous.x, current.x, amount),
    y: lerp(previous.y, current.y, amount),
    width: lerp(previous.width, current.width, amount),
    height: lerp(previous.height, current.height, amount),
    confidence: lerp(previous.confidence, current.confidence, amount),
    corners: current.corners.map((corner, index) => ({
      x: lerp(previous.corners[index].x, corner.x, amount),
      y: lerp(previous.corners[index].y, corner.y, amount),
    })),
  };
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}
