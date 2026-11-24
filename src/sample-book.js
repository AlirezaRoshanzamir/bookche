import { makeBook } from "./layout.js";
import { pageReference, resizeBook } from "./sizing.js";

export function createSampleBook(asset, id) {
  const book = makeBook(id, "Pride and Prejudice", asset.id, asset.pageCount);
  book.ranges = "2-31";
  Object.assign(book.cover, {
    mode: "separate",
    color: "#182522",
    ink: "#d4ad62",
    gradient: true,
    backText: "PRIDE AND PREJUDICE\n\nJane Austen\n\n1813",
    front: { type: "book", page: 1 },
  });
  Object.assign(book, resizeBook(book, "lockAspectRatio", true, pageReference(book, asset.pageSizes)));
  return book;
}
