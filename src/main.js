import "./style.css";
import { createSheetPreview } from "./preview.js";
import { hasArtwork } from "./render-geometry.js";
import { icon } from "./icons.js";
import {
  computeLayout,
  defaultSettings,
  makeBook,
  paperSize,
  parseRanges,
  outputFaces,
} from "./layout.js";
import {
  buildPdf,
  calibrationPdf,
  createDemoAsset,
  inspectPdfDetails,
} from "./pdf.js";
import {
  encodeProject,
  loadLocal,
  normalizeProject,
  saveLocal,
} from "./storage.js";
import * as pdfjs from "pdfjs-dist";
import {
  validPageSize,
  pageReference,
  resizeBook,
  ratioLabel,
  pdfScale,
  scaleLimits,
  stepNumber,
} from "./sizing.js";

const $ = (s, root = document) => root.querySelector(s);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const uid = () => crypto.randomUUID();
let state = { version: 1, settings: defaultSettings(), books: [], assets: {} };
let selected = null,
  inspectorTab = "pages",
  inspectorMode = "book",
  faceIndex = 0,
  zoom = 1,
  revision = 0;
let layout,
  exportCache,
  exportJob,
  saveTimer,
  previewTimer,
  busy = false,
  storageOkay = true;
const livePreview = createSheetPreview();
const app = $("#app");
app.innerHTML = `
<header class="app-header">
  <a class="brand" href="./" aria-label="Bookche home"><span class="brand-symbol">${icon("book")}</span><span><strong>bookche<span class="brand-period">.</span></strong><small>MINIATURE BOOK STUDIO</small></span></a>

  <nav class="header-actions" aria-label="Project actions">
    <span class="save-status" id="save-status">${icon("check")} <span>Saved on this device</span></span>
    <button class="btn subtle" data-action="open-project" title="Open a saved Bookche project">${icon("folder")}<span>Open</span></button>
    <button class="btn subtle" data-action="save-project">${icon("download")}<span>Save project</span></button>
    <button class="icon-btn help-button" data-action="help" aria-label="How to make a miniature book">${icon("help")}</button>
  </nav>
</header>
<div class="workspace">
  <aside class="library" aria-label="Book library">
    <div class="library-heading"><h1>Books<span id="book-count">0</span></h1></div>
    <button class="upload-zone" id="upload-zone" data-action="add-books">${icon("plus")}<strong>Add your PDFs</strong><span>Choose files or drop them here</span></button>
    <div class="library-label"><span>IN THIS PROJECT</span><button class="text-btn" data-action="add-sample" title="Add the sample book">Try a sample</button></div>
    <div class="book-list" id="book-list"></div>
    <div class="library-footer"><div class="privacy-note"><span class="privacy-icon" aria-hidden="true">${icon("shield")}</span><strong>Files stay on your device</strong></div><button class="text-btn" data-action="help">Help</button></div>
  </aside>
  <main class="studio">
    <div class="studio-heading"><h2>Print layout</h2><button class="btn sheet-button" data-action="sheet-setup">${icon("settings")} Sheet setup</button></div>
    <div class="sheet-summary" id="sheet-summary"></div>
    <div class="preview-toolbar"><div class="preview-title">${icon("eye")} <strong>Preview</strong></div><div class="zoom-controls"><button class="icon-btn" data-action="zoom-out" aria-label="Zoom out">${icon("minus")}</button><button class="text-btn" data-action="zoom-reset" id="zoom-label">Fit</button><button class="icon-btn" data-action="zoom-in" aria-label="Zoom in">${icon("plus")}</button></div></div>
    <div id="layout-messages" class="layout-messages" aria-live="polite"></div>
    <div class="preview-stage" id="preview-stage"><div class="sheet-scene" id="sheet-scene"><div class="dimension horizontal" id="paper-width"></div><div class="dimension vertical"><span id="paper-height"></span></div><div class="paper" id="paper"><canvas id="preview-canvas" aria-label="Print sheet preview"></canvas><div id="piece-overlays"></div><div class="preview-loading" id="preview-loading"><span class="spinner"></span><span>Loading preview...</span></div></div></div><div class="empty-preview" id="empty-preview" hidden><span class="empty-icon">${icon("book")}</span><h3>Add a book</h3><p>Add a PDF or try the sample.</p><button class="btn primary" data-action="add-books">${icon("plus")} Add a PDF</button><button class="text-btn" data-action="add-sample">Try the sample book</button></div></div>
    <div class="preview-pagination"><span id="preview-info"></span><div class="page-navigation"><button class="icon-btn" data-action="prev-face" aria-label="Previous sheet side">${icon("left")}</button><span id="face-label">Sheet 1</span><button class="icon-btn" data-action="next-face" aria-label="Next sheet side">${icon("chevron")}</button></div><button class="text-btn" data-action="all-sheets">${icon("grid")} All sheets</button></div>
    <div class="print-bar"><div class="print-total"><span class="print-icon">${icon("file")}</span><div><strong id="output-total">No sheets</strong><small id="output-detail">Add a PDF to begin.</small></div></div><div class="print-actions"><button class="btn" data-action="print" id="print-btn">${icon("print")} Print</button><button class="btn primary" data-action="export" id="export-btn">${icon("download")} Export PDF</button></div></div>
    <div class="scale-note">${icon("info")} Print at <strong>100% / Actual size</strong>. Turn off page scaling and headers.</div>
  </main>
  <aside class="inspector" id="inspector" aria-label="Book settings"></aside>
</div>
<input id="pdf-input" type="file" accept="application/pdf,.pdf" multiple hidden>
<input id="project-input" type="file" accept=".bookche,.smallhours,.json,application/json" hidden>
<input id="cover-input" type="file" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" hidden>
<dialog id="modal"><div id="modal-content"></div></dialog>
<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>`;

function bookNow() {
  return state.books.find((b) => b.id === selected);
}
function selectedPages(book) {
  try {
    return book.includePages
      ? parseRanges(book.ranges, book.pageCount).length
      : 0;
  } catch {
    return 0;
  }
}
function selectionLabel(book) {
  const count = selectedPages(book);
  return `${count} page${count === 1 ? "" : "s"} selected`;
}
const option = (v, label, chosen) =>
  `<option value="${esc(v)}" ${chosen === v ? "selected" : ""}>${esc(label)}</option>`;
function selectField(
  label,
  key,
  value,
  values,
  target = "book",
  rebuild = false,
) {
  return `<label class="field"><span>${label}</span><select aria-label="${esc(label)}" data-target="${target}" data-key="${key}" ${rebuild ? "data-rebuild" : ""}>${values.map((v) => option(v[0], v[1], value)).join("")}</select></label>`;
}
function numberField(
  label,
  key,
  value,
  min,
  max,
  step = 0.5,
  target = "book",
  suffix = "mm",
) {
  const id = `number-${target}-${key.replaceAll(".", "-")}`;
  return `<div class="field number-field"><label for="${id}">${label}</label><div class="number-wrap"><button type="button" class="number-step" data-action="step-number" data-direction="-1" aria-label="Decrease ${esc(label)}">${icon("minus")}</button><div class="number-value"><input id="${id}" type="number" aria-label="${esc(label)}" data-target="${target}" data-key="${key}" value="${esc(value)}" min="${min}" max="${max}" step="${step}" inputmode="decimal"><span class="number-unit">${suffix}</span></div><button type="button" class="number-step" data-action="step-number" data-direction="1" aria-label="Increase ${esc(label)}">${icon("plus")}</button></div></div>`;
}
function toggle(
  label,
  description,
  key,
  checked,
  target = "book",
  rebuild = true,
) {
  return `<label class="toggle-row"><span><strong>${label}</strong>${description ? `<small>${description}</small>` : ""}</span><input type="checkbox" class="switch" data-target="${target}" data-key="${key}" ${checked ? "checked" : ""} ${rebuild ? "data-rebuild" : ""}></label>`;
}
function section(title, content, caption = "") {
  return `<section class="settings-section"><h3>${title}</h3>${caption ? `<p class="section-caption">${caption}</p>` : ""}${content}</section>`;
}
function renderLibrary() {
  $("#book-count").textContent = state.books.length;
  $("#book-list").innerHTML = state.books.length
    ? state.books
        .map(
          (b, index) => `<article class="book-card ${selected === b.id && inspectorMode === "book" ? "selected" : ""} ${b.hidden ? "excluded" : ""}" data-book-card="${esc(b.id)}">
      <div class="book-card-top"><button class="book-select" data-action="select-book" data-id="${esc(b.id)}" aria-label="Edit ${esc(b.title)}" aria-pressed="${selected === b.id}"><span class="mini-book" style="--book-color:${esc(b.cover.color)};--book-ink:${esc(b.cover.ink)}"><span>${esc(b.title)}</span></span></button>
      <div class="book-card-text"><input class="book-title-input" type="text" maxlength="160" data-book-title="${esc(b.id)}" aria-label="Book title" value="${esc(b.title)}"><small class="book-source" title="${esc(state.assets[b.assetId]?.name)}">${esc(state.assets[b.assetId]?.name)}</small><small>${b.pageCount} pages / ${displayNumber(b.width)} x ${displayNumber(b.height)} mm</small></div></div>
      <div class="book-card-actions"><label><input type="checkbox" data-include-book="${esc(b.id)}" ${!b.hidden ? "checked" : ""}> Include in print</label><span><button class="icon-btn" data-action="duplicate-book" data-id="${esc(b.id)}" aria-label="Duplicate ${esc(b.title)}" title="Duplicate book">${icon("copy")}</button><button class="icon-btn danger" data-action="delete-book" data-id="${esc(b.id)}" aria-label="Remove ${esc(b.title)}" title="Remove book">${icon("trash")}</button></span></div>
      <div class="book-card-bottom"><label><input type="checkbox" data-book-part="pages" data-book-id="${esc(b.id)}" aria-label="Pages for ${esc(b.title)}" ${b.includePages ? "checked" : ""} ${b.hidden ? "disabled" : ""}> Pages</label><label><input type="checkbox" data-book-part="cover" data-book-id="${esc(b.id)}" aria-label="Cover for ${esc(b.title)}" ${b.cover.enabled ? "checked" : ""} ${b.hidden ? "disabled" : ""}> Cover</label><span class="book-reorder" role="group" aria-label="Book order"><button class="icon-btn" data-action="move-book" data-id="${esc(b.id)}" data-direction="-1" aria-label="Move ${esc(b.title)} up" title="Move up" ${index === 0 ? "disabled" : ""}>${icon("up")}</button><button class="icon-btn" data-action="move-book" data-id="${esc(b.id)}" data-direction="1" aria-label="Move ${esc(b.title)} down" title="Move down" ${index === state.books.length - 1 ? "disabled" : ""}>${icon("down")}</button></span></div>
    </article>`,
        )
        .join("")
    : `<div class="empty-library">No books added.</div>`;
}
function renderInspector() {
  const el = $("#inspector"),
    book = bookNow();
  if (inspectorMode === "sheet") {
    renderSheetInspector();
    syncNumberPickers();
    return;
  }
  if (!book) {
    el.innerHTML = `<div class="inspector-empty">${icon("settings")}<h3>Book settings</h3><p>Add or select a book to adjust its pages, cover, and cutting guides.</p><button class="btn" data-action="sheet-setup">Sheet setup</button></div>`;
    return;
  }
  const tabDisabled = (tab) =>
    book.hidden ||
    (tab === "pages"
      ? !book.includePages
      : tab === "cover"
        ? !book.cover.enabled
        : false);
  if (!book.hidden && tabDisabled(inspectorTab))
    inspectorTab = book.includePages
      ? "pages"
      : book.cover.enabled
        ? "cover"
        : "cutting";
  el.innerHTML = `<div class="inspector-tabs" role="tablist" aria-label="Book settings">${[
    ["pages", "Pages"],
    ["cover", "Cover"],
    ["cutting", "Cutting"],
  ]
    .map(
      ([tab, label]) =>
        `<button role="tab" aria-selected="${inspectorTab === tab}" ${tabDisabled(tab) ? "disabled" : ""} data-action="inspector-tab" data-tab="${tab}" class="${inspectorTab === tab ? "active" : ""}">${label}</button>`,
    )
    .join(
      "",
    )}</div><div class="inspector-content" role="tabpanel"><fieldset class="book-settings-fields" aria-label="Book print settings" ${book.hidden ? "disabled" : ""}>${inspectorTab === "pages" ? pagesPanel(book) : inspectorTab === "cover" ? coverPanel(book) : cuttingPanel(book)}</fieldset></div>`;
  syncSizingControls();
}
const displayNumber = (value) => Number(value.toFixed(2));
function bookReference(book) {
  return pageReference(book, state.assets[book.assetId]?.pageSizes);
}
function pagePresetValue(book) {
  return (
    ["20x28", "25x35", "30x42", "40x56"].find((value) => {
      const [w, h] = value.split("x").map(Number);
      return (
        Math.abs(book.width - w) < 0.00001 &&
        (book.lockAspectRatio || Math.abs(book.height - h) < 0.00001)
      );
    }) || "custom"
  );
}
function proportionSummary(book) {
  const source = bookReference(book);
  if (!source) return "";
  return `<div class="proportion-reference"><div class="proportion-summary"><span class="ratio-page" style="aspect-ratio:${source.width}/${source.height}">${icon("file")}</span><div><strong>PDF ratio <span>${ratioLabel(source)}</span></strong><small>Page ${source.page} / ${displayNumber(source.width)} x ${displayNumber(source.height)} mm</small></div><button class="text-btn" data-action="match-pdf-size">Match PDF</button></div>${source.mixed ? `<p class="field-help">Mixed PDF page shapes. Page ${source.page} matches ${source.matches} of ${source.total} selected pages. Match PDF fits this common shape; other shapes may keep white edges.</p>` : ""}</div>`;
}
function proportionControls(book) {
  return (
    proportionSummary(book) +
    toggle(
      "Link width & height",
      "Keep PDF proportions.",
      "lockAspectRatio",
      book.lockAspectRatio,
    )
  );
}
function scaleControl(book) {
  const source = bookReference(book);
  if (!source) return "";
  const limits = scaleLimits(book, source),
    scale = displayNumber(pdfScale(book, source));
  return `${numberField("PDF scale", "pdfScale", scale, 0.1, 10000, 0.5, "book", "%")}<input class="scale-slider" type="range" min="${limits.min}" max="${limits.max}" step="any" value="${scale}" data-target="book" data-key="pdfScale" aria-label="PDF scale slider"><p class="field-help scale-help">Scale relative to PDF page ${source.page}.</p>`;
}
function syncNumberPickers() {
  document.querySelectorAll(".number-wrap").forEach((picker) => {
    const input = picker.querySelector("input");
    const value = Number(input.value);
    picker.querySelectorAll(".number-step").forEach((button) => {
      let atMin = value <= Number(input.min),
        atMax = value >= Number(input.max);
      if (input.dataset.key === "pdfScale" && bookNow()) {
        const source = bookReference(bookNow());
        if (source) {
          const bounds = scaleLimits(bookNow(), source),
            scale = pdfScale(bookNow(), source);
          atMin = scale <= bounds.min + 0.00001;
          atMax = scale >= bounds.max - 0.00001;
        }
      }
      button.disabled = button.dataset.direction === "-1" ? atMin : atMax;
    });
  });
}
function syncCoverDimensions() {
  const book = bookNow(),
    label = $(".cover-schematic small");
  if (book && label) {
    const panelWidth = book.width + book.cover.overhang * 2;
    label.textContent = `${(panelWidth * 2 + book.cover.spine).toFixed(1)} x ${(book.height + book.cover.overhang * 2).toFixed(1)} mm unfolded`;
  }
}
function syncSizingControls(skip = null) {
  const book = bookNow();
  if (!book || inspectorMode !== "book") {
    syncNumberPickers();
    return;
  }
  const source = bookReference(book);
  const link = $('input[data-key="lockAspectRatio"]');
  if (link) link.checked = book.lockAspectRatio;
  for (const key of ["width", "height", "margin", "pdfScale"]) {
    const input = $(`input[type="number"][data-key="${key}"]`);
    if (!input) continue;
    if (key === "pdfScale" && !source) continue;
    if (key === "pdfScale") {
      const bounds = scaleLimits(book, source);
      input.min = Math.floor(bounds.min * 100) / 100;
      input.max = Math.ceil(bounds.max * 100) / 100;
    } else if (
      (key === "width" || key === "height") &&
      source &&
      book.lockAspectRatio
    ) {
      const bounds = scaleLimits(book, source);
      input.min = Number(
        ((source[key] * bounds.min) / 100 + book.margin * 2).toFixed(6),
      );
      input.max = Number(
        ((source[key] * bounds.max) / 100 + book.margin * 2).toFixed(6),
      );
    }
    if (input !== skip)
      input.value =
        key === "pdfScale"
          ? displayNumber(pdfScale(book, source))
          : displayNumber(book[key]);
  }
  const slider = $(".scale-slider");
  if (slider && source) {
    const bounds = scaleLimits(book, source);
    slider.min = bounds.min;
    slider.max = bounds.max;
    if (slider !== skip) slider.value = pdfScale(book, source);
  }
  const preset = $('select[data-key="sizePreset"]');
  if (preset) {
    preset.value = pagePresetValue(book);
    [...preset.options].slice(0, 4).forEach((option, i) => {
      const [width, height] = option.value.split("x");
      option.textContent = `${width}${book.lockAspectRatio ? " mm wide" : ` x ${height} mm`}`;
    });
  }
  const summary = $(".proportion-reference");
  if (summary) summary.outerHTML = proportionSummary(book);
  const scaleHelp = $(".scale-help");
  if (scaleHelp && source)
    scaleHelp.textContent = `Scale relative to PDF page ${source.page}.`;
  syncCoverDimensions();
  syncNumberPickers();
}
function applySizing(key, value, rebuild = false, skip = null) {
  state.books = state.books.map((book) =>
    book.id === selected
      ? resizeBook(book, key, value, bookReference(book))
      : book,
  );
  changed({ form: rebuild });
  syncSizingControls(skip);
}
function nudgeNumber(input, direction) {
  const next = stepNumber(
    Number(input.value || input.min),
    direction,
    Number(input.step),
    Number(input.min),
    Number(input.max),
  );
  input.value = next;
  handleField(input);
  syncNumberPickers();
}
function pagesPanel(b) {
  return (
    section(
      "Page range",
      `${b.includePages ? `<label class="field"><span>PDF page ranges <small>${b.pageCount} available</small></span><input type="text" data-key="ranges" data-target="book" value="${esc(b.ranges)}" placeholder="All pages, or 1-8, 12, 15-20" aria-describedby="range-help"></label><p class="field-help" id="range-help">Leave blank for all pages. Use PDF page numbers.</p><div class="info-pill">${icon("file")} ${selectionLabel(b)}</div>` : `<div class="tip-card">Just the cover. Perfect for a decorative miniature.</div>`}`,
    ) +
    section(
      "Dimensions",
      `${selectField(
        "Preset",
        "sizePreset",
        pagePresetValue(b),
        [
          ["20x28", b.lockAspectRatio ? "20 mm wide" : "20 x 28 mm"],
          ["25x35", b.lockAspectRatio ? "25 mm wide" : "25 x 35 mm"],
          ["30x42", b.lockAspectRatio ? "30 mm wide" : "30 x 42 mm"],
          ["40x56", b.lockAspectRatio ? "40 mm wide" : "40 x 56 mm"],
          ["custom", "Custom dimensions"],
        ],
        "book",
        true,
      )}${proportionControls(b)}<div class="field-pair">${numberField("Width", "width", b.width, 5, 300)}${numberField("Height", "height", b.height, 5, 400)}</div>${scaleControl(b)}${numberField("Content margin", "margin", b.margin, 0, 30, 0.1)}<p class="field-help">0 adds no padding. Margins in the PDF remain.</p>`,
    ) +
    section(
      "Spacing",
      `${toggle("Start on a new row", "When off, pages continue after the preceding content if there is room.", "pagesStartOnNewRow", b.pagesStartOnNewRow === true)}${numberField("Space between rows", "rowGap", b.rowGap, 0, 50, 0.5)}${state.settings.mode === "duplex" ? numberField("Space between pages", "columnGap", b.columnGap, 0, 50, 0.5) : `<div class="tip-card">${icon("scissors")}<p>Single-sided pages touch side by side.</p></div>`}`,
    ) +
    section(
      "Reading order",
      `<p class="field-help">${state.settings.mode === "duplex" ? "Fronts contain pages 1, 3, 5... Backs contain 2, 4, 6... mirrored behind the matching front. Cut into leaves and stack in reading order." : "Pages run left to right, then top to bottom. Cut into strips or individual pages. Glue blank backs together in reading order."}</p><button class="text-btn" data-action="sheet-setup">Change print mode</button>`,
    )
  );
}
function sourcePanel(b, key, label) {
  const s = b.cover[key],
    asset = s.type === "asset" ? state.assets[s.assetId] : null;
  const mode = s.type === "asset" ? "asset" : s.type;
  return `<div class="cover-source" role="group" aria-label="${esc(label)}">${selectField(
    "Source",
    `cover.${key}.type`,
    mode,
    [
      ["generated", "Generate a matching design"],
      ["book", "A page from this book PDF"],
      ["asset", "Upload an image or PDF"],
    ],
    "book",
    true,
  )}${s.type === "book" ? numberField("PDF page", `cover.${key}.page`, s.page || 1, 1, b.pageCount, 1, "book", "page") : ""}${s.type === "asset" ? `<button class="btn cover-upload" data-action="cover-upload" data-source="${key}">${icon("upload")} ${asset ? "Replace file" : "Choose file"}</button>${asset ? `<span class="asset-name">${esc(asset.name)}</span>${asset.mime === "application/pdf" ? numberField("PDF page", `cover.${key}.page`, s.page || 1, 1, asset.pageCount, 1, "book", "page") : ""}` : `<p class="field-help">PNG, JPG or PDF. Without a file, a matching design is generated.</p>`}` : ""}</div>`;
}
function coverPanel(b) {
  const c = b.cover,
    cw = b.width + c.overhang * 2;
  if (!c.enabled) return "";
  const separate = c.mode === "separate";
  const generatedWrap = c.mode !== "wrap" || !hasArtwork(c.wrap);
  const generatedFront = generatedWrap && (!separate || !hasArtwork(c.front));
  const generatedSpine =
    generatedWrap && c.spine > 0 && (!separate || !hasArtwork(c.spineSource));
  const generatedBack = generatedWrap && (!separate || !hasArtwork(c.back));
  const spineText = `${selectField(
    "Spine text",
    "cover.spineMode",
    c.spineMode,
    [
      ["title", "Book title"],
      ["custom", "Custom text"],
      ["none", "No text"],
    ],
    "book",
    true,
  )}${c.spineMode === "custom" ? `<label class="field"><span>Custom spine text</span><input type="text" maxlength="160" data-key="cover.spineText" data-target="book" value="${esc(c.spineText)}"></label>` : ""}`;
  const backText = `<label class="field"><span>Back cover text</span><textarea aria-label="Back cover text" rows="4" maxlength="500" data-key="cover.backText" data-target="book">${esc(c.backText)}</textarea></label><p class="field-help">Leave blank for no text.</p>`;
  return (
    (!b.includePages
      ? section(
          "Cover size",
          `${proportionControls(b)}<div class="field-pair">${numberField("Width", "width", b.width, 5, 300)}${numberField("Height", "height", b.height, 5, 400)}</div>`,
        )
      : "") +
    section(
      "Cover layout",
      `${toggle("Start on a new row", "When off, the cover continues after the preceding content if there is room.", "cover.startOnNewRow", c.startOnNewRow === true)}<div class="cover-schematic"><div style="background:${esc(c.color)};color:${esc(c.ink)}"><span>BACK</span><i></i><span>FRONT</span></div><small>${(cw * 2 + c.spine).toFixed(1)} x ${(b.height + c.overhang * 2).toFixed(1)} mm unfolded</small></div>${selectField(
        "Cover artwork",
        "cover.mode",
        c.mode,
        [
          ["generated", "Design a cover here"],
          ["wrap", "One full-wrap file"],
          ["separate", "Separate cover pieces"],
        ],
        "book",
        true,
      )}<div class="field-pair">${numberField("Spine width", "cover.spine", c.spine, 0, 30, 0.1)}${numberField("Overhang", "cover.overhang", c.overhang, 0, 10, 0.1)}</div><p class="field-help">Overhang adds to each edge of the front and back covers.</p>`,
    ) +
    (c.mode === "wrap"
      ? section(
          "Full-wrap artwork",
          sourcePanel(b, "wrap", "Full-wrap artwork"),
        )
      : "") +
    (separate
      ? section("Front cover", sourcePanel(b, "front", "Front cover"))
      : "") +
    (generatedWrap && c.spine > 0
      ? section(
          "Spine",
          `${separate ? sourcePanel(b, "spineSource", "Spine artwork") : ""}${generatedSpine ? spineText : ""}`,
        )
      : "") +
    (generatedWrap
      ? section(
          "Back cover",
          `${separate ? sourcePanel(b, "back", "Back cover artwork") : ""}${generatedBack ? backText : ""}`,
        )
      : "") +
    (generatedFront || generatedSpine || generatedBack
      ? section(
          "Colors",
          `<div class="field-pair"><label class="field"><span>Cover color</span><div class="color-field"><input type="color" data-key="cover.color" data-target="book" value="${esc(c.color)}"><span>${esc(c.color)}</span></div></label><label class="field"><span>Lettering</span><div class="color-field"><input type="color" data-key="cover.ink" data-target="book" value="${esc(c.ink)}"><span>${esc(c.ink)}</span></div></label></div><div class="swatches">${["#354c45", "#5146b9", "#87464f", "#263951", "#b07335", "#342e3a"].map((col) => `<button class="swatch ${c.color === col ? "active" : ""}" style="--swatch:${col}" data-action="cover-color" data-color="${col}" aria-label="Use cover color ${col}"></button>`).join("")}</div>${toggle("Soft gradient", "", "cover.gradient", c.gradient, "book", false)}<p class="field-help">Applies to generated pieces.</p>`,
        )
      : "")
  );
}
function cuttingPanel(b) {
  return (
    section(
      "Cutting guides",
      `${selectField(
        "Cut marks",
        "marks",
        b.marks,
        [
          ["none", "No marks"],
          ["corners", "Tiny corner lines"],
          ["square", "Tiny filled squares"],
        ],
        "book",
        true,
      )}${
        b.marks !== "none"
          ? `${selectField("Which corners?", "markCorner", b.markCorner, [
              ["all", "All four corners"],
              ["tl", "Top left"],
              ["tr", "Top right"],
              ["bl", "Bottom left"],
              ["br", "Bottom right"],
            ])}${selectField(
              "Which PDF pages?",
              "markPages",
              b.markPages,
              [
                ["all", "All included pages"],
                ["first", "PDF page 1 only"],
                ["odd", "Odd PDF page numbers"],
                ["even", "Even PDF page numbers"],
                ["custom", "Custom PDF page ranges"],
              ],
              "book",
              true,
            )}${b.markPages === "custom" ? `<label class="field"><span>Mark these PDF pages</span><input type="text" data-key="markRanges" data-target="book" value="${esc(b.markRanges || "")}" placeholder="1, 5-8, 12"></label>` : ""}<div class="cut-demo"><span class="cut-corner tl"></span><span class="cut-corner tr"></span>${icon("scissors")}<span class="cut-corner bl"></span><span class="cut-corner br"></span></div><p class="field-help">Lines are 0.65 mm long and 0.06 mm thick. Squares are 0.325 mm. Marks sit just inside the cut edge. Covers always receive the selected marks.</p>`
          : ""
      }${toggle("Fine outer border", "A 0.06 mm outline around each piece.", "border", b.border, "book", false)}`,
    ) +
    section(
      "Cover folds",
      `<p class="field-help">When cut marks are on, two tiny ticks at the spine edges show where to fold. The cover order is back, spine, front, from left to right.</p>`,
    ) +
    section(
      "Check your printer",
      `<div class="tip-card">${icon("info")}<p>A quick calibration print is the best way to check real size and duplex alignment.</p></div><button class="btn full" data-action="calibration">${icon("download")} Calibration PDF</button>`,
    )
  );
}
function renderSheetInspector() {
  const s = state.settings;
  $("#inspector").innerHTML =
    `<div class="inspector-head"><div class="inspector-title"><h2>Sheet setup</h2><button class="icon-btn" data-action="back-to-book" aria-label="Back to book details">${icon("close")}</button></div></div><div class="inspector-content">${section(
      "Paper",
      `${selectField(
        "Paper size",
        "paper",
        s.paper,
        [
          ["A5", "A5 - 148 x 210 mm"],
          ["A4", "A4 - 210 x 297 mm"],
          ["A3", "A3 - 297 x 420 mm"],
          ["Letter", "US Letter - 8.5 x 11 in"],
          ["Legal", "US Legal - 8.5 x 14 in"],
          ["Custom", "Custom size"],
        ],
        "settings",
        true,
      )}${s.paper === "Custom" ? `<div class="field-pair">${numberField("Width", "customWidth", s.customWidth, 40, 1200, 1, "settings")}${numberField("Height", "customHeight", s.customHeight, 40, 1200, 1, "settings")}</div>` : ""}<div class="segmented" role="group" aria-label="Paper orientation">${["portrait", "landscape"].map((v) => `<button data-action="orientation" data-value="${v}" class="${s.orientation === v ? "active" : ""}"><span class="orientation-icon ${v}"></span>${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</div>${numberField("Safe sheet margin", "sheetMargin", s.sheetMargin, 0, 100, 0.5, "settings")}`,
    )}${section(
      "Print mode",
      `<div class="mode-choices">${[
        ["single", "Single-sided", "Continuous rows. Glue blank backs."],
        ["duplex", "Double-sided", "Paired leaves. Print front and back."],
      ]
        .map(
          ([v, title, detail]) =>
            `<button class="mode-choice ${s.mode === v ? "active" : ""}" data-action="print-mode" data-value="${v}"><span class="radio-dot"></span><span><strong>${title}</strong><small>${detail}</small></span></button>`,
        )
        .join("")}</div>${
        s.mode === "duplex"
          ? selectField(
              "Printer flip edge",
              "flip",
              s.flip,
              [
                ["long", "Flip on long edge"],
                ["short", "Flip on short edge"],
              ],
              "settings",
            ) +
            `<p class="field-help">Choose the same flip edge in your printer dialog. Positions mirror across that physical edge. Back artwork also rotates when needed so cut leaves read upright.</p>` +
            selectField(
              "Export / print sides",
              "output",
              s.output,
              [
                ["all", "Both sides - front, back, front, back"],
                ["front", "Fronts only - manual duplex pass 1"],
                ["back", "Backs only - manual duplex pass 2"],
              ],
              "settings",
            ) +
            `<p class="field-help">For manual duplex, test your tray's reinsertion order with one sheet first. Blank cover backs are kept.</p>`
          : ""
      }`,
    )}${s.mode === "duplex" ? section("Back alignment", `<div class="field-pair">${numberField("Back shift X", "backOffsetX", s.backOffsetX, -20, 20, 0.1, "settings")}${numberField("Back shift Y", "backOffsetY", s.backOffsetY, -20, 20, 0.1, "settings")}</div><p class="field-help">Positive X moves right; positive Y moves down, as viewed on the back sheet. These compensate for printer alignment.</p>`) : ""}${section("Sheet guides", `${toggle("Cutting grid", "Faint dots in empty areas. Included in print/PDF.", "cuttingGrid", s.cuttingGrid, "settings")}${s.cuttingGrid ? numberField("Grid spacing", "gridSpacing", s.gridSpacing, 2, 20, 1, "settings") : ""}`)}${section("Calibration", `${toggle("Registration crosses", "Small crosses 5 mm from sheet corners.", "registration", s.registration, "settings", false)}<button class="btn full" data-action="calibration">${icon("download")} Calibration PDF</button><p class="field-help">Includes a 20 mm square and a ruler. Duplex calibration includes a matching back.</p>`)}</div>`;
}
function activeProject() {
  const ids = new Set(state.books.map((b) => b.assetId));
  state.books.forEach((b) =>
    Object.values(b.cover).forEach((s) => {
      if (s?.type === "asset" && s.assetId) ids.add(s.assetId);
    }),
  );
  return {
    ...state,
    assets: Object.fromEntries(
      Object.entries(state.assets).filter(([id]) => ids.has(id)),
    ),
  };
}
let toastTimer, undoRemove;
function toast(message, isError = false, undo = false) {
  clearTimeout(toastTimer);
  const el = $("#toast");
  el.hidden = false;
  el.className = `toast ${isError ? "error" : ""}`;
  el.innerHTML = `${icon(isError ? "info" : "check")}<span>${esc(message)}</span>${undo ? '<button data-action="undo-remove">Undo</button>' : ""}<button class="icon-btn" data-action="dismiss-toast" aria-label="Dismiss notification">${icon("close")}</button>`;
  toastTimer = setTimeout(
    () => (el.hidden = true),
    isError ? 10000 : undo ? 10000 : 4500,
  );
}
function setSaveStatus(text, good = true) {
  $("#save-status").innerHTML =
    `${icon(good ? "check" : "info")}<span>${esc(text)}</span>`;
}
function persist() {
  setSaveStatus("Saving on this device...");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await saveLocal(activeProject());
      setSaveStatus("Saved on this device");
      storageOkay = true;
    } catch {
      setSaveStatus("Local save unavailable", false);
      if (storageOkay)
        toast(
          "Browser storage is unavailable or full. Use Save project to keep your work.",
          true,
        );
      storageOkay = false;
    }
  }, 550);
}
function changed({ form = false, library = true } = {}) {
  revision++;
  livePreview.cancel();
  persist();
  if (library) renderLibrary();
  if (form) renderInspector();
  refreshLayout();
  cancelAnimationFrame(previewTimer);
  previewTimer = requestAnimationFrame(() =>
    updatePreview().catch(showPreviewError),
  );
}
function refreshLayout() {
  layout = computeLayout(state.books, state.settings);
  faceIndex = Math.max(0, Math.min(faceIndex, layout.faces.length - 1));
  const s = state.settings,
    duplex = s.mode === "duplex";
  $("#sheet-summary").innerHTML =
    `<button data-action="sheet-setup">${icon("file")}<span>${s.paper === "Custom" ? `${layout.width} x ${layout.height} mm` : esc(s.paper)} <span class="muted">/ ${s.orientation}</span></span></button><span class="summary-divider"></span><button data-action="sheet-setup">${icon("copy")} ${duplex ? "Double-sided" : "Single-sided"}</button><span class="summary-divider"></span><button data-action="sheet-setup"><span class="margin-icon"></span> ${s.sheetMargin} mm safe margin</button>`;
  $("#layout-messages").innerHTML = [
    ...layout.errors.map(
      (t) =>
        `<div class="layout-error">${icon("info")}<span>${esc(t)}</span></div>`,
    ),
    ...layout.warnings.map(
      (t) =>
        `<div class="layout-warning">${icon("info")}<span>${esc(t)}</span></div>`,
    ),
  ].join("");
  const enabled = state.books.filter(
      (b) => !b.hidden && (b.includePages || b.cover.enabled),
    ),
    pieces = layout.sheets.reduce(
      (n, sheet) => n + sheet.front.length + sheet.back.length,
      0,
    );
  const output = outputFaces(layout, s);
  $("#output-total").textContent = layout.sheets.length
    ? `${layout.sheets.length} sheet${layout.sheets.length === 1 ? "" : "s"}, ${pieces} piece${pieces === 1 ? "" : "s"}`
    : "No sheets";
  $("#output-detail").textContent = layout.sheets.length
    ? `${enabled.length} book${enabled.length === 1 ? "" : "s"} / ${output.length} printed side${output.length === 1 ? "" : "s"}${duplex && s.output !== "all" ? ` / ${s.output}s only` : ""}`
    : "Add a PDF or try a sample to begin.";
  $("#empty-preview").hidden = layout.faces.length > 0;
  $("#sheet-scene").hidden = layout.faces.length === 0;
  for (const button of [$("#print-btn"), $("#export-btn")])
    button.disabled = busy || !layout.faces.length || !!layout.errors.length;
  if (!layout.faces.length || layout.errors.length) {
    $("#preview-loading").hidden = true;
    livePreview.cancel();
  }
  $("#paper-width").textContent = `${layout.width} mm`;
  $("#paper-height").textContent = `${layout.height} mm`;
  updateFaceLabels();
  resizePreview();
}
function updateFaceLabels() {
  const face = layout.faces[faceIndex];
  $("#face-label").textContent = face
    ? `Sheet ${face.sheet + 1}${state.settings.mode === "duplex" ? ` / ${face.side === "front" ? "Front" : "Back"}` : ""}`
    : "No sheets yet";
  $("#preview-info").textContent = face
    ? `${face.pieces.length} piece${face.pieces.length === 1 ? "" : "s"} on this side`
    : "No preview";
  $('[data-action="prev-face"]').disabled = !face || faceIndex === 0;
  $('[data-action="next-face"]').disabled =
    !face || faceIndex >= layout.faces.length - 1;
}
function resizePreview() {
  if (!layout?.faces.length) return;
  const stage = $("#preview-stage"),
    scene = $("#sheet-scene");
  const fit = Math.min(
    Math.max(160, stage.clientWidth - 100) / layout.width,
    Math.max(260, stage.clientHeight - 74) / layout.height,
  );
  const w = layout.width * fit * zoom,
    h = layout.height * fit * zoom;
  scene.style.width = `${w}px`;
  scene.style.height = `${h}px`;
  stage.classList.toggle("zoomed", zoom > 1);
  $("#zoom-label").textContent =
    zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`;
}
async function ensurePdf() {
  if (exportCache?.revision === revision) return exportCache;
  if (exportJob?.revision === revision) return exportJob.promise;
  const rev = revision,
    project = {
      books: [...state.books],
      assets: state.assets,
      settings: { ...state.settings, output: "all" },
    },
    currentLayout = layout;
  const promise = (async () => {
    const bytes = await buildPdf(
      project.books,
      project.assets,
      project.settings,
      currentLayout,
    );
    const result = { revision: rev, bytes };
    if (rev === revision) exportCache = result;
    return result;
  })();
  exportJob = { revision: rev, promise };
  try {
    return await promise;
  } finally {
    if (exportJob?.revision === rev) exportJob = null;
  }
}
function showPreviewError(error) {
  if (error?.name === "RenderingCancelledException") return;
  $("#preview-loading").hidden = true;
  $("#layout-messages").innerHTML =
    `<div class="layout-error">${icon("info")}<span>${esc(error.message || "Could not render this PDF. Try another file.")}</span></div>`;
}
async function updatePreview() {
  if (!layout.faces.length || layout.errors.length) return;
  livePreview.render(
    $("#preview-canvas"),
    state.books,
    state.assets,
    state.settings,
    layout,
    layout.faces[faceIndex],
    (pending, error) => {
      $("#preview-loading").hidden = !pending;
      $("#preview-loading span:last-child").textContent =
        `Loading ${pending} page${pending === 1 ? "" : "s"}...`;
      if (error) showPreviewError(error);
    },
  );
  renderOverlays();
  updateFaceLabels();
}
function renderOverlays() {
  const face = layout.faces[faceIndex];
  $("#piece-overlays").innerHTML = face
    ? face.pieces
        .map(
          (p) =>
            `<button class="piece-overlay" data-action="select-book" data-id="${esc(p.bookId)}" style="left:${(p.x / layout.width) * 100}%;top:${(p.y / layout.height) * 100}%;width:${(p.width / layout.width) * 100}%;height:${(p.height / layout.height) * 100}%" aria-label="${esc(p.title)} - ${p.kind === "cover" ? "cover" : `PDF page ${p.page}`}"><span>${esc(p.title)}<small>${p.kind === "cover" ? "Back / spine / front" : `PDF page ${p.page}`}</small></span></button>`,
        )
        .join("")
    : "";
}
function setBookPath(book, key, value) {
  const next = structuredClone(book),
    parts = key.split(".");
  let at = next;
  for (const part of parts.slice(0, -1)) at = at[part];
  at[parts.at(-1)] = value;
  return next;
}
function editBook(key, value, rebuild = false, id = selected) {
  state.books = state.books.map((b) =>
    b.id === id ? setBookPath(b, key, value) : b,
  );
  changed({ form: rebuild });
}
function selectBook(id, keepLibrary = false) {
  selected = id;
  inspectorMode = "book";
  if (keepLibrary) {
    document.querySelectorAll("[data-book-card]").forEach((card) => {
      const active = card.dataset.bookCard === id;
      card.classList.toggle("selected", active);
      card.querySelector(".book-select").setAttribute("aria-pressed", String(active));
    });
  } else renderLibrary();
  renderInspector();
}
app.addEventListener("focusin", (event) => {
  const id = event.target.dataset.bookTitle;
  if (id && (selected !== id || inspectorMode !== "book")) selectBook(id, true);
});
function handleField(field, isInput = false) {
  if (field.dataset.bookTitle) {
    const id = field.dataset.bookTitle;
    if (selected !== id || inspectorMode !== "book") {
      selected = id;
      inspectorMode = "book";
      renderInspector();
      document.querySelectorAll("[data-book-card]").forEach((card) => {
        card.classList.toggle("selected", card.dataset.bookCard === id);
        card
          .querySelector(".book-select")
          .setAttribute("aria-pressed", String(card.dataset.bookCard === id));
      });
    }
    state.books = state.books.map((b) =>
      b.id === id ? { ...b, title: field.value.trim() || "Untitled book" } : b,
    );
    const book = state.books.find((b) => b.id === id),
      card = field.closest(".book-card");
    card.querySelector(".mini-book > span").textContent = book.title;
    card
      .querySelector('[data-book-part="pages"]')
      .setAttribute("aria-label", `Pages for ${book.title}`);
    card
      .querySelector('[data-book-part="cover"]')
      .setAttribute("aria-label", `Cover for ${book.title}`);
    card
      .querySelector('[data-action="duplicate-book"]')
      .setAttribute("aria-label", `Duplicate ${book.title}`);
    card
      .querySelector('[data-action="delete-book"]')
      .setAttribute("aria-label", `Remove ${book.title}`);
    card
      .querySelector(".book-select")
      .setAttribute("aria-label", `Edit ${book.title}`);
    for (const direction of [-1, 1])
      card.querySelector(`[data-action="move-book"][data-direction="${direction}"]`)
        .setAttribute("aria-label", `Move ${book.title} ${direction === -1 ? "up" : "down"}`);
    if (!isInput) field.value = book.title;
    changed({ library: false });
    return;
  }
  if (field.dataset.bookPart) {
    selected = field.dataset.bookId;
    inspectorMode = "book";
    editBook(
      field.dataset.bookPart === "pages" ? "includePages" : "cover.enabled",
      field.checked,
      true,
      selected,
    );
    return;
  }

  if (field.dataset.includeBook) {
    editBook("hidden", !field.checked, true, field.dataset.includeBook);
    return;
  }
  if (!field.dataset.key) return;
  const key = field.dataset.key;
  let value =
    field.type === "checkbox"
      ? field.checked
      : ["number", "range"].includes(field.type)
        ? Number(field.value)
        : field.value;
  if (["number", "range"].includes(field.type)) {
    if (
      isInput &&
      (field.value === "" ||
        !Number.isFinite(value) ||
        value < Number(field.min) ||
        value > Number(field.max))
    )
      return;
    if (field.value === "" || !Number.isFinite(value)) {
      toast("Enter a number for this setting.", true);
      renderInspector();
      return;
    }
    value = Math.min(Number(field.max), Math.max(Number(field.min), value));
    if (/^cover\.(front|back|spineSource|wrap)\.page$/.test(key)) {
      value = Math.trunc(value);
      field.value = value;
    }
    if (!isInput) field.value = value;
  }
  if (field.dataset.target === "settings") {
    state.settings = { ...state.settings, [key]: value };
    changed({ form: field.hasAttribute("data-rebuild") });
    syncNumberPickers();
  } else if (
    ["width", "height", "margin", "pdfScale", "lockAspectRatio"].includes(key)
  ) {
    applySizing(key, value, key === "lockAspectRatio", isInput ? field : null);
  } else if (key === "sizePreset") {
    if (value === "custom") return;
    const [width, height] = value.split("x").map(Number);
    state.books = state.books.map((b) =>
      b.id === selected
        ? b.lockAspectRatio
          ? resizeBook(b, "width", width, bookReference(b))
          : { ...b, width, height }
        : b,
    );
    changed({ form: true });
  } else if (/^cover\..+\.type$/.test(key)) {
    const sourceKey = key.split(".")[1];
    editBook(
      `cover.${sourceKey}`,
      { type: value, ...(value === "book" ? { page: 1 } : {}) },
      true,
    );
  } else {
    if (key === "title") value = value.trim() || "Untitled book";
    const spineVisibilityChanged =
      key === "cover.spine" && bookNow().cover.spine > 0 !== value > 0;
    const restoreSpineFocus =
      spineVisibilityChanged && document.activeElement === field;
    editBook(
      key,
      value,
      field.hasAttribute("data-rebuild") || spineVisibilityChanged,
    );
    if (restoreSpineFocus) $('input[data-key="cover.spine"]')?.focus();
    if (key === "cover.spine" || key === "cover.overhang") syncCoverDimensions();
    if (key === "cover.color" || key === "cover.ink") {
      const label = field.parentElement.querySelector("span");
      if (label) label.textContent = value;
    }
    if (key === "ranges") {
      const current = bookNow();
      if (!isInput) {
        try {
          parseRanges(current.ranges, current.pageCount);
          if (current.lockAspectRatio) applySizing("width", current.width);
          else syncSizingControls();
        } catch {
          /* The layout shows the range validation message. */
        }
      }
      const pill = $(".info-pill");
      if (pill) pill.innerHTML = `${icon("file")} ${selectionLabel(bookNow())}`;
    }
  }
}
app.addEventListener("change", (event) => {
  handleField(event.target);
  syncNumberPickers();
});
app.addEventListener("input", (event) => {
  if (
    ["text", "textarea", "number", "color", "range"].includes(
      event.target.type,
    ) &&
    (event.target.dataset.key || event.target.dataset.bookTitle)
  ) {
    handleField(event.target, true);
    syncNumberPickers();
  }
});
app.addEventListener("keydown", (event) => {
  const input = event.target;
  if (input.type === "number" && ["ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    nudgeNumber(input, event.key === "ArrowUp" ? 1 : -1);
  }
});
let coverRequest;
function pickCover(key) {
  coverRequest = { bookId: selected, key };
  $("#cover-input").value = "";
  $("#cover-input").click();
}
async function readAsset(file, cover = false) {
  if (file.size > 100000000)
    throw new Error(`${file.name} is too large. The limit is 100 MB per file.`);
  const ext = file.name.split(".").pop().toLowerCase();
  const mime =
    ext === "pdf" || file.type === "application/pdf"
      ? "application/pdf"
      : ext === "png"
        ? "image/png"
        : ["jpg", "jpeg"].includes(ext)
          ? "image/jpeg"
          : "";
  if (!mime || (!cover && mime !== "application/pdf"))
    throw new Error(
      "Choose a PDF book, or a PNG, JPG or PDF for cover artwork.",
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  let pageCount = 1,
    pageSizes = [];
  if (mime === "application/pdf") {
    try {
      ({ pageCount, pageSizes } = await inspectPdfDetails(bytes));
    } catch (error) {
      throw new Error(
        `Cannot open ${file.name}. Use a valid PDF without password protection. ${error.message?.includes("encrypted") ? "This file is encrypted." : ""}`,
      );
    }
  } else {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
    bitmap.close();
  }
  const currentBytes = Object.values(activeProject().assets).reduce(
    (sum, a) => sum + a.bytes.length,
    0,
  );
  if (currentBytes + bytes.length > 200000000)
    throw new Error(
      "This project would exceed 200 MB. Start a separate project for more books.",
    );
  return { id: uid(), name: file.name, mime, bytes, pageCount, pageSizes };
}
async function addBooks(files) {
  if (!files.length) return;
  setSaveStatus("Opening PDFs...");
  let added = 0;
  for (const file of files) {
    try {
      const asset = await readAsset(file);
      state.assets[asset.id] = asset;
      const book = makeBook(
        uid(),
        file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " "),
        asset.id,
        asset.pageCount,
      );
      const colors = ["#354c45", "#5146b9", "#87464f", "#263951", "#b07335"];
      Object.assign(
        book,
        resizeBook(book, "lockAspectRatio", true, bookReference(book)),
      );
      book.cover.color = colors[state.books.length % colors.length];
      state.books = [...state.books, book];
      selected = book.id;
      added++;
    } catch (error) {
      toast(error.message, true);
    }
  }
  if (added) {
    inspectorMode = "book";
    inspectorTab = "pages";
    changed({ form: true });
    if (added === files.length)
      toast(`${added} book${added === 1 ? "" : "s"} added. `);
  } else
    setSaveStatus(
      storageOkay ? "Saved on this device" : "Local save unavailable",
      storageOkay,
    );
}
$("#pdf-input").addEventListener("change", async (event) => {
  await addBooks([...event.target.files]);
  event.target.value = "";
});
$("#cover-input").addEventListener("change", async (event) => {
  const request = coverRequest,
    file = event.target.files[0];
  event.target.value = "";
  if (!file || !request) return;
  try {
    const asset = await readAsset(file, true);
    state.assets[asset.id] = asset;
    editBook(
      `cover.${request.key}`,
      { type: "asset", assetId: asset.id, page: 1 },
      true,
      request.bookId,
    );
    toast("Cover artwork added.");
  } catch (error) {
    toast(error.message, true);
  }
});
$("#project-input").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 280000000)
      throw new Error("This project is too large to open.");
    const project = normalizeProject(JSON.parse(await file.text()), true);
    for (const asset of Object.values(project.assets))
      if (asset.mime === "application/pdf")
        Object.assign(asset, await inspectPdfDetails(asset.bytes));
    project.books.forEach(
      (b) => (b.pageCount = project.assets[b.assetId].pageCount),
    );
    state = project;
    selected = state.books[0]?.id;
    inspectorMode = "book";
    faceIndex = 0;
    zoom = 1;
    changed({ form: true });
    toast("Project opened.");
  } catch (error) {
    toast(`Could not open this project. ${error.message}`, true);
  }
  event.target.value = "";
});
let dragDepth = 0;
document.addEventListener("dragenter", (e) => {
  if (e.dataTransfer?.types.includes("Files")) {
    e.preventDefault();
    dragDepth++;
    $("#upload-zone").classList.add("dragover");
  }
});
document.addEventListener("dragover", (e) => {
  if (e.dataTransfer?.types.includes("Files")) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
});
document.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $("#upload-zone").classList.remove("dragover");
  }
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("#upload-zone").classList.remove("dragover");
  if (e.dataTransfer?.files.length) addBooks([...e.dataTransfer.files]);
});
function download(bytes, filename, mime = "application/pdf") {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime })),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function withBusy(task) {
  if (busy) return;
  busy = true;
  $(".workspace").inert = true;
  $(".header-actions").inert = true;
  refreshLayout();
  try {
    await task();
  } catch (error) {
    toast(error.message || "Something went wrong. Please try again.", true);
  } finally {
    busy = false;
    $(".workspace").inert = false;
    $(".header-actions").inert = false;
    refreshLayout();
  }
}
async function exportBytes() {
  if (layout.errors.length) throw new Error(layout.errors[0]);
  const current = await ensurePdf();
  if (current.revision !== revision) return exportBytes();
  return state.settings.mode === "duplex" && state.settings.output !== "all"
    ? buildPdf(state.books, state.assets, state.settings, layout)
    : current.bytes;
}
async function printProject() {
  if (busy || !layout.faces.length || layout.errors.length) return;
  let ready = false;
  await withBusy(async () => {
    toast("Preparing print sheets. This can take a moment for large books.");
    const bytes = await exportBytes();
    const printDoc = await pdfjs.getDocument({
      data: bytes.slice(),
      isEvalSupported: false,
    }).promise;
    $("#print-root")?.remove();
    $("#print-style")?.remove();
    const root = document.createElement("div");
    root.id = "print-root";
    root.setAttribute("aria-hidden", "true");
    document.body.append(root);
    try {
      const firstPage = await printDoc.getPage(1),
        size = firstPage.getViewport({ scale: 1 });
      const w = (size.width * 25.4) / 72,
        h = (size.height * 25.4) / 72;
      const style = document.createElement("style");
      style.id = "print-style";
      style.textContent = `#print-root{display:none}@media print{@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0!important;padding:0!important;background:white!important}body>*:not(#print-root){display:none!important}#print-root{display:block!important;width:${w}mm}#print-root img{display:block;width:${w}mm;height:${h}mm;margin:0;break-after:page;break-inside:avoid}#print-root img:last-child{break-after:auto}}`;
      document.head.append(style);
      for (let n = 1; n <= printDoc.numPages; n++) {
        const page = await printDoc.getPage(n),
          viewport = page.getViewport({ scale: 3 }),
          canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
          transform: [
            canvas.width / viewport.width,
            0,
            0,
            canvas.height / viewport.height,
            0,
            0,
          ],
        }).promise;
        const image = document.createElement("img");
        image.alt = `Print side ${n}`;
        image.src = canvas.toDataURL("image/png");
        root.append(image);
        await image.decode();
        canvas.width = 0;
        canvas.height = 0;
      }
      ready = true;
    } catch (error) {
      root.remove();
      $("#print-style")?.remove();
      throw error;
    } finally {
      await printDoc.destroy();
    }
  });
  if (ready) {
    toast(
      "Print sheets are ready. Choose Actual size and the matching paper settings.",
    );
    window.print();
  }
}
window.addEventListener("afterprint", () => {
  $("#print-root")?.remove();
  $("#print-style")?.remove();
});
function openModal(html, wide = false) {
  $("#modal-content").innerHTML =
    `<div class="modal-top"><span class="eyebrow">BOOKCHE</span><button class="icon-btn" data-action="close-modal" aria-label="Close dialog">${icon("close")}</button></div>${html}`;
  const heading = $("#modal-content h2");
  if (heading) {
    heading.id = "modal-title";
    $("#modal").setAttribute("aria-labelledby", "modal-title");
  }
  $("#modal").classList.toggle("wide", wide);
  $("#modal").showModal();
}
function showHelp() {
  openModal(
    `<h2>How to use Bookche</h2><p class="modal-intro"></p><div class="guide-steps"><article><span>${icon("upload")}</span><div><h3>Add a PDF</h3><p>Add one or more PDFs. Set each book's finished page size, content margin, and page ranges. Turn off pages for a cover-only miniature.</p></div></article><article><span>${icon("book")}</span><div><h3>Set up the cover</h3><p>Generate a cover, upload a full wrap, or choose front, spine, and back separately. Any piece can use a page from your book or another PDF. Missing pieces get a matching design.</p></div></article><article><span>${icon("print")}</span><div><h3>Choose your paper</h3><p>In Sheet setup, choose your paper, orientation, and print mode. Single-sided layouts make continuous rows. Double-sided layouts put page pairs in the same physical position after flipping.</p></div></article><article><span>${icon("scissors")}</span><div><h3>Print and assemble</h3><p>Start with the calibration PDF. Print at 100% / Actual size with headers off. Cut using the tiny guides. For single-sided books, glue blank backs together. For double-sided books, cut leaves and stack them in reading order. Fold the cover around your stack.</p></div></article></div><div class="guide-note"><strong>A note on duplex printing</strong><p>Match the flip edge in the app and printer. Real printers can drift, so check one sheet first. The back offsets compensate for consistent alignment errors. Fronts and backs can also be exported separately for manual duplex.</p></div><div class="guide-note"><strong>Storage and privacy</strong><p>Everything runs in your browser. PDFs, images, and settings are automatically saved on this device when browser storage is available. Save project downloads a portable backup with your files included. Clearing browser data removes local saves.</p></div><p class="field-help">Tip: click a piece in the preview to edit its book. Use Ctrl/Cmd + S to save your project.</p>`,
  );
}
function showAllSheets() {
  if (!layout.faces.length) {
    toast("Add a book to create your first sheet.");
    return;
  }
  openModal(
    `<h2>All sheets</h2><p class="modal-intro">${layout.sheets.length} paper sheet${layout.sheets.length === 1 ? "" : "s"} / ${layout.faces.length} sides in the layout. Click a side to preview it.</p><div class="sheet-grid">${layout.faces.map((face, i) => `<button class="sheet-thumbnail ${i === faceIndex ? "active" : ""}" data-action="jump-face" data-index="${i}"><span class="thumbnail-paper" style="aspect-ratio:${layout.width}/${layout.height}">${face.pieces.map((p) => `<i style="left:${(p.x / layout.width) * 100}%;top:${(p.y / layout.height) * 100}%;width:${(p.width / layout.width) * 100}%;height:${(p.height / layout.height) * 100}%;background:${p.kind === "cover" ? esc(state.books.find((b) => b.id === p.bookId).cover.color) : "#e8e5f5"}"></i>`).join("")}</span><strong>Sheet ${face.sheet + 1}${state.settings.mode === "duplex" ? ` / ${face.side}` : ""}</strong><small>${face.pieces.length ? `${face.pieces.length} pieces` : "Blank reverse - kept for alignment"}</small></button>`).join("")}</div>`,
    true,
  );
}
app.addEventListener("click", async (event) => {
  const card = event.target.closest("[data-book-card]");
  if (card && !event.target.closest("button, input, label, select, textarea, a")) {
    selectBook(card.dataset.bookCard);
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === "step-number") {
    nudgeNumber(
      button.closest(".number-wrap").querySelector("input"),
      Number(button.dataset.direction),
    );
    return;
  }
  if (action === "match-pdf-size") {
    applySizing("lockAspectRatio", true, true);
    return;
  }
  if (button.tagName === "A") event.preventDefault();
  if (action === "add-books") {
    $("#pdf-input").click();
    return;
  }
  if (action === "select-book") {
    selectBook(button.dataset.id);
    return;
  }
  if (action === "inspector-tab") {
    inspectorTab = button.dataset.tab;
    renderInspector();
    return;
  }
  if (action === "sheet-setup") {
    inspectorMode = "sheet";
    renderLibrary();
    renderInspector();
    return;
  }
  if (action === "back-to-book") {
    inspectorMode = "book";
    renderLibrary();
    renderInspector();
    return;
  }
  if (action === "orientation" || action === "print-mode") {
    state.settings = {
      ...state.settings,
      [action === "orientation" ? "orientation" : "mode"]: button.dataset.value,
    };
    faceIndex = 0;
    changed({ form: true });
    return;
  }
  if (action === "cover-color") {
    editBook("cover.color", button.dataset.color, true);
    return;
  }
  if (action === "cover-upload") {
    pickCover(button.dataset.source);
    return;
  }
  if (action === "prev-face" || action === "next-face") {
    faceIndex += action === "next-face" ? 1 : -1;
    updateFaceLabels();
    updatePreview().catch(showPreviewError);
    return;
  }
  if (action.startsWith("zoom-")) {
    zoom =
      action === "zoom-reset"
        ? 1
        : Math.max(
            0.5,
            Math.min(
              3,
              Math.round((zoom + (action === "zoom-in" ? 0.25 : -0.25)) * 100) /
                100,
            ),
          );
    resizePreview();
    return;
  }
  if (action === "close-modal") {
    $("#modal").close();
    return;
  }
  if (action === "help") {
    showHelp();
    return;
  }
  if (action === "all-sheets") {
    showAllSheets();
    return;
  }
  if (action === "jump-face") {
    faceIndex = Number(button.dataset.index);
    $("#modal").close();
    updateFaceLabels();
    updatePreview().catch(showPreviewError);
    return;
  }
  if (action === "dismiss-toast") {
    $("#toast").hidden = true;
    return;
  }
  if (action === "open-project") {
    $("#project-input").click();
    return;
  }
  if (action === "save-project") {
    await withBusy(async () => {
      download(
        encodeProject(activeProject()),
        `bookche-${new Date().toISOString().slice(0, 10)}.bookche`,
        "application/json",
      );
      toast("Project saved, with all PDFs and cover files included.");
    });
    return;
  }
  if (action === "export") {
    await withBusy(async () => {
      toast("Preparing your print-ready PDF...");
      const bytes = await exportBytes();
      download(
        bytes,
        `bookche-${state.settings.paper.toLowerCase()}-${state.settings.mode}${state.settings.mode === "duplex" && state.settings.output !== "all" ? `-${state.settings.output}s` : ""}.pdf`,
      );
      toast("PDF exported. Print at 100% / Actual size.");
    });
    return;
  }
  if (action === "print") {
    await printProject();
    return;
  }
  if (action === "calibration") {
    await withBusy(async () => {
      const [w, h] = paperSize(state.settings);
      download(
        await calibrationPdf(state.settings, w, h),
        "bookche-calibration.pdf",
      );
      toast(
        "Calibration ready. Print at actual size, then measure the square.",
      );
    });
    return;
  }
  if (action === "add-sample") {
    await withBusy(async () => {
      const asset = await createDemoAsset();
      state.assets[asset.id] = asset;
      const book = makeBook(uid(), "Quiet things", asset.id, asset.pageCount);
      Object.assign(
        book,
        resizeBook(book, "lockAspectRatio", true, bookReference(book)),
      );
      state.books = [...state.books, book];
      selected = book.id;
      inspectorMode = "book";
      inspectorTab = "pages";
      changed({ form: true });
      toast("Sample added.");
    });
    return;
  }
  if (action === "move-book") {
    const index = state.books.findIndex((b) => b.id === button.dataset.id),
      direction = Number(button.dataset.direction),
      destination = index + direction;
    if (index < 0 || destination < 0 || destination >= state.books.length) return;
    const books = [...state.books];
    [books[index], books[destination]] = [books[destination], books[index]];
    state.books = books;
    changed();
    const controls = [...document.querySelectorAll('[data-action="move-book"]')]
      .filter((control) => control.dataset.id === button.dataset.id);
    const next = controls.find((control) =>
      !control.disabled && Number(control.dataset.direction) === direction,
    ) || controls.find((control) => !control.disabled);
    next?.focus();
    return;
  }
  if (action === "duplicate-book") {
    const b = state.books.find((b) => b.id === button.dataset.id);
    if (!b) return;
    const copy = {
      ...structuredClone(b),
      id: uid(),
      title: `${b.title} - copy`,
    };
    state.books = [...state.books, copy];
    selected = copy.id;
    inspectorMode = "book";
    changed({ form: true });
    toast("Book duplicated.");
    return;
  }
  if (action === "delete-book") {
    const b = state.books.find((b) => b.id === button.dataset.id);
    if (!b) return;
    openModal(
      `<h2>Remove book?</h2><p class="modal-intro">Remove <strong>${esc(b.title)}</strong> from this project?</p><div class="dialog-actions"><button class="btn" data-action="close-modal" autofocus>Cancel</button><button class="btn danger" data-action="confirm-delete-book" data-id="${esc(b.id)}">Remove book</button></div>`,
    );
    return;
  }
  if (action === "confirm-delete-book") {
    const b = state.books.find((b) => b.id === button.dataset.id);
    $("#modal").close();
    if (!b) return;
    undoRemove = { book: b, index: state.books.indexOf(b) };
    state.books = state.books.filter((item) => item.id !== b.id);
    if (selected === b.id) selected = state.books[0]?.id;
    changed({ form: true });
    toast(`Removed ${b.title}.`, false, true);
    return;
  }
  if (action === "undo-remove" && undoRemove) {
    const { book, index } = undoRemove;
    state.books = [
      ...state.books.slice(0, index),
      book,
      ...state.books.slice(index),
    ];
    selected = book.id;
    undoRemove = null;
    changed({ form: true });
    toast("Book restored.");
  }
});
$("#modal").addEventListener("click", (event) => {
  if (event.target === $("#modal")) {
    const rect = event.target.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      event.target.close();
  }
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    $('[data-action="save-project"]').click();
  }
});
new ResizeObserver(() => resizePreview()).observe($("#preview-stage"));
async function init() {
  let restored = false;
  try {
    const saved = await loadLocal();
    if (saved) {
      state = normalizeProject(saved);
      restored = true;
    }
  } catch {
    storageOkay = false;
    setSaveStatus("Local save unavailable", false);
    toast(
      "Could not restore browser storage. You can open a downloaded project or start fresh.",
      true,
    );
  }
  if (!restored) {
    const asset = await createDemoAsset();
    state.assets[asset.id] = asset;
    const book = makeBook(uid(), "Quiet things", asset.id, asset.pageCount);
    Object.assign(
      book,
      resizeBook(book, "lockAspectRatio", true, bookReference(book)),
    );
    state.books = [book];
  }
  for (const asset of Object.values(state.assets)) {
    if (
      asset.mime === "application/pdf" &&
      (asset.pageSizes?.length !== asset.pageCount ||
        asset.pageSizes.some((size) => !validPageSize(size)))
    )
      Object.assign(asset, await inspectPdfDetails(asset.bytes));
  }
  selected = state.books[0]?.id;
  renderLibrary();
  renderInspector();
  refreshLayout();
  if (!restored) persist();
  await updatePreview();
}
init().catch(showPreviewError);
