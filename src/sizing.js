// PDF dimensions describe the visible crop box, with page rotation applied.
export function displayedPageSize(width, height, rotation = 0) {
  return Math.abs(rotation % 180) === 90
    ? { width: height, height: width }
    : { width, height };
}

export function validPageSize(size) {
  return (
    !!size &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
}

export function scaleLimits(book, source) {
  if (!validPageSize(source)) return { min: 0.1, max: 100 };
  const border = book.margin * 2;
  return {
    min:
      Math.max(
        0.001,
        (5 - border) / source.width,
        (5 - border) / source.height,
      ) * 100,
    max:
      Math.min((300 - border) / source.width, (400 - border) / source.height) *
      100,
  };
}

export function pdfScale(book, source) {
  return validPageSize(source)
    ? Math.min(
        (book.width - book.margin * 2) / source.width,
        (book.height - book.margin * 2) / source.height,
      ) * 100
    : 100;
}

function fitScale(book, source, scale, margin = book.margin) {
  const limits = scaleLimits({ ...book, margin }, source);
  const fitted = Math.max(limits.min, Math.min(limits.max, scale * 100)) / 100;
  const round = (value) => Number(value.toFixed(6));
  return {
    ...book,
    margin,
    width: round(source.width * fitted + margin * 2),
    height: round(source.height * fitted + margin * 2),
  };
}

export function resizeBook(book, key, value, source) {
  if (!validPageSize(source))
    return key === "pdfScale" ? book : { ...book, [key]: value };
  if (key === "pdfScale")
    return { ...fitScale(book, source, value / 100), lockAspectRatio: true };
  if (key === "lockAspectRatio") {
    const next = { ...book, lockAspectRatio: value };
    return value
      ? fitScale(next, source, (book.width - book.margin * 2) / source.width)
      : next;
  }
  if (!book.lockAspectRatio) return { ...book, [key]: value };
  if (key === "margin")
    return fitScale(book, source, pdfScale(book, source) / 100, value);
  if (key === "width" || key === "height")
    return fitScale(book, source, (value - book.margin * 2) / source[key]);
  return { ...book, [key]: value };
}

export function ratioLabel(source) {
  if (!validPageSize(source)) return "";
  const round = (value) => Number(value.toFixed(3));
  return source.width >= source.height
    ? `${round(source.width / source.height)} : 1`
    : `1 : ${round(source.height / source.width)}`;
}

export function stepNumber(value, direction, step, min, max) {
  return Math.min(
    max,
    Math.max(min, Number((value + direction * step).toFixed(6))),
  );
}
