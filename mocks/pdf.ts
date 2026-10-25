// A one-page PDF of plain text lines, enough for a viewer to show
// something that looks like the document the API would render.

export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  /** Space above the line. */
  gap?: number;
}

function latin1(text: string): string {
  return text
    .replace(/€/g, "\x80")
    .replace(/[–—]/g, "-")
    .replace(/[^\x00-\xff]/g, "?")
    .replace(/([\\()])/g, "\\$1");
}

export function textPdf(lines: PdfLine[]): Uint8Array {
  let y = 790;
  let stream = "BT\n";
  for (const line of lines) {
    const size = line.size ?? 10.5;
    y -= (line.gap ?? 0) + size + 5;
    stream += `/${line.bold ? "F2" : "F1"} ${size} Tf\n1 0 0 1 56 ${y} Tm\n(${latin1(line.text)}) Tj\n`;
  }
  stream += "ET\n";

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 6 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(pdf, (char) => char.charCodeAt(0) & 0xff);
}
