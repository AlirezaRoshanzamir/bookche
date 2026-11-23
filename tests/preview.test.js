import { test } from "node:test";
import assert from "node:assert/strict";
import { PreviewCache } from "../src/preview-cache.js";
import {
  fitArtwork,
  pixelBox,
  fitInside,
  cutGuides,
  coverPanels,
} from "../src/render-geometry.js";
import { makeBook } from "../src/layout.js";
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("visible pages share in-flight work and cached images across edits", async () => {
  let calls = 0;
  const cache = new PreviewCache(async () => {
    calls++;
    return { width: 64, height: 128 };
  });
  cache.show(["page"]);
  const a = cache.request("page", {}),
    b = cache.request("page", {});
  assert.equal(a, b);
  const image = await a;
  await tick();
  assert.equal(await cache.request("page", {}), image);
  assert.equal(calls, 1);
});
test("changing sheets skips obsolete queued pages and keeps concurrency bounded", async () => {
  const started = [],
    finish = [];
  const cache = new PreviewCache(
    (key) =>
      new Promise((resolve) => {
        started.push(key);
        finish.push(() => resolve({ width: 1, height: 1 }));
      }),
    { concurrency: 1 },
  );
  cache.show(["old", "skip"]);
  const old = cache.request("old", "old"),
    skipped = cache.request("skip", "skip");
  await tick();
  cache.show(["new"]);
  const latest = cache.request("new", "new");
  assert.deepEqual(started, ["old"]);
  finish.shift()();
  await old;
  await tick();
  assert.equal(await skipped, null);
  assert.deepEqual(started, ["old", "new"]);
  finish.shift()();
  await latest;
});
test("cache evicts old images while protecting the visible sheet", async () => {
  const closed = [];
  const cache = new PreviewCache(
    async (id) => ({ width: 10, height: 10, close: () => closed.push(id) }),
    { maxBytes: 400 },
  );
  cache.show(["a"]);
  await cache.request("a", "a");
  await tick();
  cache.show(["b"]);
  await cache.request("b", "b");
  await tick();
  assert.equal(cache.peek("a"), null);
  assert.ok(cache.peek("b"));
  assert.deepEqual(closed, ["a"]);
});
test("failed page renders can be retried", async () => {
  let calls = 0;
  const cache = new PreviewCache(async () => {
    if (!calls++) throw new Error("bad page");
    return { width: 1, height: 1 };
  });
  cache.show(["page"]);
  await assert.rejects(cache.request("page", {}));
  await tick();
  assert.ok(await cache.request("page", {}));
});
test("preview and PDF fit portrait and rotated artwork without changing proportions", () => {
  assert.deepEqual(fitInside(100, 200, 30, 40), {
    scale: 0.2,
    width: 20,
    height: 40,
    x: 5,
    y: 0,
  });
  assert.deepEqual(fitInside(200, 100, 30, 40), {
    scale: 0.15,
    width: 30,
    height: 15,
    x: 0,
    y: 12.5,
  });
});
test("cutting guides follow the content corner on rotated backs and selected pages", () => {
  const book = {
    ...makeBook("b", "Book", "a", 12),
    marks: "square",
    markCorner: "tl",
    markPages: "odd",
    border: false,
  };
  assert.equal(
    cutGuides({ kind: "page", width: 20, height: 30, page: 2 }, book).length,
    0,
  );
  const [guide] = cutGuides(
    { kind: "page", width: 20, height: 30, page: 3, rotation: 180 },
    book,
  );
  assert.equal(guide.x, 20 - 0.12 - 0.325);
  assert.equal(guide.y, 30 - 0.12 - 0.325);
  const panels = coverPanels(book);
  assert.equal(
    panels.at(-1).x + panels.at(-1).width,
    2 * (book.width + book.cover.overhang * 2) + book.cover.spine,
  );
});

test("cover artwork fills its box while body pages preserve their proportions", () => {
  for (const [w, h] of [
    [100, 200],
    [200, 100],
  ]) {
    assert.deepEqual(fitArtwork(w, h, 27, 38, true), {
      x: 0,
      y: 0,
      width: 27,
      height: 38,
    });
    assert.deepEqual(fitArtwork(w, h, 27, 38), fitInside(w, h, 27, 38));
  }
  assert.deepEqual(fitArtwork(100, 200, 57, 38, true), {
    x: 0,
    y: 0,
    width: 57,
    height: 38,
  });
});

test("fractional preview page sizes share pixel edges without seams", () => {
  for (const scale of [1.23, 6.060606, 7.937008]) {
    const width = 20.243307,
      height = 32.967123;
    for (let i = 0; i < 14; i++) {
      const page = pixelBox(10 + i * width, 10, width, height, scale);
      const next = pixelBox(10 + (i + 1) * width, 10, width, height, scale);
      assert.equal(page.x + page.width, next.x);
      const below = pixelBox(10 + i * width, 10 + height, width, height, scale);
      assert.equal(page.y + page.height, below.y);
    }
    const page = pixelBox(10, 10, width, height, scale);
    const spaced = pixelBox(10 + width + 2, 10, width, height, scale);
    assert.ok(spaced.x > page.x + page.width);
  }
});
