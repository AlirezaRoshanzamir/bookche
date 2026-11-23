// Some PDFs omit Contents for blank pages. Give the embedder an empty stream
// so those pages remain blank leaves instead of making the whole export fail.
export function embedSourcePage(document, page) {
  if (!page.node.Contents()) page.pushOperators();
  const crop = page.getCropBox();
  return document.embedPage(page, {
    left: crop.x,
    bottom: crop.y,
    right: crop.x + crop.width,
    top: crop.y + crop.height,
  });
}
