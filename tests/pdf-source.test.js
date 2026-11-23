import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, degrees, rgb } from "pdf-lib";
import { embedSourcePage } from "../src/pdf-source.js";

for (const rotation of [0, 90, 180, 270]) {
  test(`blank PDF leaves embed and save, including rotation ${rotation}`, async () => {
    const source = await PDFDocument.create();
    source.addPage([100, 140]).setRotation(degrees(rotation));
    const input = await PDFDocument.load(await source.save());
    assert.equal(input.getPage(0).node.Contents(), undefined);
    const output = await PDFDocument.create();
    const embedded = await embedSourcePage(output, input.getPage(0));
    output.addPage([200, 200]).drawPage(embedded);
    const reopened = await PDFDocument.load(await output.save());
    assert.equal(reopened.getPageCount(), 1);
    assert.equal(embedded.width, 100);
    assert.equal(embedded.height, 140);
  });
}

test("source embedding retains crop dimensions and existing artwork", async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([200, 300]);
  page.drawRectangle({ x: 20, y: 30, width: 100, height: 180, color: rgb(0, 1, 0) });
  page.setCropBox(20, 30, 100, 180);
  const originalContents = page.node.Contents();
  const output = await PDFDocument.create();
  const embedded = await embedSourcePage(output, page);
  output.addPage([100, 180]).drawPage(embedded);
  assert.equal(embedded.width, 100);
  assert.equal(embedded.height, 180);
  assert.equal(page.node.Contents(), originalContents);
  assert.equal((await PDFDocument.load(await output.save())).getPageCount(), 1);
});
