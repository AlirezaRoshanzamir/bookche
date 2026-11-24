import { test } from "node:test";
import assert from "node:assert/strict";
import { makeManualBook, attachBookPdf } from "../src/book-source.js";
import { computeLayout, defaultSettings } from "../src/layout.js";
import { normalizeProject, encodeProject } from "../src/storage.js";

const project = book => ({ version: 1, settings: defaultSettings(), books: [book], assets: {} });

test("manual books print a cover with no PDF and survive portable saves", () => {
  const book = makeManualBook("manual");
  assert.equal(book.includePages, false);
  assert.equal(book.pageCount, 0);
  assert.equal(book.assetId, null);
  assert.equal(book.lockAspectRatio, false);
  for (const mode of ["single", "duplex"]) {
    const loaded = normalizeProject(JSON.parse(encodeProject(project(book))), true);
    assert.deepEqual(loaded.books[0], { ...book, hidden: false });
    const layout = computeLayout(loaded.books, { ...loaded.settings, mode });
    assert.deepEqual(layout.errors, []);
    assert.equal(layout.sheets[0].front.length, 1);
    assert.equal(layout.sheets[0].front[0].kind, "cover");
    assert.equal(layout.sheets[0].back.length, 0);
  }
});

test("manual books retain uploaded cover sources through save and reopen", () => {
  const book = makeManualBook("manual");
  book.cover.front = { type: "asset", assetId: "image", page: 1 };
  const input = project(book);
  input.assets.image = { mime: "image/png", bytes: new Uint8Array([1, 2]), pageCount: 1, name: "cover.png" };
  const loaded = normalizeProject(JSON.parse(encodeProject(input)), true);
  assert.deepEqual(loaded.books[0].cover.front, book.cover.front);
  assert.equal(loaded.books[0].assetId, null);
  assert.throws(() => normalizeProject({ ...input, books: [{ ...book, assetId: "missing" }] }), /missing/);
  assert.throws(() => normalizeProject({ ...input, books: [{ ...book, cover: { ...book.cover, front: { type: "book", page: 1 } } }] }), /missing/);
});

test("requesting pages before attaching a PDF leaves the cover printable", () => {
  const book = makeManualBook("manual");
  book.includePages = true;
  const loaded = normalizeProject(project(book));
  assert.equal(loaded.books[0].includePages, true);
  const layout = computeLayout(loaded.books, defaultSettings());
  assert.deepEqual(layout.errors, []);
  assert.equal(layout.sheets[0].front.length, 1);
});

test("attaching a PDF enables pages and preserves manual cover artwork and dimensions", () => {
  const book = makeManualBook("manual");
  book.width = 31;
  book.height = 44;
  book.cover.front = { type: "asset", assetId: "image", page: 1 };
  const attached = attachBookPdf(book, { id: "pdf", pageCount: 12 });
  assert.equal(attached.includePages, true);
  assert.equal(attached.assetId, "pdf");
  assert.equal(attached.pageCount, 12);
  assert.equal(attached.width, 31);
  assert.equal(attached.height, 44);
  assert.deepEqual(attached.cover, book.cover);
  assert.equal(book.assetId, null);
  assert.equal(computeLayout([attached], defaultSettings()).errors.length, 0);
});
