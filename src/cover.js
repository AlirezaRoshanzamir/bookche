function wrapText(text, max = 18) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if ((line + " " + word).trim().length > max && line) {
      lines.push(line);
      line = "";
    }
    line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 5);
}
export function makeCoverLettering(
  text,
  width,
  height,
  ink,
  role,
  subtitle = "",
  scale = 12,
) {
  // Browser fonts preserve non-Latin book titles as well as Latin text.
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (role === "front") {
    const lines = wrapText(text, 16),
      size = Math.min(width * 0.14, height * 0.09);
    ctx.font = `italic ${size}px Georgia, serif`;
    lines.forEach((line, i) => {
      ctx.fillText(
        line,
        width / 2,
        height * 0.42 + (i - (lines.length - 1) / 2) * size * 1.25,
        width * 0.78,
      );
    });
    ctx.font = `${width * 0.043}px system-ui, sans-serif`;
    ctx.fillText(subtitle, width / 2, height * 0.84, width * 0.82);
  } else if (role === "spine") {
    ctx.translate(width / 2, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = `${Math.min(width * 0.5, 2)}px Georgia, serif`;
    ctx.fillText(text, 0, 0, height * 0.83);
  } else {
    ctx.font = `${width * 0.065}px Georgia, serif`;
    ctx.fillText("A little world.", width / 2, height * 0.46);
    ctx.fillText("Yours to make.", width / 2, height * 0.53);
  }
  return canvas;
}
