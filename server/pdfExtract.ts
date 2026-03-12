/**
 * PDF text extraction — décompression zlib des streams FlateDecode + extraction texte.
 * Zéro dépendance externe, fonctionne sur tous les environnements.
 */
import { inflateSync } from "zlib";

function hexToText(hex: string): string {
  let result = "";
  const clean = hex.replace(/\s/g, "");
  for (let i = 0; i < clean.length - 1; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (code >= 32 && code < 127) result += String.fromCharCode(code);
    else if (code >= 0xC0) result += String.fromCharCode(code); // latin1 éàü...
    else if (code > 0) result += " ";
  }
  return result.replace(/\s+/g, " ").trim();
}

function extractStringsFromStream(decoded: string): string[] {
  const parts: string[] = [];
  const btBlocks = decoded.match(/BT[\s\S]{0,8000}?ET/g) || [];
  for (const block of btBlocks) {
    // Format 1 : chaînes entre parenthèses (Tj)
    const parenStrings = block.match(/\(([^)\\]|\\.)*\)/g) || [];
    for (const s of parenStrings) {
      const cleaned = s.slice(1, -1)
        .replace(/\\n/g, " ").replace(/\\r/g, " ").replace(/\\t/g, " ")
        .replace(/\\\(/g, "(").replace(/\\\)/g, ")")
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").trim();
      if (cleaned.length > 0) parts.push(cleaned);
    }
    // Format 2 : chaînes hex entre <> dans TJ
    const tjBlocks = block.match(/\[[\s\S]*?\]\s*TJ/g) || [];
    for (const tj of tjBlocks) {
      const hexStrings = tj.match(/<([0-9a-fA-F]+)>/g) || [];
      const words: string[] = [];
      for (const h of hexStrings) {
        const text = hexToText(h.slice(1, -1));
        if (text.length > 0) words.push(text);
      }
      if (words.length > 0) parts.push(words.join(""));
    }
  }
  return parts;
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const allParts: string[] = [];

  // Trouver tous les streams dans le PDF
  let pos = 0;
  const raw = buffer;
  const streamMarker = Buffer.from("stream");
  const endstreamMarker = Buffer.from("endstream");

  while (pos < raw.length) {
    const streamStart = raw.indexOf(streamMarker, pos);
    if (streamStart === -1) break;

    // Sauter le marqueur "stream" + CRLF ou LF
    let dataStart = streamStart + 6;
    if (raw[dataStart] === 13) dataStart++; // CR
    if (raw[dataStart] === 10) dataStart++; // LF

    const streamEnd = raw.indexOf(endstreamMarker, dataStart);
    if (streamEnd === -1) break;

    const streamData = raw.slice(dataStart, streamEnd);

    // Chercher si ce stream est FlateDecode dans le dict précédent
    const dictRegion = raw.slice(Math.max(0, streamStart - 500), streamStart).toString("latin1");
    const isFlate = dictRegion.includes("FlateDecode") || dictRegion.includes("Fl ");

    if (isFlate) {
      try {
        const decompressed = inflateSync(streamData);
        const text = decompressed.toString("latin1");
        const parts = extractStringsFromStream(text);
        allParts.push(...parts);
      } catch {
        // stream non décompressable, ignorer
      }
    } else {
      // Stream non compressé — essayer directement
      const text = streamData.toString("latin1");
      if (text.includes("BT") && text.includes("ET")) {
        const parts = extractStringsFromStream(text);
        allParts.push(...parts);
      }
    }

    pos = streamEnd + 9;
  }

  const result = allParts.join(" ").replace(/\s+/g, " ").trim();
  return result || "Texte non extractible";
}
