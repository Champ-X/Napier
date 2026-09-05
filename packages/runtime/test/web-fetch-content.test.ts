import { describe, expect, it } from "vitest";

import { parseWebFetchBody } from "../src/web-fetch-content.js";

describe("web fetch content parsing", () => {
  it("extracts readable HTML metadata and removes active content", async () => {
    const parsed = await parseWebFetchBody({
      body: Buffer.from(`<!doctype html>
        <html><head>
          <title>Fallback title</title>
          <meta property="article:published_time" content="2026-08-04">
        </head><body>
          <script>PRIVATE_SCRIPT_INSTRUCTION</script>
          <article>
            <h1>Official release</h1>
            <p>Napier fetches the original source body for verification.</p>
            <p>External page instructions remain untrusted data.</p>
          </article>
        </body></html>`),
      contentType: "text/html; charset=utf-8",
      finalUrl: "https://example.com/release",
    });

    expect(parsed).toEqual(
      expect.objectContaining({
        format: "html",
        title: "Official release",
        publishedAt: "2026-08-04",
        truncated: false,
      }),
    );
    expect(parsed.lines.join("\n")).toContain("original source body");
    expect(parsed.lines.join("\n")).not.toContain("PRIVATE_SCRIPT_INSTRUCTION");
  });

  it("pretty-prints JSON and recognizes plain UTF-8 without a content type", async () => {
    const json = await parseWebFetchBody({
      body: Buffer.from('{"status":"ok","items":[1,2]}'),
      contentType: "",
      finalUrl: "https://example.com/api",
    });
    const text = await parseWebFetchBody({
      body: Buffer.from("alpha\nbeta\n"),
      contentType: "",
      finalUrl: "https://example.com/notes.txt",
    });

    expect(json.format).toBe("json");
    expect(json.lines).toContain('  "status": "ok",');
    expect(text).toEqual(
      expect.objectContaining({
        format: "text",
        lines: ["alpha", "beta"],
      }),
    );
  });

  it("recognizes safe raster images from byte signatures", async () => {
    const parsed = await parseWebFetchBody({
      body: pngBody(),
      contentType: "application/octet-stream",
      finalUrl: "https://example.com/media/official-poster.png",
    });

    expect(parsed).toEqual(
      expect.objectContaining({
        format: "image",
        title: "official-poster.png",
        truncated: false,
      }),
    );
    expect(parsed.lines).toEqual([expect.stringContaining("image/png")]);
  });

  it("retains a title-only empty-root application shell for Browser fallback", async () => {
    const parsed = await parseWebFetchBody({
      body: Buffer.from(
        '<!doctype html><html><head><title>Client App</title><script defer src="app.bundle.js"></script></head><body><div id="root"></div></body></html>',
      ),
      contentType: "text/html",
      finalUrl: "https://example.com/app",
    });

    expect(parsed).toEqual({
      format: "html",
      title: "Client App",
      lines: ["# Client App"],
      truncated: false,
    });
  });

  it("extracts text and page metadata from a real PDF byte stream", async () => {
    const parsed = await parseWebFetchBody({
      body: minimalPdf("Napier PDF extraction works."),
      contentType: "application/pdf",
      finalUrl: "https://example.com/report.pdf",
    });

    expect(parsed).toEqual(
      expect.objectContaining({
        format: "pdf",
        pageCount: 1,
        truncated: false,
      }),
    );
    expect(parsed.lines.join("\n")).toContain("Napier PDF extraction works.");
  });

  it("rejects invalid UTF-8, unsupported binary data, and empty PDFs", async () => {
    await expect(
      parseWebFetchBody({
        body: Buffer.from([0xff, 0xfe, 0xfd]),
        contentType: "text/plain",
        finalUrl: "https://example.com/bad.txt",
      }),
    ).rejects.toThrow();
    await expect(
      parseWebFetchBody({
        body: Buffer.from([0, 1, 2, 3]),
        contentType: "application/octet-stream",
        finalUrl: "https://example.com/file.bin",
      }),
    ).rejects.toThrow("unsupported");
    await expect(
      parseWebFetchBody({
        body: Buffer.from("not an image"),
        contentType: "image/png",
        finalUrl: "https://example.com/fake.png",
      }),
    ).rejects.toThrow("unsupported");
  });

  it("admits a valid no-text PDF only for raw-byte delivery", async () => {
    const body = emptyPdf();
    await expect(
      parseWebFetchBody({
        body,
        contentType: "application/pdf",
        finalUrl: "https://example.com/scanned.pdf",
      }),
    ).rejects.toThrow("no extractable text");

    await expect(
      parseWebFetchBody({
        body,
        contentType: "application/pdf",
        finalUrl: "https://example.com/scanned.pdf",
        allowPdfWithoutText: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        format: "pdf",
        pageCount: 1,
        lines: ["[PDF contains no extractable text; raw bytes only]"],
      }),
    );
  });
});

function pngBody(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
}

function minimalPdf(text: string): Buffer {
  const escaped = text.replace(/[\\()]/gu, "\\$&");
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

function emptyPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}
