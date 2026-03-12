/**
 * PDF text extraction — server-side using pdfjs-dist legacy build (no worker).
 */

// Polyfill DOMMatrix for pdfjs in Node.js
if (typeof globalThis.DOMMatrix === "undefined") {
  (globalThis as any).DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    static fromMatrix() { return new (globalThis as any).DOMMatrix(); }
    multiply() { return new (globalThis as any).DOMMatrix(); }
    translate() { return new (globalThis as any).DOMMatrix(); }
    scale() { return new (globalThis as any).DOMMatrix(); }
    rotate() { return new (globalThis as any).DOMMatrix(); }
    inverse() { return new (globalThis as any).DOMMatrix(); }
    transformPoint(p: any) { return p || { x: 0, y: 0, z: 0, w: 1 }; }
  };
}

let _pdfjsLib: any = null;

async function getPdfjs() {
  if (_pdfjsLib) return _pdfjsLib;

  const m = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
  const lib = m.default || m;

  // Use fake worker — import the worker source directly into main thread
  // This avoids any file path issues on Railway
  const workerModule = await import("pdfjs-dist/legacy/build/pdf.worker.mjs" as string);
  const workerSrc = workerModule.default || workerModule;
  lib.GlobalWorkerOptions.workerSrc = workerSrc;

  _pdfjsLib = lib;
  return lib;
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfjsLib = await getPdfjs();

  const uint8Array = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({
    data: uint8Array,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  });

  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const textParts: string[] = [];

  for (let i = 1; i <= Math.min(numPages, 10); i++) {
    try {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = (content.items as any[])
        .map((item: any) => (typeof item.str === "string" ? item.str : ""))
        .join(" ");
      textParts.push(pageText);
    } catch {
      // skip page on error
    }
  }

  return textParts.join("\n").trim();
}
