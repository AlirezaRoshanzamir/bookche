import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { createSampleBook } from "../src/sample-book.js";
import { computeLayout, defaultSettings, paperSize } from "../src/layout.js";
import { normalizeProject } from "../src/storage.js";

test("new projects use A4 landscape while saved portrait stays portrait", () => {
  assert.deepEqual(paperSize(defaultSettings()), [297, 210]);
  const project = { version: 1, books: [], assets: {} };
  assert.equal(normalizeProject(project).settings.orientation, "landscape");
  assert.equal(normalizeProject({ ...project, settings: { orientation: "portrait" } }).settings.orientation, "portrait");
});

test("bundled sample prints 30 body pages and uses page 1 only for its front cover", async () => {
  const bytes = await readFile(new URL("../src/assets/pride-and-prejudice-sample.pdf", import.meta.url));
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 31);
  const asset = { id: "sample", pageCount: 31, pageSizes: pdf.getPages().map(p => p.getSize()) };
  const book = createSampleBook(asset, "book");
  assert.equal(book.title, "Pride and Prejudice");
  assert.equal(book.cover.mode, "separate");
  assert.deepEqual(book.cover.front, { type: "book", page: 1 });
  assert.equal(book.cover.back.type, "generated");
  assert.equal(book.cover.spineSource.type, "generated");
  const layout = computeLayout([book], defaultSettings());
  assert.deepEqual(layout.errors, []);
  const pieces = layout.sheets.flatMap(s => s.front);
  assert.equal(pieces.filter(p => p.kind === "cover").length, 1);
  assert.deepEqual(pieces.filter(p => p.kind === "page").map(p => p.page), Array.from({ length: 30 }, (_, i) => i + 2));
  assert.equal(book.margin, 0);
});
