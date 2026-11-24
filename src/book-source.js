import { makeBook } from "./layout.js";

export function makeManualBook(id) {
  const book = makeBook(id, "Untitled book", null, 0);
  book.includePages = false;
  book.lockAspectRatio = false;
  book.cover.mode = "separate";
  book.cover.backText = "";
  return book;
}

export function attachBookPdf(book, asset) {
  return { ...book, assetId: asset.id, pageCount: asset.pageCount, ranges: "", includePages: true };
}
