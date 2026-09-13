export function orderCorners(corners) {
  const center = corners.reduce(
    (sum, point) => ({ x: sum.x + point.x / corners.length, y: sum.y + point.y / corners.length }),
    { x: 0, y: 0 },
  );

  return [...corners].sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
}

export function drawImageInQuad(context, image, sourceWidth, sourceHeight, quad) {
  if (!image || !quad || quad.length !== 4) {
    return;
  }

  const ordered = orderCorners(quad);
  const [topLeft, topRight, bottomRight, bottomLeft] = ordered;
  const middle = {
    x: (topLeft.x + topRight.x + bottomRight.x + bottomLeft.x) / 4,
    y: (topLeft.y + topRight.y + bottomRight.y + bottomLeft.y) / 4,
  };

  drawTriangle(context, image, 0, 0, sourceWidth, 0, sourceWidth, sourceHeight, topLeft, topRight, bottomRight);
  drawTriangle(context, image, 0, 0, sourceWidth, sourceHeight, 0, sourceHeight, topLeft, bottomRight, bottomLeft);

  return middle;
}

function drawTriangle(context, image, sx0, sy0, sx1, sy1, sx2, sy2, dx0, dy0, dx1) {
  const transform = solveAffine(
    { x: sx0, y: sy0 },
    { x: sx1, y: sy1 },
    { x: sx2, y: sy2 },
    { x: dx0.x, y: dx0.y },
    { x: dy0.x, y: dy0.y },
    { x: dx1.x, y: dx1.y },
  );

  context.save();
  context.beginPath();
  context.moveTo(dx0.x, dx0.y);
  context.lineTo(dy0.x, dy0.y);
  context.lineTo(dx1.x, dx1.y);
  context.closePath();
  context.clip();
  context.transform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
  context.drawImage(image, 0, 0, image.naturalWidth || sourceFallback(image, true), image.naturalHeight || sourceFallback(image, false));
  context.restore();
}

export function solveAffine(s0, s1, s2, d0, d1, d2) {
  const denominator = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(denominator) < 0.000001) {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }

  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denominator;
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denominator;
  const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / denominator;
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denominator;
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denominator;
  const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / denominator;

  return { a, b, c, d, e, f };
}

function sourceFallback(image, width) {
  return width ? image.width : image.height;
}
