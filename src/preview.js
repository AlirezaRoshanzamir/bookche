import * as pdfjs from "pdfjs-dist";
import { PreviewCache } from "./preview-cache.js";
import {
  fitInside,
  hasArtwork,
  coverPanels,
  cutGuides,
  registrationGuides,
} from "./render-geometry.js";
import { makeCoverLettering } from "./cover.js";

export function createSheetPreview() {
  const ids = new WeakMap(),
    documents = new WeakMap(),
    lettering = new Map();
  let nextId = 0,
    worker,
    generation = 0;
  const cache = new PreviewCache(async ({ asset, page, size }) => {
    if (asset.mime !== "application/pdf")
      return createImageBitmap(new Blob([asset.bytes], { type: asset.mime }));
    if (!documents.has(asset)) {
      worker ||= new pdfjs.PDFWorker();
      const promise = pdfjs.getDocument({
        data: asset.bytes.slice(),
        worker,
        isEvalSupported: false,
      }).promise;
      documents.set(asset, promise);
      promise.catch(() => documents.delete(asset));
    }
    const doc = await documents.get(asset),
      input = await doc.getPage(page);
    try {
      const original = input.getViewport({ scale: 1 });
      const viewport = input.getViewport({
        scale: size / Math.max(original.width, original.height),
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await input.render({ canvasContext: canvas.getContext("2d"), viewport })
        .promise;
      return canvas;
    } finally {
      input.cleanup();
    }
  });
  function resource(source, book, width, height, pixelsPerMm, assets) {
    const asset =
      assets[source.type === "book" ? book.assetId : source.assetId];
    if (!asset)
      throw new Error(
        `Missing artwork for ${book.title}. Choose the file again.`,
      );
    if (!ids.has(asset)) ids.set(asset, ++nextId);
    const page = Number(source.page || 1);
    if (page < 1 || page > asset.pageCount)
      throw new Error(`${book.title}: a page is outside the PDF's page range.`);
    const dimensions = asset.pageSizes?.[page - 1];
    const fit = dimensions
      ? fitInside(dimensions.width, dimensions.height, width, height)
      : { width, height };
    const needed = Math.max(fit.width, fit.height) * pixelsPerMm;
    const size =
      asset.mime === "application/pdf"
        ? [64, 128, 256, 512, 1024, 2048].find((n) => n >= needed) || 2048
        : 0;
    const base = `${ids.get(asset)}:${page}:`,
      key = base + size;
    return {
      key,
      input: { asset, page, size },
      image() {
        return (
          cache.peek(key) ||
          [2048, 1024, 512, 256, 128, 64, 0]
            .map((n) => cache.peek(base + n))
            .find(Boolean)
        );
      },
    };
  }
  function guide(ctx, shape) {
    ctx.beginPath();
    if (shape.type === "line") {
      ctx.strokeStyle = shape.stroke;
      ctx.lineWidth = shape.lineWidth;
      ctx.moveTo(shape.x1, shape.y1);
      ctx.lineTo(shape.x2, shape.y2);
      ctx.stroke();
    } else if (shape.type === "fill") {
      ctx.fillStyle = shape.fill;
      ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
    } else {
      ctx.strokeStyle = shape.stroke;
      ctx.lineWidth = shape.lineWidth;
      ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
    }
  }
  function generated(ctx, book, panel, height, pixelsPerMm) {
    const c = book.cover,
      w = panel.width,
      h = height;
    ctx.fillStyle = c.color;
    ctx.fillRect(0, 0, w, h);
    if (c.gradient)
      for (let i = 0; i < 24; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.12 * (1 - i / 24)})`;
        ctx.fillRect(0, (h * (23 - i)) / 24, w, h / 24 + (0.1 * 25.4) / 72);
      }
    if (panel.role !== "spine") {
      ctx.save();
      ctx.globalAlpha = 0.65;
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = (0.35 * 25.4) / 72;
      ctx.strokeRect(w * 0.1, h * 0.08, w * 0.8, h * 0.84);
      ctx.restore();
      if (panel.role === "front")
        guide(ctx, {
          type: "line",
          x1: w * 0.4,
          x2: w * 0.6,
          y1: h * 0.77,
          y2: h * 0.77,
          stroke: c.ink,
          lineWidth: (0.5 * 25.4) / 72,
        });
    }
    const key = JSON.stringify([
      book.title,
      w,
      h,
      c.ink,
      panel.role,
      c.subtitle,
      c.backText,
      pixelsPerMm,
    ]);
    if (!lettering.has(key)) {
      lettering.set(
        key,
        makeCoverLettering(
          book.title,
          w,
          h,
          c.ink,
          panel.role,
          c.subtitle,
          pixelsPerMm,
          c.backText,
        ),
      );
      if (lettering.size > 40) lettering.delete(lettering.keys().next().value);
    }
    ctx.drawImage(lettering.get(key), 0, 0, w, h);
  }
  return {
    cancel() {
      generation++;
      cache.show([]);
    },
    render(canvas, books, assets, settings, layout, face, onStatus) {
      const serial = ++generation,
        start = performance.now();
      const pixelsPerMm = Math.min(1800 / layout.width, (2.8 * 72) / 25.4);
      const commands = [],
        resources = new Map(),
        bookMap = new Map(books.map((b) => [b.id, b]));
      const artwork = (source, book, x, y, width, height, rotation = 0) => {
        const res = resource(source, book, width, height, pixelsPerMm, assets);
        resources.set(res.key, res);
        commands.push((ctx) => {
          const image = res.image();
          ctx.save();
          ctx.translate(x, y);
          if (image) {
            const fit = fitInside(image.width, image.height, width, height);
            if (rotation === 180) {
              ctx.translate(width, height);
              ctx.rotate(Math.PI);
            }
            ctx.drawImage(image, fit.x, fit.y, fit.width, fit.height);
          } else {
            ctx.fillStyle = "#f1eff4";
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = "#a49aaf";
            ctx.font = `${Math.min(2, height / 8)}px sans-serif`;
            ctx.textAlign = "center";
            ctx.fillText(String(source.page || 1), width / 2, height / 2);
          }
          ctx.restore();
        });
      };
      for (const piece of face.pieces) {
        const book = bookMap.get(piece.bookId),
          { x, y, width, height } = piece;
        if (piece.kind === "page") {
          const m = book.margin;
          artwork(
            { type: "book", page: piece.page },
            book,
            x + m,
            y + m,
            width - m * 2,
            height - m * 2,
            piece.rotation,
          );
        } else if (book.cover.mode === "wrap" && hasArtwork(book.cover.wrap))
          artwork(book.cover.wrap, book, x, y, width, height);
        else
          for (const panel of coverPanels(book)) {
            const source = book.cover.mode === "separate" ? panel.source : null;
            if (hasArtwork(source))
              artwork(source, book, x + panel.x, y, panel.width, height);
            else
              commands.push((ctx) => {
                ctx.save();
                ctx.translate(x + panel.x, y);
                generated(ctx, book, panel, height, pixelsPerMm);
                ctx.restore();
              });
          }
        commands.push((ctx) => {
          ctx.save();
          ctx.translate(x, y);
          for (const shape of cutGuides(piece, book)) guide(ctx, shape);
          ctx.restore();
        });
      }
      if (settings.registration)
        commands.push((ctx) => {
          for (const shape of registrationGuides(layout.width, layout.height))
            guide(ctx, shape);
        });
      cache.show(resources.keys());
      const paint = () => {
        if (serial !== generation) return;
        canvas.width = Math.ceil(layout.width * pixelsPerMm);
        canvas.height = Math.ceil(layout.height * pixelsPerMm);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(pixelsPerMm, pixelsPerMm);
        for (const draw of commands) draw(ctx);
      };
      paint();
      canvas.dataset.firstPaintMs = (performance.now() - start).toFixed(1);
      let pending = [...resources.values()].filter(
          (res) => !cache.peek(res.key),
        ).length,
        frame = false;
      canvas.dataset.previewState = pending ? "loading" : "ready";
      onStatus(pending);
      const redraw = () => {
        if (frame || serial !== generation) return;
        frame = true;
        requestAnimationFrame(() => {
          frame = false;
          if (serial !== generation) return;
          paint();
          canvas.dataset.previewState = pending ? "loading" : "ready";
          canvas.dataset.renderMs = (performance.now() - start).toFixed(1);
          onStatus(pending);
        });
      };
      for (const res of resources.values()) {
        if (cache.peek(res.key)) continue;
        cache.request(res.key, res.input).then(
          () => {
            pending--;
            redraw();
          },
          (error) => {
            if (serial === generation) {
              generation++;
              onStatus(0, error);
            }
          },
        );
      }
      if (!pending) canvas.dataset.renderMs = canvas.dataset.firstPaintMs;
    },
  };
}
