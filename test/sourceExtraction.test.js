import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { extractSourceFile } from "../src/episodeSources.js";

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);

function fileFromBytes(bytes, name, type) {
  return new File([bytes], name, { type });
}

function makePdfFixture() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    "<< /Length 44 >>\nstream\nBT /F1 18 Tf 20 80 Td (Fixture PDF text) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(pdf);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

test("extracts text and markdown fixtures", async () => {
  const text = fileFromBytes(await fs.readFile(fixture("source.txt")), "source.txt", "text/plain");
  const markdown = fileFromBytes(await fs.readFile(fixture("source.md")), "source.md", "text/markdown");
  assert.match((await extractSourceFile(text)).text, /Weekly huddle transcript/);
  assert.match((await extractSourceFile(markdown)).text, /Privacy review/);
});

test("extracts a browser-compatible PDF fixture and preserves original bytes", async () => {
  const bytes = makePdfFixture();
  const result = await extractSourceFile(fileFromBytes(bytes, "fixture.pdf", "application/pdf"));
  assert.match(result.text, /Fixture PDF text/);
  assert.equal(result.original.byteLength, bytes.byteLength);
});

test("extracts a DOCX fixture", async () => {
  const fixturePath = new URL("../node_modules/mammoth/test/test-data/single-paragraph.docx", import.meta.url);
  const result = await extractSourceFile(fileFromBytes(await fs.readFile(fixturePath), "fixture.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
  assert.ok(result.text.length > 0);
});

test("clearly rejects empty, unsupported, and corrupted fixtures", async () => {
  const empty = fileFromBytes(await fs.readFile(fixture("empty.txt")), "empty.txt", "text/plain");
  const unsupported = fileFromBytes(await fs.readFile(fixture("unsupported.rtf")), "unsupported.rtf", "application/rtf");
  const corrupt = fileFromBytes(await fs.readFile(fixture("corrupt.pdf")), "corrupt.pdf", "application/pdf");
  await assert.rejects(() => extractSourceFile(empty), /no extractable text/i);
  await assert.rejects(() => extractSourceFile(unsupported), /unsupported source type/i);
  await assert.rejects(() => extractSourceFile(corrupt), /could not be extracted/i);
});
