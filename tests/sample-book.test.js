import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { createSampleBook, SAMPLE_BOOKS } from "../src/sample-book.js";
import { computeLayout, defaultSettings, paperSize } from "../src/layout.js";
import { normalizeProject } from "../src/storage.js";

test("new projects use A4 landscape while saved portrait stays portrait", () => {
  assert.deepEqual(paperSize(defaultSettings()), [297, 210]);
  const project = { version: 1, books: [], assets: {} };
  assert.equal(normalizeProject(project).settings.orientation, "landscape");
  assert.equal(normalizeProject({ ...project, settings: { orientation: "portrait" } }).settings.orientation, "portrait");
});

test("bundled sample prints 19 body pages and uses page 1 only for its front cover", async () => {
  const bytes = await readFile(new URL("../src/assets/pride-and-prejudice-sample.pdf", import.meta.url));
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 20);
  const asset = { id: "sample", pageCount: 20, pageSizes: pdf.getPages().map(p => p.getSize()) };
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
  assert.deepEqual(pieces.filter(p => p.kind === "page").map(p => p.page), Array.from({ length: 19 }, (_, i) => i + 2));
  assert.equal(book.margin, 0);
});


test("both default samples include printable pages and covers in single and double-sided layouts", async () => {
  const books = [];
  for (const sample of SAMPLE_BOOKS) {
    const bytes = await readFile(new URL(`../src/assets/${sample.id}-sample.pdf`, import.meta.url));
    const pdf = await PDFDocument.load(bytes);
    const asset = { id: sample.id, pageCount: pdf.getPageCount(), pageSizes: pdf.getPages().map(p => p.getSize()) };
    const book = createSampleBook(asset, sample.id, sample);
    assert.equal(book.includePages, true);
    assert.equal(book.cover.enabled, true);
    assert.notEqual(book.hidden, true);
    assert.deepEqual(book.cover.front, { type: "book", page: 1 });
    assert.equal(book.ranges, `2-${pdf.getPageCount()}`);
    books.push(book);
    if (sample.id === "alice-in-wonderland") {
      assert.equal(pdf.getPageCount(), 20);
      assert.ok(bytes.length < 1_000_000);
      assert.equal(book.cover.color, "#6e131c");
    }
  }
  assert.equal(books.length, 2);
  for (const mode of ["single", "duplex"]) {
    const layout = computeLayout(books, { ...defaultSettings(), mode });
    assert.deepEqual(layout.errors, []);
    assert.equal(layout.sheets.length, 1);
    if (mode === "single") {
      const pieces = layout.sheets[0].front;
      assert.equal(new Set(pieces.map(p => p.y)).size, 4);
      for (const book of books) {
        assert.equal(new Set(pieces.filter(p => p.bookId === book.id).map(p => p.y)).size, 2);
      }
    }
    for (const book of books) {
      const pieces = layout.sheets.flatMap(s => [...s.front, ...s.back]).filter(p => p.bookId === book.id);
      assert.equal(pieces.filter(p => p.kind === "cover").length, 1);
      assert.deepEqual(pieces.filter(p => p.kind === "page").map(p => p.page).sort((a,b) => a-b), Array.from({ length: book.pageCount - 1 }, (_, i) => i + 2));
    }
  }
});
