export const DEFAULT_BACK_TEXT = "A little world.\nYours to make.";
export const PAPERS = {
  A5: [148, 210],
  A4: [210, 297],
  A3: [297, 420],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
};
export const mm = (value) => (Number(value) * 72) / 25.4;
export function paperSize(settings) {
  const size =
    settings.paper === "Custom"
      ? [settings.customWidth, settings.customHeight]
      : PAPERS[settings.paper] || PAPERS.A4;
  return settings.orientation === "landscape" ? [size[1], size[0]] : [...size];
}
export function parseRanges(input, count) {
  if (!input.trim() || input.trim().toLowerCase() === "all")
    return Array.from({ length: count }, (_, i) => i + 1);
  const result = [],
    seen = new Set();
  for (const token of input.split(",")) {
    const match = token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match)
      throw new Error("Use page numbers and ranges, such as 1-8, 12, 15-20.");
    const from = Number(match[1]),
      to = Number(match[2] || match[1]);
    if (from < 1 || to < from || to > count)
      throw new Error(
        `Page ranges must be between 1 and ${count}, in ascending order.`,
      );
    for (let n = from; n <= to; n++)
      if (!seen.has(n)) {
        seen.add(n);
        result.push(n);
      }
  }
  return result;
}
export function makeBook(id, title, assetId, pageCount) {
  return {
    id,
    title,
    assetId,
    pageCount,
    width: 25,
    height: 35,
    margin: 1,
    lockAspectRatio: true,
    ranges: "",
    includePages: true,
    rowGap: 3,
    columnGap: 2,
    border: false,
    marks: "corners",
    markCorner: "all",
    markPages: "all",
    markRanges: "",
    cover: {
      enabled: true,
      mode: "generated",
      spine: 3,
      overhang: 0.5,
      color: "#354c45",
      ink: "#f7edd6",
      gradient: true,
      subtitle: "A BOOKCHE EDITION",
      backText: DEFAULT_BACK_TEXT,
      front: { type: "generated" },
      back: { type: "generated" },
      spineSource: { type: "generated" },
      wrap: { type: "generated" },
    },
  };
}
export function defaultSettings() {
  return {
    paper: "A4",
    orientation: "portrait",
    customWidth: 210,
    customHeight: 297,
    sheetMargin: 10,
    mode: "single",
    flip: "long",
    backOffsetX: 0,
    backOffsetY: 0,
    registration: false,
    output: "all",
  };
}
export function computeLayout(books, settings) {
  const [width, height] = paperSize(settings),
    margin = Number(settings.sheetMargin);
  const duplex = settings.mode === "duplex";
  const longAxisX = height >= width;
  const mirrorX = settings.flip === "long" ? longAxisX : !longAxisX;
  const sheets = [],
    warnings = [],
    errors = [];
  if (
    !(
      width > 0 &&
      height > 0 &&
      margin >= 0 &&
      width > margin * 2 &&
      height > margin * 2
    )
  )
    return {
      width,
      height,
      sheets,
      faces: [],
      warnings,
      errors: ["The sheet margin leaves no printable area."],
    };
  if (settings.registration && margin < 7)
    warnings.push(
      "Registration crosses may overlap pieces when the safe sheet margin is below 7 mm.",
    );
  let sheet,
    x = margin,
    y = margin,
    rowHeight = 0,
    rowGap = 0;
  const newSheet = () => {
    sheet = { index: sheets.length, front: [], back: [] };
    sheets.push(sheet);
    x = margin;
    y = margin;
    rowHeight = 0;
    rowGap = 0;
  };
  const nextRow = () => {
    if (rowHeight) y += rowHeight + rowGap;
    x = margin;
    rowHeight = 0;
    rowGap = 0;
  };
  const place = (piece, back, gap, verticalGap) => {
    if (
      piece.width > width - margin * 2 + 0.001 ||
      piece.height > height - margin * 2 + 0.001
    ) {
      errors.push(
        `${piece.title}: ${piece.kind === "cover" ? "the cover" : "a page"} is too large for the printable area. Choose a larger sheet or reduce its size.`,
      );
      return;
    }
    if (!sheet) newSheet();
    if (x + piece.width > width - margin + 0.001) nextRow();
    if (y + piece.height > height - margin + 0.001) newSheet();
    const front = { ...piece, x, y };
    sheet.front.push(front);
    if (duplex && back) {
      const bx =
        (mirrorX ? width - x - piece.width : x) + Number(settings.backOffsetX);
      const by =
        (mirrorX ? y : height - y - piece.height) +
        Number(settings.backOffsetY);
      sheet.back.push({
        ...back,
        rotation: mirrorX ? 0 : 180,
        x: bx,
        y: by,
        width: piece.width,
        height: piece.height,
      });
      if (
        bx < 0 ||
        by < 0 ||
        bx + piece.width > width ||
        by + piece.height > height
      )
        warnings.push("The back-side offset moves some content off the paper.");
    }
    x += piece.width + gap;
    rowHeight = Math.max(rowHeight, piece.height);
    rowGap = Math.max(rowGap, verticalGap);
  };
  for (const book of books) {
    if (book.hidden) continue;
    if (
      !(
        book.width > 0 &&
        book.height > 0 &&
        book.margin >= 0 &&
        book.margin * 2 < Math.min(book.width, book.height)
      )
    ) {
      errors.push(
        `${book.title}: the content margin must be less than half the page size.`,
      );
      continue;
    }
    nextRow();
    if (book.cover.enabled) {
      const cw = book.width + book.cover.overhang * 2,
        ch = book.height + book.cover.overhang * 2;
      place(
        {
          kind: "cover",
          bookId: book.id,
          title: book.title,
          width: cw * 2 + book.cover.spine,
          height: ch,
        },
        null,
        3,
        book.rowGap,
      );
      nextRow();
    }
    if (book.marks !== "none" && book.markPages === "custom") {
      try {
        parseRanges(book.markRanges, book.pageCount);
      } catch (error) {
        errors.push(`${book.title} cut marks: ${error.message}`);
      }
    }
    if (!book.includePages) continue;
    let pages;
    try {
      pages = parseRanges(book.ranges, book.pageCount);
    } catch (error) {
      errors.push(`${book.title}: ${error.message}`);
      continue;
    }
    const base = {
      kind: "page",
      bookId: book.id,
      title: book.title,
      width: book.width,
      height: book.height,
    };
    for (let i = 0; i < pages.length; i += duplex ? 2 : 1) {
      place(
        { ...base, page: pages[i] },
        duplex && pages[i + 1] ? { ...base, page: pages[i + 1] } : null,
        duplex ? book.columnGap : 0,
        book.rowGap,
      );
    }
    if (duplex && pages.length % 2)
      warnings.push(`${book.title}: the last leaf has a blank back.`);
  }
  const faces = sheets.flatMap((s) =>
    duplex
      ? [
          { sheet: s.index, side: "front", pieces: s.front },
          { sheet: s.index, side: "back", pieces: s.back },
        ]
      : [{ sheet: s.index, side: "front", pieces: s.front }],
  );
  return {
    width,
    height,
    sheets,
    faces,
    warnings: [...new Set(warnings)],
    errors: [...new Set(errors)],
  };
}
export function outputFaces(layout, settings) {
  return layout.faces.filter(
    (f) =>
      settings.mode !== "duplex" ||
      settings.output === "all" ||
      f.side === settings.output,
  );
}
