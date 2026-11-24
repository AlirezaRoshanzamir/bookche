import { makeBook } from "./layout.js";
import { pageReference, resizeBook } from "./sizing.js";

export const SAMPLE_BOOKS = [
  {
    id: "pride-and-prejudice",
    title: "Pride and Prejudice",
    color: "#182522",
    ink: "#d4ad62",
    backText: "PRIDE AND PREJUDICE\n\nJane Austen\n\n1813",
  },
  {
    id: "alice-in-wonderland",
    title: "Alice's Adventures in Wonderland",
    color: "#6e131c",
    ink: "#e0ba6e",
    backText: "ALICE'S ADVENTURES\nIN WONDERLAND\n\nLewis Carroll\nIllustrated by John Tenniel\n\n1865",
  },
];

export function createSampleBook(asset, id, sample = SAMPLE_BOOKS[0]) {
  const book = makeBook(id, sample.title, asset.id, asset.pageCount);
  book.ranges = `2-${asset.pageCount}`;
  Object.assign(book.cover, {
    mode: "separate",
    color: sample.color,
    ink: sample.ink,
    gradient: true,
    backText: sample.backText,
    front: { type: "book", page: 1 },
  });
  Object.assign(book, resizeBook(book, "lockAspectRatio", true, pageReference(book, asset.pageSizes)));
  return book;
}
