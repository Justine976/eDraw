const ANALYSIS_WIDTH = 256;
const ANALYSIS_HEIGHT = 192;
const MIN_AREA = 0.06;
const MAX_AREA = 0.82;
const MAX_LOST_FRAMES = 18;

export class PaperTracker {
  constructor(video) {
    this.video = video;
    this.canvas = document.createElement("canvas");
    this.canvas.width = ANALYSIS_WIDTH;
    this.canvas.height = ANALYSIS_HEIGHT;
    this.context = this.canvas.getContext("2d", { willReadFrequently: true });
    this.last = null;
    this.velocity = null;
    this.stable = null;
    this.lostFrames = 0;
    this.lastTimestamp = 0;
  }

  update(timestamp = performance.now()) {
    if (!this.video || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !this.video.videoWidth) {
      return this.result(false, 0, timestamp);
    }

    this.context.drawImage(this.video, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
    const { data } = this.context.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
    const candidate = detectPaper(data);
    const dt = Math.max(1 / 60, Math.min(0.12, (timestamp - this.lastTimestamp) / 1000 || 1 / 60));
    this.lastTimestamp = timestamp;

    if (!candidate) {
      return this.result(false, 0.08, timestamp);
    }

    const prediction = this.predict(dt);
    const match = prediction ? similarity(prediction, candidate) : 1;

    // Reject sudden jumps instead of letting one bad frame move the overlay.
    if (prediction && match < 0.42 && candidate.confidence < 0.72) {
      return this.result(false, Math.max(0.1, candidate.confidence * 0.7), timestamp);
    }

    const responsiveness = prediction ? clamp(0.18 + candidate.confidence * 0.18, 0.18, 0.36) : 0.28;
    const current = smooth(prediction || this.last, candidate, responsiveness);
    this.updateVelocity(current, dt);
    this.last = current;
    this.stable = current;
    this.lostFrames = 0;

    return this.result(true, current.confidence, timestamp, current);
  }

  predict(dt) {
    if (!this.last || !this.velocity) return this.last;

    const predicted = {
      ...this.last,
      x: this.last.x + this.velocity.x * dt,
      y: this.last.y + this.velocity.y * dt,
      width: this.last.width + this.velocity.width * dt,
      height: this.last.height + this.velocity.height * dt,
      corners: this.last.corners.map((point, index) => ({
        x: point.x + this.velocity.corners[index].x * dt,
        y: point.y + this.velocity.corners[index].y * dt,
      })),
    };

    return predicted;
  }

  updateVelocity(current, dt) {
    if (!this.last) {
      this.velocity = zeroVelocity(current);
      return;
    }

    const amount = 0.25;
    const next = {
      x: (current.x - this.last.x) / dt,
      y: (current.y - this.last.y) / dt,
      width: (current.width - this.last.width) / dt,
      height: (current.height - this.last.height) / dt,
      corners: current.corners.map((point, index) => ({
        x: (point.x - this.last.corners[index].x) / dt,
        y: (point.y - this.last.corners[index].y) / dt,
      })),
    };

    this.velocity = this.velocity
      ? blendVelocity(this.velocity, next, amount)
      : next;
  }

  result(available, confidence, timestamp, surface = null) {
    if (!available) {
      this.lostFrames += 1;

      if (this.stable && this.lostFrames <= MAX_LOST_FRAMES) {
        const dt = Math.min(0.1, Math.max(1 / 60, (timestamp - this.lastTimestamp) / 1000));
        const predicted = this.predict(dt);
        const decay = Math.max(0.35, 1 - this.lostFrames / (MAX_LOST_FRAMES * 1.25));
        this.last = predicted || this.last;
        return {
          available: true,
          confidence: this.stable.confidence * decay,
          mode: "camera-tracking",
          tracking: this.lostFrames < 5 ? "recovering" : "predicted",
          point: { x: this.last.x, y: this.last.y },
          surface: this.last,
        };
      }

      return {
        available: false,
        confidence,
        mode: "camera-tracking",
        tracking: "lost",
        surface: null,
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

function detectPaper(data) {
  const mask = new Uint8Array(ANALYSIS_WIDTH * ANALYSIS_HEIGHT);
  let bright = 0;
  let luminanceSum = 0;

  for (let i = 0; i < data.length; i += 4) {
    luminanceSum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }

  const mean = luminanceSum / (ANALYSIS_WIDTH * ANALYSIS_HEIGHT);
  const brightThreshold = clamp(mean + 34, 130, 205);

  for (let y = 1; y < ANALYSIS_HEIGHT - 1; y += 1) {
    for (let x = 1; x < ANALYSIS_WIDTH - 1; x += 1) {
      const i = (y * ANALYSIS_WIDTH + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const neutral = max - min < 72;

      if (luminance > brightThreshold && neutral) {
        mask[y * ANALYSIS_WIDTH + x] = 1;
        bright += 1;
      }
    }
  }

  let component = null;
  if (bright > ANALYSIS_WIDTH * ANALYSIS_HEIGHT * 0.035) {
    component = largestComponent(mask);
  }

  // A bright/neutral region is the preferred path. The geometric checks below
  // intentionally reject walls, faces, and most UI-like regions.
  if (!component) return null;

  const areaRatio = component.area / (ANALYSIS_WIDTH * ANALYSIS_HEIGHT);
  const width = component.maxX - component.minX + 1;
  const height = component.maxY - component.minY + 1;
  const aspect = width / Math.max(1, height);
  const fill = component.area / Math.max(1, width * height);

  if (areaRatio < MIN_AREA || areaRatio > MAX_AREA || aspect < 0.45 || aspect > 2.3 || fill < 0.28) {
    return null;
  }

  const corners = [
    { x: component.minX / ANALYSIS_WIDTH, y: component.minY / ANALYSIS_HEIGHT },
    { x: component.maxX / ANALYSIS_WIDTH, y: component.minY / ANALYSIS_HEIGHT },
    { x: component.maxX / ANALYSIS_WIDTH, y: component.maxY / ANALYSIS_HEIGHT },
    { x: component.minX / ANALYSIS_WIDTH, y: component.maxY / ANALYSIS_HEIGHT },
  ];

  return {
    x: (component.minX + component.maxX) / 2 / ANALYSIS_WIDTH,
    y: (component.minY + component.maxY) / 2 / ANALYSIS_HEIGHT,
    width: width / ANALYSIS_WIDTH,
    height: height / ANALYSIS_HEIGHT,
    aspect,
    corners,
    confidence: Math.min(1, 0.38 + areaRatio * 0.82 + fill * 0.32),
  };
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

function similarity(a, b) {
  const centerDistance = Math.hypot(a.x - b.x, a.y - b.y);
  const sizeDelta = Math.abs(a.width - b.width) + Math.abs(a.height - b.height);
  return clamp(1 - centerDistance * 2.6 - sizeDelta * 1.8, 0, 1);
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

function zeroVelocity(surface) {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    corners: surface.corners.map(() => ({ x: 0, y: 0 })),
  };
}

function blendVelocity(previous, current, amount) {
  return {
    x: lerp(previous.x, current.x, amount),
    y: lerp(previous.y, current.y, amount),
    width: lerp(previous.width, current.width, amount),
    height: lerp(previous.height, current.height, amount),
    corners: current.corners.map((corner, index) => ({
      x: lerp(previous.corners[index].x, corner.x, amount),
      y: lerp(previous.corners[index].y, corner.y, amount),
    })),
  };
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
