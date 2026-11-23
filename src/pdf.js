import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { mm, outputFaces } from "./layout.js";
import { makeCoverLettering } from "./cover.js";
import {
  fitInside,
  coverPanels,
  hasArtwork,
  cutGuides,
  registrationGuides,
} from "./render-geometry.js";
import { displayedPageSize } from "./sizing.js";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export async function inspectPdfDetails(bytes) {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  if (!document.getPageCount()) throw new Error("This PDF has no pages.");
  const pageSizes = document.getPages().map((page) => {
    const crop = page.getCropBox();
    return displayedPageSize(
      (crop.width * 25.4) / 72,
      (crop.height * 25.4) / 72,
      page.getRotation().angle,
    );
  });
  return { pageCount: document.getPageCount(), pageSizes };
}
export async function inspectPdf(bytes) {
  return (await inspectPdfDetails(bytes)).pageCount;
}
const color = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
function wrapText(text, max = 18) {
  const words = text.split(/\s+/),
    lines = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > max && line) {
      lines.push(line);
      line = "";
    }
    line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 5);
}
export async function createDemoAsset() {
  const doc = await PDFDocument.create();
  const serif = await doc.embedFont(StandardFonts.TimesRoman),
    italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const titles = [
    "The art of noticing",
    "A window left open",
    "The first cup",
    "After the rain",
    "Between the pages",
    "A quieter kind of day",
    "The long way home",
    "Things that grow slowly",
    "An ordinary afternoon",
    "Room for a little wonder",
    "The blue hour",
    "Small beginnings",
  ];
  for (let i = 0; i < titles.length; i++) {
    const page = doc.addPage([250, 350]);
    page.drawText("QUIET THINGS", {
      x: 38,
      y: 307,
      size: 8,
      font: serif,
      color: rgb(0.3, 0.38, 0.32),
    });
    let y = 265;
    for (const line of wrapText(titles[i], 23)) {
      page.drawText(line, { x: 38, y, size: 19, font: italic });
      y -= 24;
    }
    y -= 22;
    const prose =
      "There is a whole world in the smallest things. A leaf turning toward the light. The soft sound of a page. A moment with nowhere else to be. Keep a little space for these things. Let the day unfold at its own pace. Sometimes a small beginning is all you need.";
    for (const line of wrapText(prose, 32).length
      ? prose.match(/.{1,31}(?:\s|$)/g) || []
      : []) {
      page.drawText(line.trim(), {
        x: 38,
        y,
        size: 10.2,
        font: serif,
        lineHeight: 15,
      });
      y -= 15;
    }
    page.drawText(String(i + 1), { x: 122, y: 23, size: 9, font: serif });
  }
  return {
    id: crypto.randomUUID(),
    name: "Quiet things - sample.pdf",
    mime: "application/pdf",
    bytes: await doc.save(),
    pageCount: 12,
    pageSizes: Array.from({ length: 12 }, () => ({
      width: (250 * 25.4) / 72,
      height: (350 * 25.4) / 72,
    })),
  };
}
async function generatedText(
  doc,
  text,
  width,
  height,
  ink,
  role,
  subtitle = "",
) {
  const canvas = makeCoverLettering(text, width, height, ink, role, subtitle);
  return doc.embedPng(
    await (await fetch(canvas.toDataURL("image/png"))).arrayBuffer(),
  );
}
export async function buildPdf(
  books,
  assets,
  settings,
  layout,
  onProgress = () => {},
) {
  if (layout.errors.length) throw new Error(layout.errors[0]);
  const faces = outputFaces(layout, settings);
  if (!faces.length)
    throw new Error(
      "Add a book or enable pages or covers to create a print sheet.",
    );
  const doc = await PDFDocument.create();
  doc.setTitle("Bookche - miniature book print sheets");
  doc.setCreator("Bookche");
  const loaded = new Map(),
    embedded = new Map(),
    textImages = new Map();
  const bookMap = new Map(books.map((b) => [b.id, b]));
  async function source(source, book, page, x, y, w, h, extraRotation = 0) {
    if (
      !source ||
      source.type === "generated" ||
      (source.type === "asset" && !source.assetId)
    )
      return false;
    const id = source.type === "book" ? book.assetId : source.assetId;
    const asset = assets[id];
    if (!asset)
      throw new Error(
        `Missing cover file for ${book.title}. Choose the file again.`,
      );
    if (asset.mime === "application/pdf") {
      if (!loaded.has(id)) loaded.set(id, await PDFDocument.load(asset.bytes));
      const input = loaded.get(id),
        index = Number(source.page || 1) - 1;
      if (index < 0 || index >= input.getPageCount())
        throw new Error(
          `${book.title}: a cover page is outside the PDF's page range.`,
        );
      const key = `${id}:${index}`;
      if (!embedded.has(key))
        embedded.set(
          key,
          await doc.embedPage(
            input.getPage(index),
            (() => {
              const c = input.getPage(index).getCropBox();
              return {
                left: c.x,
                bottom: c.y,
                right: c.x + c.width,
                top: c.y + c.height,
              };
            })(),
          ),
        );
      const image = embedded.get(key),
        rotation =
          (((input.getPage(index).getRotation().angle + extraRotation) % 360) +
            360) %
          360;
      const sw = rotation % 180 ? image.height : image.width,
        sh = rotation % 180 ? image.width : image.height;
      const fit = fitInside(sw, sh, w, h),
        scale = fit.scale,
        dw = image.width * scale,
        dh = image.height * scale;
      let dx = x + fit.x,
        dy = y + fit.y;
      if (rotation === 90) dy += dw;
      else if (rotation === 180) {
        dx += dw;
        dy += dh;
      } else if (rotation === 270) dx += dh;
      page.drawPage(image, {
        x: dx,
        y: dy,
        width: dw,
        height: dh,
        rotate: degrees(-rotation),
      });
    } else {
      if (!embedded.has(id))
        embedded.set(
          id,
          asset.mime === "image/png"
            ? await doc.embedPng(asset.bytes)
            : await doc.embedJpg(asset.bytes),
        );
      const image = embedded.get(id),
        fit = fitInside(image.width, image.height, w, h),
        scale = fit.scale;
      page.drawImage(image, {
        x: x + fit.x,
        y: y + fit.y,
        width: image.width * scale,
        height: image.height * scale,
      });
    }
    return true;
  }
  async function coverPanel(page, book, role, x, y, w, h, input) {
    if (await source(input, book, page, x, y, w, h)) return;
    const c = book.cover;
    page.drawRectangle({ x, y, width: w, height: h, color: color(c.color) });
    if (c.gradient)
      for (let i = 0; i < 24; i++)
        page.drawRectangle({
          x,
          y: y + (h * i) / 24,
          width: w,
          height: h / 24 + 0.1,
          color: rgb(0, 0, 0),
          opacity: 0.12 * (1 - i / 24),
        });
    if (role !== "spine") {
      page.drawRectangle({
        x: x + w * 0.1,
        y: y + h * 0.08,
        width: w * 0.8,
        height: h * 0.84,
        borderColor: color(c.ink),
        borderWidth: 0.35,
        opacity: 0.65,
      });
      if (role === "front") {
        page.drawLine({
          start: { x: x + w * 0.4, y: y + h * 0.23 },
          end: { x: x + w * 0.6, y: y + h * 0.23 },
          color: color(c.ink),
          thickness: 0.5,
        });
      }
    }
    const key = `${book.id}:${role}`;
    if (!textImages.has(key))
      textImages.set(
        key,
        await generatedText(
          doc,
          book.title,
          w / mm(1),
          h / mm(1),
          c.ink,
          role,
          c.subtitle,
        ),
      );
    page.drawImage(textImages.get(key), { x, y, width: w, height: h });
  }
  function drawGuide(page, shape, x = 0, yTop = mm(layout.height)) {
    if (shape.type === "line")
      page.drawLine({
        start: { x: x + mm(shape.x1), y: yTop - mm(shape.y1) },
        end: { x: x + mm(shape.x2), y: yTop - mm(shape.y2) },
        thickness: mm(shape.lineWidth),
        color: color(shape.stroke),
      });
    else
      page.drawRectangle({
        x: x + mm(shape.x),
        y: yTop - mm(shape.y + shape.height),
        width: mm(shape.width),
        height: mm(shape.height),
        ...(shape.type === "fill"
          ? { color: color(shape.fill) }
          : {
              borderColor: color(shape.stroke),
              borderWidth: mm(shape.lineWidth),
            }),
      });
  }
  for (let i = 0; i < faces.length; i++) {
    const face = faces[i],
      page = doc.addPage([mm(layout.width), mm(layout.height)]);
    for (const piece of face.pieces) {
      const book = bookMap.get(piece.bookId),
        x = mm(piece.x),
        y = mm(layout.height - piece.y - piece.height),
        w = mm(piece.width),
        h = mm(piece.height);
      if (piece.kind === "page") {
        const m = mm(book.margin);
        await source(
          { type: "book", page: piece.page },
          book,
          page,
          x + m,
          y + m,
          w - 2 * m,
          h - 2 * m,
          piece.rotation || 0,
        );
      } else {
        const c = book.cover;
        if (c.mode === "wrap" && hasArtwork(c.wrap))
          await source(c.wrap, book, page, x, y, w, h);
        else
          for (const panel of coverPanels(book)) {
            await coverPanel(
              page,
              book,
              panel.role,
              x + mm(panel.x),
              y,
              mm(panel.width),
              h,
              c.mode === "separate" ? panel.source : null,
            );
          }
      }
      for (const shape of cutGuides(piece, book))
        drawGuide(page, shape, x, y + h);
    }
    if (settings.registration)
      for (const shape of registrationGuides(layout.width, layout.height))
        drawGuide(page, shape);
    onProgress(i + 1, faces.length);
  }
  return doc.save();
}
export async function calibrationPdf(settings, width, height) {
  const doc = await PDFDocument.create(),
    font = await doc.embedFont(StandardFonts.Helvetica);
  for (const side of settings.mode === "duplex"
    ? ["FRONT", "BACK"]
    : ["FRONT"]) {
    const page = doc.addPage([mm(width), mm(height)]),
      shiftX = side === "BACK" ? Number(settings.backOffsetX) : 0,
      shiftY = side === "BACK" ? -Number(settings.backOffsetY) : 0;
    const x = mm(width / 2 - 10 + shiftX),
      y = mm(height / 2 - 10 + shiftY);
    page.drawRectangle({
      x,
      y,
      width: mm(20),
      height: mm(20),
      borderWidth: 0.4,
      borderColor: rgb(0, 0, 0),
    });
    page.drawLine({
      start: { x: x - mm(5), y: y + mm(10) },
      end: { x: x + mm(25), y: y + mm(10) },
      thickness: 0.2,
    });
    page.drawLine({
      start: { x: x + mm(10), y: y - mm(5) },
      end: { x: x + mm(10), y: y + mm(25) },
      thickness: 0.2,
    });
    const length = Math.min(100, width - 40),
      lx = mm((width - length) / 2),
      ly = mm(height / 2 - 35);
    page.drawLine({
      start: { x: lx, y: ly },
      end: { x: lx + mm(length), y: ly },
      thickness: 0.4,
    });
    for (let n = 0; n <= length; n++)
      page.drawLine({
        start: { x: lx + mm(n), y: ly },
        end: { x: lx + mm(n), y: ly + mm(n % 10 === 0 ? 3 : 1.5) },
        thickness: 0.3,
      });
    for (const [text, yy, size] of [
      [`BOOKCHE / ${side}`, height - 25, 12],
      [
        "Print at 100% / Actual size. Disable fit, shrink and headers.",
        height - 35,
        8,
      ],
      [
        "Square: 20 x 20 mm. Hold duplex sheets to the light to check alignment.",
        height / 2 - 50,
        7,
      ],
      [
        `Ruler: ${length} mm. Adjust back-side offsets in Sheet setup if needed.`,
        height / 2 - 57,
        7,
      ],
    ]) {
      page.drawText(text, { x: mm(15), y: mm(yy), size, font });
    }
  }
  return doc.save();
}
