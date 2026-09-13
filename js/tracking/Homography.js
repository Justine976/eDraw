export function orderCorners(corners) {
  const center = corners.reduce(
    (sum, point) => ({ x: sum.x + point.x / corners.length, y: sum.y + point.y / corners.length }),
    { x: 0, y: 0 },
  );

  return [...corners].sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
}

export function drawImageInQuad(context, image, quad) {
  if (!image || !quad || quad.length !== 4) return;

  const ordered = orderCorners(quad);
  const [topLeft, topRight, bottomRight, bottomLeft] = ordered;
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) return;

  drawTriangle(
    context,
    image,
    { x: 0, y: 0 },
    { x: sourceWidth, y: 0 },
    { x: sourceWidth, y: sourceHeight },
    topLeft,
    topRight,
    bottomRight,
  );
  drawTriangle(
    context,
    image,
    { x: 0, y: 0 },
    { x: sourceWidth, y: sourceHeight },
    { x: 0, y: sourceHeight },
    topLeft,
    bottomRight,
    bottomLeft,
  );
}

function drawTriangle(context, image, s0, s1, s2, d0, d1, d2) {
  const transform = solveAffine(s0, s1, s2, d0, d1, d2);

  context.save();
  context.beginPath();
  context.moveTo(d0.x, d0.y);
  context.lineTo(d1.x, d1.y);
  context.lineTo(d2.x, d2.y);
  context.closePath();
  context.clip();
  context.transform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
  context.drawImage(image, 0, 0, image.naturalWidth || image.width, image.naturalHeight || image.height);
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
