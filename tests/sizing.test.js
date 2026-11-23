import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBook } from "../src/layout.js";
import { normalizeProject, encodeProject } from "../src/storage.js";
import {
  displayedPageSize,
  pageReference,
  resizeBook,
  pdfScale,
  ratioLabel,
  stepNumber,
} from "../src/sizing.js";
const source = { width: 100, height: 200 };
const book = () => makeBook("book", "A tiny book", "asset", 2);
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`);
function proportional(b, ref = source) {
  close(
    (b.width - 2 * b.margin) / (b.height - 2 * b.margin),
    ref.width / ref.height,
  );
}

test("matching a PDF removes extra letterboxing inside the content margin", () => {
  const b = resizeBook(
    { ...book(), lockAspectRatio: false },
    "lockAspectRatio",
    true,
    source,
  );
  assert.equal(b.width, 25);
  assert.equal(b.height, 48);
  proportional(b);
});
test("linked width and height changes work in both directions", () => {
  const wide = resizeBook(book(), "width", 30, source);
  assert.equal(wide.height, 58);
  proportional(wide);
  const tall = resizeBook(wide, "height", 100, source);
  assert.equal(tall.width, 51);
  proportional(tall);
});
test("changing a linked margin preserves artwork scale", () => {
  const before = resizeBook(book(), "lockAspectRatio", true, source);
  const after = resizeBook(before, "margin", 3, source);
  assert.equal(after.width, 29);
  assert.equal(after.height, 52);
  close(pdfScale(after, source), pdfScale(before, source));
  proportional(after);
});
test("percentage scale sets both dimensions and enables their link", () => {
  const b = resizeBook(
    { ...book(), lockAspectRatio: false },
    "pdfScale",
    10,
    source,
  );
  assert.equal(b.width, 12);
  assert.equal(b.height, 22);
  assert.equal(b.lockAspectRatio, true);
  close(pdfScale(b, source), 10);
  proportional(b);
});
test("size limits clamp both dimensions together, without breaking the ratio", () => {
  for (const shape of [
    source,
    { width: 400, height: 20 },
    { width: 10, height: 800 },
  ]) {
    for (const scale of [-1, 0, 0.01, 1000, 10000]) {
      const b = resizeBook(book(), "pdfScale", scale, shape);
      assert.ok(
        b.width >= 5 && b.width <= 300 && b.height >= 5 && b.height <= 400,
      );
      proportional(b, shape);
    }
  }
});
test("unlinked sizes remain independent and can be matched later", () => {
  const b = resizeBook(
    { ...book(), lockAspectRatio: false },
    "width",
    50,
    source,
  );
  assert.equal(b.height, 35);
  proportional(resizeBook(b, "lockAspectRatio", true, source));
});
test("PDF display dimensions account for rotation and preserve portrait/landscape ratios", () => {
  assert.deepEqual(displayedPageSize(100, 200, 90), {
    width: 200,
    height: 100,
  });
  assert.deepEqual(displayedPageSize(100, 200, 270), {
    width: 200,
    height: 100,
  });
  assert.deepEqual(displayedPageSize(100, 200, -90), {
    width: 200,
    height: 100,
  });
  assert.deepEqual(displayedPageSize(100, 200, 180), {
    width: 100,
    height: 200,
  });
  assert.equal(ratioLabel(source), "1 : 2");
  assert.equal(ratioLabel(displayedPageSize(100, 200, 90)), "2 : 1");
});
test("number picker increments are precise, respect bounds, and support negative offsets", () => {
  let n = 1;
  for (let i = 0; i < 10; i++) n = stepNumber(n, 1, 0.1, 0, 30);
  assert.equal(n, 2);
  assert.equal(stepNumber(0, -1, 0.1, -20, 20), -0.1);
  assert.equal(stepNumber(5, -1, 0.5, 5, 300), 5);
  assert.equal(stepNumber(299.8, 1, 0.5, 5, 300), 300);
});
test("old projects keep their dimensions while new project files retain the ratio link and source sizes", () => {
  const b = book();
  delete b.lockAspectRatio;
  const project = {
    version: 1,
    books: [b],
    assets: {
      asset: {
        id: "asset",
        mime: "application/pdf",
        bytes: new Uint8Array([1]),
        pageCount: 2,
        pageSizes: [source, { width: 200, height: 100 }],
      },
    },
  };
  const restored = normalizeProject(project);
  assert.equal(restored.books[0].lockAspectRatio, false);
  assert.equal(restored.books[0].height, 35);
  restored.books[0] = resizeBook(
    restored.books[0],
    "lockAspectRatio",
    true,
    source,
  );
  const reopened = normalizeProject(JSON.parse(encodeProject(restored)), true);
  assert.equal(reopened.books[0].lockAspectRatio, true);
  assert.deepEqual(
    reopened.assets.asset.pageSizes,
    project.assets.asset.pageSizes,
  );
  proportional(reopened.books[0]);
});

test("the percentage shown for unlinked dimensions matches the actual fitted PDF artwork", () => {
  const b = { ...book(), width: 100, height: 25, lockAspectRatio: false };
  close(pdfScale(b, source), 11.5);
  const linked = resizeBook(b, "lockAspectRatio", true, source);
  assert.equal(linked.width, 100);
  proportional(linked);
});

test("linked sizes follow the body pages when the cover has a different shape", () => {
  const sizes = [
    { width: 142.169444, height: 222.25 },
    ...Array.from({ length: 511 }, () => ({
      width: 126.294444,
      height: 205.669444,
    })),
  ];
  const b = {
    ...book(),
    pageCount: 512,
    width: 16.86,
    height: 26.35,
    margin: 0,
    lockAspectRatio: true,
  };
  const ref = pageReference(b, sizes);
  assert.equal(ref.page, 2);
  assert.equal(ref.matches, 511);
  assert.equal(ref.mixed, true);
  const matched = resizeBook(b, "lockAspectRatio", true, ref);
  assert.equal(matched.width, b.width);
  proportional(matched, sizes[1]);
});

test("ratio reference respects selected ranges and uses the first selected shape in a tie", () => {
  const sizes = [
    { width: 100, height: 200 },
    { width: 200, height: 100 },
    { width: 400, height: 200 },
  ];
  assert.equal(
    pageReference({ ...book(), pageCount: 3, ranges: "1-3" }, sizes).page,
    2,
  );
  assert.equal(
    pageReference({ ...book(), pageCount: 3, ranges: "1" }, sizes).page,
    1,
  );
  const tie = pageReference({ ...book(), pageCount: 3, ranges: "2,1" }, sizes);
  assert.equal(tie.page, 2);
  assert.equal(tie.total, 2);
});

test("ratio reference tolerates invalid ranges and missing metadata while editing", () => {
  assert.equal(pageReference({ ...book(), ranges: "1-" }, [source]).page, 1);
  assert.equal(pageReference(book(), []), null);
  assert.equal(
    pageReference(book(), [{ width: 0, height: 0 }, source]).page,
    2,
  );
});

test("back-cover text survives project saves, keeps blank text, and defaults for older projects", () => {
  const b = book(),
    project = {
      version: 1,
      books: [b],
      assets: {
        asset: {
          id: "asset",
          mime: "application/pdf",
          bytes: new Uint8Array([1]),
          pageCount: 2,
          pageSizes: [source, source],
        },
      },
    };
  for (const message of [
    "A story for you.\nKeep it close.",
    "",
    "کتاب کوچک من",
    "<script>plain text</script>",
  ]) {
    b.cover.backText = message;
    assert.equal(
      normalizeProject(JSON.parse(encodeProject(project)), true).books[0].cover
        .backText,
      message,
    );
  }
  delete b.cover.backText;
  assert.equal(
    normalizeProject(project).books[0].cover.backText,
    "A little world.\nYours to make.",
  );
  b.cover.backText = "x".repeat(501);
  assert.equal(normalizeProject(project).books[0].cover.backText.length, 500);
});
