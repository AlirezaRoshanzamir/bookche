import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeLayout,
  defaultSettings,
  makeBook,
  mm,
  parseRanges,
  paperSize,
  outputFaces,
} from "../src/layout.js";
import { normalizeProject } from "../src/storage.js";
const book = (count = 12) => makeBook("book", "Test book", "asset", count);
const duplex = (extra) => ({ ...defaultSettings(), mode: "duplex", ...extra });
test("page ranges accept all, disjoint intervals and remove duplicates", () => {
  assert.deepEqual(parseRanges("", 3), [1, 2, 3]);
  assert.deepEqual(parseRanges("all", 3), [1, 2, 3]);
  assert.deepEqual(parseRanges("3-5, 1, 4", 6), [3, 4, 5, 1]);
  for (const range of ["0", "4", "2-1", "2-", "-2", "word", "1,"])
    assert.throws(() => parseRanges(range, 3));
});
test("single-sided pages touch in horizontal strips with configurable row spacing", () => {
  const b = book(12);
  b.cover.enabled = false;
  const result = computeLayout([b], defaultSettings());
  assert.equal(result.errors.length, 0);
  const p = result.sheets[0].front;
  assert.equal(p[1].x, p[0].x + b.width);
  assert.equal(p[7].x, 10);
  assert.equal(p[7].y, 10 + b.height + b.rowGap);
  assert.deepEqual(
    p.map((x) => x.page),
    Array.from({ length: 12 }, (_, i) => i + 1),
  );
});
for (const orientation of ["portrait", "landscape"])
  for (const flip of ["long", "short"]) {
    test(`duplex physical alignment: ${orientation}, ${flip}`, () => {
      const s = duplex({ orientation, flip }),
        b = book(12);
      b.cover.enabled = false;
      const result = computeLayout([b], s),
        [w, h] = paperSize(s);
      for (const sheet of result.sheets)
        for (let i = 0; i < sheet.front.length; i++) {
          const f = sheet.front[i],
            r = sheet.back[i];
          assert.equal(r.page, f.page + 1);
          const mirrorX = flip === "long" ? h >= w : h < w;
          assert.equal(r.rotation, mirrorX ? 0 : 180);
          assert.equal(r.x, mirrorX ? w - f.x - f.width : f.x);
          assert.equal(r.y, mirrorX ? f.y : h - f.y - f.height);
        }
    });
  }
test("cover-only books retain blank backs during duplex output", () => {
  const b = book();
  b.includePages = false;
  const result = computeLayout([b], duplex());
  assert.equal(result.faces.length, 2);
  assert.equal(result.faces[1].pieces.length, 0);
  assert.equal(result.faces[0].pieces[0].width, 55);
  assert.equal(result.faces[0].pieces[0].height, 36);
});
test("odd ranges pair in selected order and leave the final reverse blank", () => {
  const b = book(8);
  b.cover.enabled = false;
  b.ranges = "2, 5-6";
  const result = computeLayout([b], duplex());
  assert.deepEqual(
    result.sheets[0].front.map((p) => p.page),
    [2, 6],
  );
  assert.deepEqual(
    result.sheets[0].back.map((p) => p.page),
    [5],
  );
  assert.match(result.warnings[0], /blank back/);
});
test("multiple mixed-size books never overlap or exceed margins", () => {
  const b1 = book(300),
    b2 = { ...book(75), id: "book2", width: 31, height: 43, rowGap: 7 };
  const settings = duplex(),
    result = computeLayout([b1, b2], settings);
  assert.equal(result.errors.length, 0);
  assert.ok(result.sheets.length > 2);
  for (const sheet of result.sheets)
    for (const side of ["front", "back"]) {
      for (const a of sheet[side]) {
        assert.ok(
          a.x >= 10 &&
            a.y >= 10 &&
            a.x + a.width <= result.width - 10 + 0.001 &&
            a.y + a.height <= result.height - 10 + 0.001,
        );
        for (const b of sheet[side]) {
          if (a === b) continue;
          const overlapX =
            Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const overlapY =
            Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          assert.ok(overlapX < 0.001 || overlapY < 0.001);
        }
      }
    }
});
test("oversized pieces and invalid ranges block output clearly", () => {
  const b = book();
  b.width = 250;
  assert.match(
    computeLayout([b], defaultSettings()).errors.join(" "),
    /too large/,
  );
  b.width = 25;
  b.ranges = "13";
  assert.match(
    computeLayout([b], defaultSettings()).errors.join(" "),
    /between 1 and 12/,
  );
  assert.equal(
    computeLayout([b], { ...defaultSettings(), sheetMargin: 150 }).faces.length,
    0,
  );
});
test("back offsets apply in viewed-back coordinates and warn about clipping", () => {
  const b = book(2);
  b.cover.enabled = false;
  const s = duplex({ backOffsetX: 1.2, backOffsetY: -2.4 }),
    result = computeLayout([b], s);
  const f = result.sheets[0].front[0],
    r = result.sheets[0].back[0];
  assert.equal(r.x, result.width - f.x - f.width + 1.2);
  assert.equal(r.y, f.y - 2.4);
  assert.ok(computeLayout([b], duplex({ backOffsetY: -20 })).warnings.length);
});
test("manual duplex output preserves each physical sheet, including blank backs", () => {
  const b = book(400),
    s = duplex(),
    result = computeLayout([b], s);
  const fronts = outputFaces(result, { ...s, output: "front" }),
    backs = outputFaces(result, { ...s, output: "back" });
  assert.equal(fronts.length, result.sheets.length);
  assert.equal(backs.length, result.sheets.length);
  assert.deepEqual(
    fronts.map((f) => f.sheet),
    backs.map((f) => f.sheet),
  );
});
test("hidden books and disabled content produce no phantom sheets", () => {
  const b = book();
  b.hidden = true;
  assert.equal(computeLayout([b], defaultSettings()).sheets.length, 0);
  b.hidden = false;
  b.cover.enabled = false;
  b.includePages = false;
  assert.equal(computeLayout([b], defaultSettings()).sheets.length, 0);
});
test("millimeter conversion and paper rotation are exact", () => {
  assert.equal(mm(25.4), 72);
  assert.deepEqual(
    paperSize({ ...defaultSettings(), orientation: "landscape" }),
    [297, 210],
  );
});
test("portable project validation rejects missing assets and normalizes unsafe settings", () => {
  assert.throws(
    () => normalizeProject({ version: 1, books: [book()], assets: {} }),
    /missing/,
  );
  const p = normalizeProject({
    version: 1,
    books: [book()],
    assets: {
      asset: {
        bytes: new Uint8Array([1]),
        mime: "application/pdf",
        pageCount: 12,
      },
    },
    settings: { backOffsetX: "bad", customWidth: -100 },
  });
  assert.equal(p.settings.backOffsetX, 0);
  assert.equal(p.settings.customWidth, 210);
  assert.equal(p.books[0].pageCount, 12);
});
test("custom cutting ranges are validated before PDF generation", () => {
  const b = book();
  b.markPages = "custom";
  b.markRanges = "1, 3-4";
  assert.equal(computeLayout([b], defaultSettings()).errors.length, 0);
  b.markRanges = "99";
  assert.match(computeLayout([b], defaultSettings()).errors[0], /cut marks/);
});
test("an unfinished cover upload reopens safely with a generated fallback", () => {
  const b = book();
  b.cover.front = { type: "asset" };
  const p = normalizeProject({
    version: 1,
    books: [b],
    assets: {
      asset: {
        bytes: new Uint8Array([1]),
        mime: "application/pdf",
        pageCount: 12,
      },
    },
  });
  assert.equal(p.books[0].cover.front.type, "generated");
});
test("cover overhang and spine width affect physical cut dimensions independently", () => {
  const b = book();
  b.cover.spine = 4.2;
  b.cover.overhang = 1.5;
  b.includePages = false;
  const cover = computeLayout([b], defaultSettings()).sheets[0].front[0];
  assert.equal(cover.width, (25 + 3) * 2 + 4.2);
  assert.equal(cover.height, 35 + 3);
});

test("covers and pages can share a row without changing reading order", () => {
  const b = book(8);
  b.pagesStartOnNewRow = false;
  const pieces = computeLayout([b], defaultSettings()).sheets[0].front;
  assert.equal(pieces[0].kind, "cover");
  assert.equal(pieces[1].x, pieces[0].x + pieces[0].width + 3);
  assert.equal(pieces[1].y, pieces[0].y);
  assert.equal(pieces[6].x, 10);
  assert.equal(pieces[6].y, 10 + pieces[0].height + b.rowGap);
  assert.deepEqual(pieces.slice(1).map(p => p.page), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("books share rows of mixed heights and wrap below the tallest item", () => {
  const a = book(1), b = makeBook("second", "Second", "asset", 7);
  a.cover.enabled = b.cover.enabled = false;
  a.height = 60;
  b.startOnNewRow = b.pagesStartOnNewRow = false;
  b.rowGap = 7;
  const pieces = computeLayout([a, b], defaultSettings()).sheets[0].front;
  assert.equal(pieces[1].x, 35);
  assert.equal(pieces[1].y, 10);
  assert.equal(pieces[7].x, 10);
  assert.equal(pieces[7].y, 77);
});

test("book, cover and page row starts each force a fresh row", () => {
  for (const boundary of ["book", "cover", "pages"]) {
    const a = book(1), b = makeBook("second", "Second", "asset", 1);
    a.cover.enabled = false;
    b.startOnNewRow = b.pagesStartOnNewRow = b.cover.startOnNewRow = false;
    b.cover.enabled = boundary === "cover";
    if (boundary === "book") b.startOnNewRow = true;
    if (boundary === "cover") b.cover.startOnNewRow = true;
    if (boundary === "pages") b.pagesStartOnNewRow = true;
    const pieces = computeLayout([a, b], defaultSettings()).sheets[0].front;
    assert.equal(pieces[1].x, 10, boundary);
    assert.equal(pieces[1].y, 48, boundary);
  }
});

test("shared rows preserve duplex pairing and blank cover backs", () => {
  const a = book(3), b = makeBook("second", "Second", "asset", 2);
  a.pagesStartOnNewRow = false;
  b.startOnNewRow = b.pagesStartOnNewRow = false;
  b.cover.enabled = false;
  for (const orientation of ["portrait", "landscape"]) {
    for (const flip of ["long", "short"]) {
      const settings = duplex({ orientation, flip });
      const layout = computeLayout([a, b], settings);
      const [w, h] = paperSize(settings);
      const mirrorX = flip === "long" ? h >= w : h < w;
      const front = layout.sheets[0].front, back = layout.sheets[0].back;
      assert.equal(front.length, 4);
      assert.equal(back.length, 2);
      for (const reverse of back) {
        const face = front.find(p => p.bookId === reverse.bookId && p.page === reverse.page - 1);
        assert.equal(reverse.x, mirrorX ? w - face.x - face.width : face.x);
        assert.equal(reverse.y, mirrorX ? face.y : h - face.y - face.height);
      }
    }
  }
});

test("shared rows move overflowing taller pieces to the next sheet", () => {
  const a = book(1), b = makeBook("second", "Second", "asset", 1);
  a.cover.enabled = b.cover.enabled = false;
  a.height = 20;
  b.height = 60;
  b.startOnNewRow = b.pagesStartOnNewRow = false;
  const settings = { ...defaultSettings(), paper: "Custom", customWidth: 100, customHeight: 70 };
  // The taller item fits a new sheet, but not the remaining height on the current one.
  b.height = 45;
  a.pageCount = 4;
  const layout = computeLayout([a, b], settings);
  assert.equal(layout.sheets.length, 2);
  assert.equal(layout.sheets[1].front[0].bookId, b.id);
  assert.equal(layout.sheets[1].front[0].x, 10);
  assert.equal(layout.sheets[1].front[0].y, 10);
});

test("shared rows can have zero spacing", () => {
  const a = book(7), b = makeBook("second", "Second", "asset", 2);
  a.cover.enabled = b.cover.enabled = false;
  a.rowGap = b.rowGap = 0;
  b.startOnNewRow = b.pagesStartOnNewRow = false;
  const pieces = computeLayout([a, b], defaultSettings()).sheets[0].front;
  assert.equal(pieces[7].y, 45);
  assert.equal(pieces[8].x, 35);
});

test("row settings survive project loading and old projects keep separate rows", () => {
  const b = book(12);
  b.startOnNewRow = b.pagesStartOnNewRow = false;
  b.cover.startOnNewRow = true;
  const input = { version: 1, books: [b], assets: { asset: {
    bytes: new Uint8Array([1]), mime: "application/pdf", pageCount: 12,
  } } };
  let loaded = normalizeProject(input).books[0];
  assert.equal(loaded.startOnNewRow, false);
  assert.equal(loaded.pagesStartOnNewRow, false);
  assert.equal(loaded.cover.startOnNewRow, true);
  delete b.startOnNewRow;
  delete b.pagesStartOnNewRow;
  delete b.cover.startOnNewRow;
  loaded = normalizeProject(input).books[0];
  assert.equal(loaded.startOnNewRow, true);
  assert.equal(loaded.pagesStartOnNewRow, true);
  assert.equal(loaded.cover.startOnNewRow, false);
});
