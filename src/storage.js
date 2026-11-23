import { validPageSize } from "./sizing.js";
import { defaultSettings, makeBook } from "./layout.js";
// Keep the original storage key so existing local projects survive the rename.
const DB = "small-hours-studio";
export function openStorage() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("projects");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadLocal() {
  const db = await openStorage();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction("projects")
        .objectStore("projects")
        .get("current");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function saveLocal(project) {
  const db = await openStorage();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("projects", "readwrite");
      tx.objectStore("projects").put(project, "current");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Storage unavailable"));
    });
  } finally {
    db.close();
  }
}
function base64(bytes) {
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 16384)
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 16384)));
  return btoa(chunks.join(""));
}
export function encodeProject(state) {
  return JSON.stringify({
    version: 1,
    settings: state.settings,
    books: state.books,
    assets: Object.fromEntries(
      Object.entries(state.assets).map(([id, a]) => [
        id,
        { ...a, bytes: base64(a.bytes) },
      ]),
    ),
  });
}
const finite = (v, lo, hi, fallback) =>
  Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi
    ? Number(v)
    : fallback;
const oneOf = (v, values, fallback) => (values.includes(v) ? v : fallback);
const text = (v, limit = 200) =>
  typeof v === "string" ? v.slice(0, limit) : "";
const hex = (v) => (/^#[0-9a-f]{6}$/i.test(v || "") ? v : "#354c45");
export function normalizeProject(data, encoded = false) {
  if (
    data?.version !== 1 ||
    !Array.isArray(data.books) ||
    !data.assets ||
    typeof data.assets !== "object" ||
    data.books.length > 100
  )
    throw new Error("This is not a valid Bookche project.");
  const assets = Object.create(null);
  let total = 0;
  for (const [id, item] of Object.entries(data.assets)) {
    if (!["application/pdf", "image/png", "image/jpeg"].includes(item.mime))
      throw new Error("The project contains an unsupported file type.");
    let bytes;
    if (encoded) {
      if (typeof item.bytes !== "string" || item.bytes.length > 140000000)
        throw new Error("A file in this project is too large.");
      bytes = Uint8Array.from(atob(item.bytes), (c) => c.charCodeAt(0));
    } else bytes = new Uint8Array(item.bytes);
    total += bytes.length;
    if (total > 200000000)
      throw new Error("Projects must be smaller than 200 MB.");
    const pageSizes = Array.isArray(item.pageSizes)
      ? item.pageSizes.map((size) =>
          validPageSize(size) && size.width <= 100000 && size.height <= 100000
            ? { width: size.width, height: size.height }
            : null,
        )
      : [];
    assets[id] = {
      id,
      name: text(item.name),
      bytes,
      mime: item.mime,
      pageSizes,
      pageCount: finite(item.pageCount, 1, 100000, 1),
    };
  }
  const s = data.settings || {},
    settings = {
      ...defaultSettings(),
      paper: oneOf(
        s.paper,
        ["A3", "A4", "A5", "Letter", "Legal", "Custom"],
        "A4",
      ),
      orientation: oneOf(s.orientation, ["portrait", "landscape"], "portrait"),
      mode: oneOf(s.mode, ["single", "duplex"], "single"),
      flip: oneOf(s.flip, ["long", "short"], "long"),
      output: oneOf(s.output, ["all", "front", "back"], "all"),
      customWidth: finite(s.customWidth, 40, 1200, 210),
      customHeight: finite(s.customHeight, 40, 1200, 297),
      sheetMargin: finite(s.sheetMargin, 0, 100, 10),
      backOffsetX: finite(s.backOffsetX, -20, 20, 0),
      backOffsetY: finite(s.backOffsetY, -20, 20, 0),
      registration: !!s.registration,
    };
  const ids = new Set();
  const books = data.books.map((item) => {
    if (
      !assets[item.assetId] ||
      assets[item.assetId].mime !== "application/pdf" ||
      ids.has(item.id)
    )
      throw new Error("A book PDF is missing or a book ID is duplicated.");
    ids.add(item.id);
    const b = makeBook(
        text(item.id),
        text(item.title) || "Untitled book",
        item.assetId,
        assets[item.assetId].pageCount,
      ),
      c = item.cover || {};
    for (const [key, low, high] of [
      ["width", 5, 300],
      ["height", 5, 400],
      ["margin", 0, 30],
      ["rowGap", 0, 50],
      ["columnGap", 0, 50],
    ])
      b[key] = finite(item[key], low, high, b[key]);
    // Existing projects keep their exact dimensions until the link is enabled.
    b.lockAspectRatio = item.lockAspectRatio === true;
    b.includePages = item.includePages !== false;
    b.hidden = !!item.hidden;
    b.border = !!item.border;
    b.ranges = text(item.ranges, 3000);
    b.marks = oneOf(item.marks, ["none", "corners", "square"], "corners");
    b.markCorner = oneOf(
      item.markCorner,
      ["all", "tl", "tr", "bl", "br"],
      "all",
    );
    b.markPages = oneOf(
      item.markPages,
      ["all", "first", "odd", "even", "custom"],
      "all",
    );
    b.markRanges = text(item.markRanges, 3000);
    Object.assign(b.cover, {
      enabled: c.enabled !== false,
      mode: oneOf(c.mode, ["generated", "wrap", "separate"], "generated"),
      spine: finite(c.spine, 0, 30, 3),
      overhang: finite(c.overhang, 0, 10, 0.5),
      color: hex(c.color),
      ink: hex(c.ink || "#f7edd6"),
      gradient: c.gradient !== false,
      subtitle: text(c.subtitle, 48),
      backText:
        typeof c.backText === "string"
          ? text(c.backText, 500)
          : b.cover.backText,
    });
    for (const key of ["front", "back", "spineSource", "wrap"]) {
      const input = c[key];
      if (
        !input ||
        input.type === "generated" ||
        (input.type === "asset" && !input.assetId)
      )
        continue;
      const aid = input.type === "book" ? b.assetId : input.assetId;
      if (!assets[aid])
        throw new Error("A cover asset is missing from this project.");
      b.cover[key] = {
        type: oneOf(input.type, ["book", "asset"], "generated"),
        ...(input.type === "asset" ? { assetId: aid } : {}),
        page: finite(input.page, 1, assets[aid].pageCount, 1),
      };
    }
    return b;
  });
  return { version: 1, books, assets, settings };
}
