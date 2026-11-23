# Bookche

[Open Bookche](https://alirezaroshanzamir.github.io/bookche/)

A frontend-only studio for making miniature books from PDFs. Add your books, make their covers, lay out the sheets, and print or export a PDF. Everything stays in your browser. There is no server, account, analytics, or runtime CDN dependency.

## Run locally

Use Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open the local URL printed in the terminal. A small sample book is included so you can explore before adding your own PDFs.

```sh
npm test
npm run build
npm run preview
```

The finished static site is in `dist/`. Serve it over HTTP or HTTPS rather than opening `index.html` as a file.

## Put it on GitHub Pages

1. Push this project to your GitHub repository's `main` branch.
2. In the repository, open **Settings > Pages**.
3. Under **Build and deployment**, select **GitHub Actions** as the source.
4. Run the **Deploy Bookche to GitHub Pages** workflow in the Actions tab if the initial push ran before you enabled Pages.

The included workflow installs dependencies, runs the layout tests, builds the site, and publishes `dist/`. Vite uses relative asset paths, so both `username.github.io` repositories and project URLs such as `username.github.io/bookche/` work. If your default branch has another name, update the branch in `.github/workflows/pages.yml`.

No hosting secrets or environment variables are needed.

## Make a book

- **Add your PDFs**: select multiple PDFs or drop them onto the workbench. Each book gets independent settings. Use the checkbox on its card to exclude it from the print without removing it.
- **Pages**: the PDF ratio is detected from the first selected page, including its rotation. Use **Match PDF** or **Link width & height** to keep the artwork area in proportion, or use **PDF scale** to resize both dimensions by percentage. New books start linked. Existing projects retain their dimensions until you enable the link. You can still set finished dimensions independently with the link off, along with an inner content margin, page ranges, and row spacing. Dimensions are millimeters. Original PDF proportions are preserved, with no stretching or cropping. Page numbers refer to the PDF's physical page order, starting at 1.
- **Cover**: generate a cover, supply a complete wrap, or select front, spine, and back independently. A source can be a page in the book, an uploaded PDF page, a PNG, or a JPG. Unspecified pieces use the generated design. Separate pieces are assembled into a flat back/spine/front wrap. Overhang is added to all four edges of each cover panel.
- **Cutting**: choose tiny corner lines, filled squares, or no marks. Place them in any corner on all pages, odd/even pages, PDF page 1, or custom page ranges. You can also add a fine outline. Cover marks include small spine-fold ticks.
- **Number controls**: use the visible + / - buttons, type a value, or press Up / Down in a number field. The controls respect each setting's limits, including linked page sizes.
- **Sheet setup**: choose A5, A4, A3, US Letter, US Legal, or a custom sheet; orientation; safe printer margins; and print mode. Registration crosses and back-side offsets help with alignment.
- **Preview**: browse every sheet side, zoom, open the sheet overview, or click a piece to edit its book. The live preview draws only the sheet you are viewing, reusing cached page images as you change dimensions and spacing. New pages load progressively. Preview and export share millimeter geometry, artwork fitting, and cutting guides; the full vector PDF is built when you print or export.

Turn off **Include book pages** to make a cover-only miniature. Turn off **Include cover** for pages only.

## Single-sided and double-sided printing

Single-sided output places selected pages in reading order, left to right and top to bottom. Pages touch horizontally to form continuous strips; the row gap is configurable. Cut or fold the strips, or cut individual pages and glue blank backs together.

Double-sided output treats each adjacent pair in the selected range as a leaf. The first page goes on the front and the second on the reverse. Positions are mirrored for the chosen physical flip edge. Back artwork rotates where needed so the cut leaves read upright when turned like a book. This handles both orientations and both long- and short-edge printer settings. An unpaired last page has a blank back. Covers get blank backs, and blank sides are preserved in the output.

For example, `1-4, 9-10` produces leaves with pairs 1/2, 3/4, and 9/10. This is a cut-and-stack layout. It does not impose folded signatures or saddle-stitched booklets.

For manual duplex, export **Fronts only** and **Backs only** in separate passes. Test one sheet first: reinsertion direction and stack order depend on the printer. The back-side offsets are measured in the viewed back sheet's coordinates: positive X moves right, positive Y moves down.

## Print at the right size

Export PDF preserves the source PDF's vector text and graphics. Generated cover lettering is drawn at about 305 dpi so titles can use the browser's Unicode fonts. PNG/JPG cover artwork keeps its source resolution. The direct **Print** view uses 216 dpi images; use the exported PDF when you want the sharpest tiny text.

Choose the same paper size in the printer dialog, select **100% / Actual size**, disable fit/shrink, and turn off browser headers and footers. Use the matching duplex flip edge. A borderless printer may be needed for a zero sheet margin.

The **Calibration PDF** has a 20 mm square and a ruler. Duplex calibration adds a matching back. Measure it and hold the paper to the light to check alignment before using your good paper. Software can align positions exactly; a printer can still feed the paper slightly differently on each pass.

## Saving and privacy

Books, cover files, and settings are automatically saved in IndexedDB on the current browser and origin. **Save project** downloads a `.bookche` file containing everything. Older `.smallhours` backups still work. **Open** restores that portable backup and replaces the current workbench. Ctrl/Cmd + S also downloads a project.

Browser storage can be cleared or run out of space, so keep a project backup. The app reports local save failures. Files are limited to 100 MB each and projects to 200 MB of source assets; large or complex PDFs can still be limited by browser memory. Password-protected/encrypted PDFs must be unlocked before import.

Use a recent Chrome, Edge, Firefox, or Safari. If your browser does not support opening the print dialog, download the PDF and print it in your usual PDF viewer. No physical printer was used during development; run the calibration on yours.

## Source map

- `src/layout.js`: millimeter geometry, ranges, packing, duplex transformations, output filtering.
- `src/pdf.js`: source embedding, cover artwork, PDF export, calibration.
- `src/preview.js` and `src/preview-cache.js`: progressive visible-sheet rendering and bounded page-image caching.
- `src/render-geometry.js` and `src/cover.js`: artwork fitting, guides, and cover lettering shared by preview and export.
- `src/sizing.js`: PDF aspect ratios, linked dimensions, percentage scaling, and number increments.
- `src/storage.js`: IndexedDB and portable project validation.
- `src/main.js`: workbench UI, files, preview, printing, and project actions.
- `tests/layout.test.js`: layout and project-validation regression tests.
- `tests/preview.test.js`: cache reuse, concurrency, stale work, eviction, and shared drawing geometry.
- `tests/sizing.test.js`: linked dimensions, percentage scales, margins, rotation, and number-picker limits.

Built with Vite, pdf-lib, and PDF.js. DM Sans and Instrument Serif are bundled locally. Third-party license notices are included in `public/licenses/`.

The size link uses the most common page shape in the selected range, so a differently sized cover does not add white edges to every body page. For existing books, click **Match PDF** to apply the reference. Content margin and row spacing are separate controls. PDFs with mixed shapes still fit within one finished page size, preserving artwork without cropping.

Edit **Cover > Back cover text** to replace the generated back-cover message. Line breaks are preserved and long text wraps to fit; clear the field for a blank back. Uploaded artwork keeps its own lettering.

Book cards contain the editable title, duplicate/remove buttons, and Pages/Cover checkboxes. Unchecked parts have disabled settings tabs. For generated covers, **Spine text** can use the book title, custom text, or no text. Edition lettering is no longer printed.
