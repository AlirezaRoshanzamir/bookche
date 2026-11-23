import { parseRanges } from "./layout.js";

export function fitInside(sourceWidth, sourceHeight, width, height) {
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  return {
    scale,
    width: sourceWidth * scale,
    height: sourceHeight * scale,
    x: (width - sourceWidth * scale) / 2,
    y: (height - sourceHeight * scale) / 2,
  };
}

export function fitArtwork(
  sourceWidth,
  sourceHeight,
  width,
  height,
  stretch = false,
) {
  return stretch
    ? { x: 0, y: 0, width, height }
    : fitInside(sourceWidth, sourceHeight, width, height);
}

export function hasArtwork(source) {
  return (
    !!source &&
    (source.type === "book" || (source.type === "asset" && !!source.assetId))
  );
}

export function coverPanels(book) {
  const width = book.width + book.cover.overhang * 2,
    spine = book.cover.spine;
  return [
    { role: "back", x: 0, width, source: book.cover.back },
    ...(spine > 0
      ? [
          {
            role: "spine",
            x: width,
            width: spine,
            source: book.cover.spineSource,
          },
        ]
      : []),
    { role: "front", x: width + spine, width, source: book.cover.front },
  ];
}

// All coordinates are millimeters, measured from the piece's top left.
// The canvas preview and vector PDF use these same cutting guides.
export function cutGuides(piece, book) {
  const w = piece.width,
    h = piece.height,
    shapes = [];
  const line = (x1, y1, x2, y2, stroke = "#333333") =>
    shapes.push({ type: "line", x1, y1, x2, y2, stroke, lineWidth: 0.06 });
  if (piece.kind === "cover" && book.marks !== "none") {
    const panel = book.width + book.cover.overhang * 2;
    for (const x of [panel, panel + book.cover.spine]) {
      line(x, 0, x, 0.8, "#808080");
      line(x, h, x, h - 0.8, "#808080");
    }
  }
  if (book.border)
    shapes.push({
      type: "outline",
      x: 0,
      y: 0,
      width: w,
      height: h,
      stroke: "#595959",
      lineWidth: 0.06,
    });
  if (book.marks === "none") return shapes;
  const marked =
    piece.kind === "cover" ||
    book.markPages === "all" ||
    (book.markPages === "first" && piece.page === 1) ||
    (book.markPages === "odd" && piece.page % 2 === 1) ||
    (book.markPages === "even" && piece.page % 2 === 0) ||
    (book.markPages === "custom" &&
      parseRanges(book.markRanges, book.pageCount).includes(piece.page));
  if (!marked) return shapes;
  for (const [corner, x, y, sx, sy] of [
    ["tl", 0.12, 0.12, 1, 1],
    ["tr", w - 0.12, 0.12, -1, 1],
    ["bl", 0.12, h - 0.12, 1, -1],
    ["br", w - 0.12, h - 0.12, -1, -1],
  ]) {
    const selected =
      piece.rotation === 180
        ? { tl: "br", tr: "bl", bl: "tr", br: "tl" }[corner]
        : corner;
    if (book.markCorner !== "all" && book.markCorner !== selected) continue;
    if (book.marks === "square")
      shapes.push({
        type: "fill",
        x: x + (sx < 0 ? -0.325 : 0),
        y: y + (sy < 0 ? -0.325 : 0),
        width: 0.325,
        height: 0.325,
        fill: "#333333",
      });
    else {
      line(x, y, x + sx * 0.65, y);
      line(x, y, x, y + sy * 0.65);
    }
  }
  return shapes;
}

export function registrationGuides(width, height) {
  return [
    [5, 5],
    [width - 5, 5],
    [5, height - 5],
    [width - 5, height - 5],
  ].flatMap(([x, y]) => [
    {
      type: "line",
      x1: x - 1,
      y1: y,
      x2: x + 1,
      y2: y,
      lineWidth: (0.2 * 25.4) / 72,
      stroke: "#808080",
    },
    {
      type: "line",
      x1: x,
      y1: y - 1,
      x2: x,
      y2: y + 1,
      lineWidth: (0.2 * 25.4) / 72,
      stroke: "#808080",
    },
  ]);
}

// Round shared boundaries together so adjacent images use the same pixel edge.
export function pixelBox(x, y, width, height, scale) {
  const left = Math.round(x * scale),
    top = Math.round(y * scale);
  return {
    x: left,
    y: top,
    width: Math.round((x + width) * scale) - left,
    height: Math.round((y + height) * scale) - top,
  };
}

export const GRID_DOT_RADIUS = 0.1;
export const GRID_DOT_COLOR = "#d0d0d0";
export function cuttingGridPoints(width, height, face, settings, frontPieces) {
  if (settings.cuttingGrid === false) return [];
  const step = Math.max(2, Math.min(20, Number(settings.gridSpacing) || 5));
  const back = settings.mode === "duplex" && face.side === "back";
  const mirrorX = settings.flip === "long" ? height >= width : height < width;
  const axis = (extent, mirror, offset) => {
    const values = [];
    for (let n = step; n < extent; n += step) {
      const value = (mirror ? extent - n : n) + offset;
      if (value > GRID_DOT_RADIUS && value < extent - GRID_DOT_RADIUS)
        values.push(value);
    }
    return values.sort((a, b) => a - b);
  };
  const xs = axis(
    width,
    back && mirrorX,
    back ? Number(settings.backOffsetX) || 0 : 0,
  );
  const ys = axis(
    height,
    back && !mirrorX,
    back ? Number(settings.backOffsetY) || 0 : 0,
  );
  const masks =
    back && frontPieces
      ? frontPieces.map((p) => ({
          ...p,
          x:
            (mirrorX ? width - p.x - p.width : p.x) +
            (Number(settings.backOffsetX) || 0),
          y:
            (mirrorX ? p.y : height - p.y - p.height) +
            (Number(settings.backOffsetY) || 0),
        }))
      : face.pieces;
  const points = [],
    r = GRID_DOT_RADIUS;
  for (const y of ys) {
    const intervals = masks
      .filter((p) => y >= p.y - r && y <= p.y + p.height + r)
      .map((p) => [p.x - r, p.x + p.width + r])
      .sort((a, b) => a[0] - b[0]);
    let i = 0;
    for (const x of xs) {
      while (i < intervals.length && intervals[i][1] < x) i++;
      if (i === intervals.length || x < intervals[i][0]) points.push({ x, y });
    }
  }
  return points;
}
