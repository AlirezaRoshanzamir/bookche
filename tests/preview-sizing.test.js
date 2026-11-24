import { test } from "node:test";
import assert from "node:assert/strict";
import { previewSceneSize } from "../src/render-geometry.js";

function scrollbarPasses(width, height, paper, zoom, scrollbar = 16) {
  let horizontal = false, vertical = true;
  return Array.from({ length: 6 }, () => {
    const stage = {
      offsetWidth: width,
      offsetHeight: height,
      clientWidth: width - (vertical ? scrollbar : 0),
      clientHeight: height - (horizontal ? scrollbar : 0),
    };
    const scene = previewSceneSize(stage, paper, zoom);
    horizontal = scene.width + 84 > stage.clientWidth;
    vertical = scene.height + 72 > stage.clientHeight;
    return { ...scene, horizontal, vertical };
  });
}

test("A3 at 175% settles at the horizontal scrollbar threshold", () => {
  // Using client dimensions here alternates between widths 650.925 and 631.125.
  const passes = scrollbarPasses(740, 600, { width: 297, height: 420 }, 1.75);
  assert.equal(passes[0].horizontal, true);
  assert.equal(passes[0].vertical, true);
  for (const pass of passes) assert.deepEqual(pass, passes[0]);
});

test("preview sizing settles across window sizes, zooms and scrollbar widths", () => {
  for (const width of [320, 480, 728, 740, 752, 980, 1200])
    for (const height of [330, 480, 600, 768])
      for (const paper of [{ width: 297, height: 420 }, { width: 420, height: 297 }])
        for (const zoom of [0.5, 1, 1.25, 1.5, 1.75, 2, 3, 10])
          for (const scrollbar of [0, 12, 15, 17]) {
            const passes = scrollbarPasses(width, height, paper, zoom, scrollbar);
            assert.deepEqual(passes.at(-1), passes.at(-2),
              `${width}x${height}, ${zoom * 100}%, ${scrollbar}px scrollbar`);
          }
});
