import type { Express } from "express";
import type { Server } from "http";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import PDFDocument from "pdfkit";
import { storage } from "./storage";
import { extractPdfText } from "./pdfExtract";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Seuls les fichiers PDF sont acceptés"));
  },
});

const anthropic = new Anthropic();

function getSessionId(req: any): string {
  return req.headers["x-visitor-id"] || "default-session";
}

async function extractInvoiceData(pdfText: string, fileName: string) {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Tu es un assistant comptable expert. Analyse ce texte extrait d'une facture PDF et extrais les informations suivantes.

Texte de la facture :
"""
${pdfText.substring(0, 3000)}
"""

Réponds UNIQUEMENT avec un objet JSON valide (sans markdown, sans commentaires) avec exactement ces champs :
{
  "clientName": "Nom complet du client ou bénéficiaire",
  "amount": 0.00,
  "date": "YYYY-MM-DD",
  "serviceType": "Type de prestation (ex: Soutien scolaire, Garde d'enfants, Aide ménagère, etc.)"
}

Si une information est manquante ou illisible, utilise ces valeurs par défaut :
- clientName: "Client inconnu"
- amount: 0
- date: "${new Date().getFullYear()}-01-01"  
- serviceType: "Prestation de service à la personne"

IMPORTANT: amount doit être un nombre décimal (ex: 150.00), pas une chaîne.`,
      },
    ],
  });

  const raw = message.content[0].type === "text" ? message.content[0].text : "{}";
  // Strip any markdown code blocks if present
  const cleaned = raw.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim();
  const data = JSON.parse(cleaned);

  return {
    clientName: String(data.clientName || "Client inconnu"),
    amount: parseFloat(data.amount) || 0,
    date: String(data.date || `${new Date().getFullYear()}-01-01`),
    serviceType: String(data.serviceType || "Prestation de service à la personne"),
  };
}

export async function registerRoutes(httpServer: Server, app: Express) {
  // ── GET /api/invoices ─────────────────────────────────────────────
  app.get("/api/invoices", (req, res) => {
    const sessionId = getSessionId(req);
    const invoices = storage.getInvoices(sessionId);
    res.json(invoices);
  });

  // ── POST /api/invoices/upload ─────────────────────────────────────
  app.post("/api/invoices/upload", upload.array("files", 50), async (req: any, res) => {
    const sessionId = getSessionId(req);
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "Aucun fichier reçu" });
    }

    const results = [];
    const errors = [];

    for (const file of files) {
      try {
        const pdfText = await extractPdfText(file.buffer);
        const extracted = await extractInvoiceData(pdfText, file.originalname);
        const year = parseInt(extracted.date.split("-")[0]) || new Date().getFullYear();

        const invoice = storage.createInvoice({
          sessionId,
          fileName: file.originalname,
          clientName: extracted.clientName,
          amount: extracted.amount,
          date: extracted.date,
          serviceType: extracted.serviceType,
          year,
        });

        results.push(invoice);
      } catch (err: any) {
        errors.push({ file: file.originalname, error: err.message });
      }
    }

    res.json({ success: results, errors });
  });

  // ── DELETE /api/invoices/:id ──────────────────────────────────────
  app.delete("/api/invoices/:id", (req, res) => {
    const sessionId = getSessionId(req);
    const id = parseInt(req.params.id);
    const deleted = storage.deleteInvoice(id, sessionId);
    if (!deleted) return res.status(404).json({ error: "Facture introuvable" });
    res.json({ deleted: id });
  });

  // ── DELETE /api/invoices ─────────────────────────────────────────
  app.delete("/api/invoices", (req, res) => {
    const sessionId = getSessionId(req);
    storage.clearInvoices(sessionId);
    res.json({ cleared: true });
  });

  // ── GET /api/attestations ────────────────────────────────────────
  app.get("/api/attestations", (req, res) => {
    const sessionId = getSessionId(req);
    const attestations = storage.getAttestations(sessionId);
    res.json(attestations);
  });

  // ── POST /api/attestations/generate ─────────────────────────────
  app.post("/api/attestations/generate", async (req: any, res) => {
    const sessionId = getSessionId(req);
    const {
      clientName, year,
      companyName = "", companyAddress = "", companySiret = "",
      companyPhone = "", companyEmail = "",
      intervenants = [],
    } = req.body;

    if (!clientName || !year) {
      return res.status(400).json({ error: "clientName et year sont requis" });
    }

    const invoices = storage.getInvoices(sessionId).filter(
      inv => inv.clientName === clientName && inv.year === parseInt(year)
    );

    if (invoices.length === 0) {
      return res.status(400).json({ error: "Aucune facture trouvée pour ce client / cette année" });
    }

    const totalAmount = invoices.reduce((sum, inv) => sum + inv.amount, 0);
    const invoiceIds = JSON.stringify(invoices.map(i => i.id));

    const attestation = storage.createAttestation({
      sessionId,
      clientName,
      year: parseInt(year),
      totalAmount,
      invoiceIds,
      generatedAt: new Date().toISOString(),
      companyName,
      companyAddress,
      companySiret,
      companyPhone,
      companyEmail,
      intervenants: JSON.stringify(intervenants),
    });

    res.json(attestation);
  });

  // ── GET /api/attestations/:id/pdf ────────────────────────────────
  app.get("/api/attestations/:id/pdf", (req: any, res) => {
    const sessionId = getSessionId(req);
    const id = parseInt(req.params.id);
    const attestations = storage.getAttestations(sessionId);
    const attestation = attestations.find(a => a.id === id);

    if (!attestation) {
      return res.status(404).json({ error: "Attestation introuvable" });
    }

    const invoiceIds: number[] = JSON.parse(attestation.invoiceIds);
    const allInvoices = storage.getInvoices(sessionId);
    const invoices = allInvoices.filter(inv => invoiceIds.includes(inv.id));

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="attestation-fiscale-${attestation.clientName.replace(/\s+/g, "-")}-${attestation.year}.pdf"`
    );
    doc.pipe(res);

    // Parse intervenants
    let intervenantsList: { name: string; hourlyRate: string }[] = [];
    try { intervenantsList = JSON.parse(attestation.intervenants || "[]"); } catch {}

    const companyDisplay = attestation.companyName || "PSM — Personal Services Management";
    const emitDate = new Date(attestation.generatedAt).toLocaleDateString("fr-FR", {
      day: "2-digit", month: "long", year: "numeric"
    });

    // ─── Header ────────────────────────────────────────────────────
    doc.rect(0, 0, 595, 85).fill("#E8720C");
    doc.fillColor("#FFFFFF").fontSize(20).font("Helvetica-Bold")
      .text(companyDisplay, 50, 20, { width: 495 });
    doc.fontSize(10).font("Helvetica")
      .text("Attestation de prestation de services à la personne", 50, 50);

    // Company sub-band (dark)
    doc.rect(0, 85, 595, 32).fill("#1E1C1A");
    const companyInfoLine = [
      attestation.companySiret ? `SIRET : ${attestation.companySiret}` : "",
      attestation.companyPhone || "",
      attestation.companyEmail || "",
      attestation.companyAddress || "",
    ].filter(Boolean).join("  •  ");
    doc.fillColor("#BBBBBB").fontSize(8).font("Helvetica")
      .text(companyInfoLine || "Agréé Service à la Personne — CGI art. 199 sexdecies", 50, 95, { width: 495 });

    doc.moveDown(3);

    // ─── Title ──────────────────────────────────────────────────────
    doc.fillColor("#1E1C1A").fontSize(17).font("Helvetica-Bold")
      .text("ATTESTATION FISCALE ANNUELLE", { align: "center" });
    doc.fontSize(11).font("Helvetica").fillColor("#555555")
      .text("Article 199 sexdecies du Code Général des Impôts", { align: "center" });

    doc.moveDown(1.5);

    // ─── Two-column info boxes ───────────────────────────────────────
    const boxY = doc.y;
    const halfW = 235;

    // LEFT — Bénéficiaire
    doc.rect(50, boxY, halfW, 110).fillAndStroke("#FAFAF8", "#E8720C");
    doc.fillColor("#E8720C").fontSize(9).font("Helvetica-Bold")
      .text("BÉNÉFICIAIRE", 62, boxY + 10);
    doc.fillColor("#1E1C1A").fontSize(10).font("Helvetica-Bold")
      .text(attestation.clientName, 62, boxY + 26);
    doc.fontSize(9).font("Helvetica").fillColor("#555")
      .text(`Année fiscale : ${attestation.year}`, 62, boxY + 46)
      .text(`Nb de factures : ${invoices.length}`, 62, boxY + 62)
      .text(`Date émission : ${emitDate}`, 62, boxY + 78);

    // RIGHT — Prestataire
    doc.rect(310, boxY, halfW, 110).fillAndStroke("#FAFAF8", "#1E1C1A");
    doc.fillColor("#1E1C1A").fontSize(9).font("Helvetica-Bold")
      .text("PRESTATAIRE", 322, boxY + 10);
    doc.fontSize(10).font("Helvetica-Bold").fillColor("#1E1C1A")
      .text(companyDisplay, 322, boxY + 26, { width: halfW - 24 });
    doc.fontSize(9).font("Helvetica").fillColor("#555");
    let prestaY = boxY + 46;
    if (attestation.companyAddress) {
      doc.text(attestation.companyAddress, 322, prestaY, { width: halfW - 24 });
      prestaY += 16;
    }
    if (attestation.companySiret) {
      doc.text(`SIRET : ${attestation.companySiret}`, 322, prestaY);
      prestaY += 16;
    }
    if (attestation.companyPhone) {
      doc.text(`Tél : ${attestation.companyPhone}`, 322, prestaY);
    }

    doc.y = boxY + 120;
    doc.moveDown(1);

    // ─── Legal text ─────────────────────────────────────────────────
    doc.fontSize(10).font("Helvetica").fillColor("#333333")
      .text(
        `Je soussigné(e), représentant de ${companyDisplay}, certifie que ${attestation.clientName} a bénéficié de prestations de services à la personne au cours de l'année ${attestation.year}, conformément aux dispositions de l'article L.7231-1 du Code du travail et de l'agrément préfectoral en vigueur.`,
        50, doc.y, { width: 495, align: "justify" }
      );

    doc.moveDown(1.5);

    // ─── Intervenants ────────────────────────────────────────────────
    if (intervenantsList.length > 0) {
      const intY = doc.y;
      doc.rect(50, intY, 495, 22 + intervenantsList.length * 22).fill("#F8F6F3");
      doc.fillColor("#1E1C1A").fontSize(10).font("Helvetica-Bold")
        .text("INTERVENANT(S)", 62, intY + 7);
      intervenantsList.forEach((int, i) => {
        const lineY = intY + 26 + i * 22;
        doc.rect(50, lineY, 495, 22).fill(i % 2 === 0 ? "#FFFFFF" : "#F5F4F2");
        doc.fillColor("#1E1C1A").fontSize(9).font("Helvetica-Bold")
          .text(`${int.name}`, 62, lineY + 6, { width: 320 });
        if (int.hourlyRate) {
          doc.fillColor("#E8720C").font("Helvetica-Bold")
            .text(`${int.hourlyRate} €/h`, 370, lineY + 6, { width: 160, align: "right" });
        }
      });
      doc.y = intY + 22 + intervenantsList.length * 22 + 15;
    }

    doc.moveDown(0.5);

    // ─── Total highlight ────────────────────────────────────────────
    const totalBoxY = doc.y;
    doc.rect(50, totalBoxY, 495, 52).fill("#1E1C1A");
    doc.fillColor("#FFFFFF").fontSize(12).font("Helvetica-Bold")
      .text("MONTANT TOTAL DES PRESTATIONS", 65, totalBoxY + 9);
    doc.fontSize(18).font("Helvetica-Bold").fillColor("#E8720C")
      .text(`${attestation.totalAmount.toFixed(2).replace(".", ",")} €`, 65, totalBoxY + 27);

    doc.y = totalBoxY + 67;
    doc.moveDown(1);

    // ─── Invoice table ──────────────────────────────────────────────
    doc.fillColor("#1E1C1A").fontSize(10).font("Helvetica-Bold")
      .text("DÉTAIL DES PRESTATIONS");
    doc.moveDown(0.5);

    const tableX = 50;
    const cols = [tableX, tableX + 120, tableX + 220, tableX + 320, tableX + 420];
    const rowH = 20;
    const headerY = doc.y;
    doc.rect(tableX, headerY, 495, rowH).fill("#E8720C");
    doc.fillColor("#FFFFFF").fontSize(8).font("Helvetica-Bold");
    doc.text("Fichier", cols[0] + 4, headerY + 5, { width: 115 });
    doc.text("Client", cols[1] + 4, headerY + 5, { width: 95 });
    doc.text("Nature", cols[2] + 4, headerY + 5, { width: 95 });
    doc.text("Date", cols[3] + 4, headerY + 5, { width: 95 });
    doc.text("Montant", cols[4] + 4, headerY + 5, { width: 70, align: "right" });

    let rowY = headerY + rowH;
    invoices.forEach((inv: any, idx: number) => {
      const bg = idx % 2 === 0 ? "#FFFFFF" : "#F5F4F2";
      doc.rect(tableX, rowY, 495, rowH).fill(bg);
      doc.fillColor("#333333").fontSize(7.5).font("Helvetica");
      const shortName = inv.fileName.length > 20 ? inv.fileName.substring(0, 18) + "…" : inv.fileName;
      doc.text(shortName, cols[0] + 4, rowY + 5, { width: 115 });
      doc.text(inv.clientName, cols[1] + 4, rowY + 5, { width: 95 });
      const shortService = inv.serviceType.length > 18 ? inv.serviceType.substring(0, 16) + "…" : inv.serviceType;
      doc.text(shortService, cols[2] + 4, rowY + 5, { width: 95 });
      doc.text(inv.date, cols[3] + 4, rowY + 5, { width: 95 });
      doc.fillColor("#E8720C").font("Helvetica-Bold")
        .text(`${inv.amount.toFixed(2).replace(".", ",")} €`, cols[4] + 4, rowY + 5, { width: 70, align: "right" });
      rowY += rowH;
    });

    // Total row
    doc.rect(tableX, rowY, 495, rowH).fill("#1E1C1A");
    doc.fillColor("#FFFFFF").fontSize(9).font("Helvetica-Bold")
      .text("TOTAL", cols[0] + 4, rowY + 5, { width: 415 });
    doc.fillColor("#E8720C")
      .text(`${attestation.totalAmount.toFixed(2).replace(".", ",")} €`, cols[4] + 4, rowY + 5, { width: 70, align: "right" });

    doc.y = rowY + rowH + 20;

    // ─── Crédit fiscal ──────────────────────────────────────────────
    const creditFiscal = (attestation.totalAmount * 0.5).toFixed(2).replace(".", ",");
    const fiscalY = doc.y;
    doc.rect(50, fiscalY, 495, 38).fillAndStroke("#FFF3E8", "#E8720C");
    doc.fillColor("#E8720C").fontSize(9).font("Helvetica-Bold")
      .text("CRÉDIT D'IMPÔT ESTIMÉ (50%)", 65, fiscalY + 6);
    doc.fillColor("#1E1C1A").fontSize(9).font("Helvetica")
      .text(`Montant déductible : ${creditFiscal} € de votre impôt sur le revenu (art. 199 sexdecies CGI).`, 65, fiscalY + 22, { width: 465 });

    doc.y = fiscalY + 50;
    doc.moveDown(1.5);

    // ─── Signature ──────────────────────────────────────────────────
    const sigStartY = doc.y;
    doc.fontSize(9).font("Helvetica").fillColor("#333333")
      .text("Fait pour valoir ce que de droit.", 50, sigStartY);
    doc.text(`Émis le ${emitDate} par ${companyDisplay}`, 50, sigStartY + 14);
    const sigBoxY = sigStartY + 30;
    doc.rect(50, sigBoxY, 200, 55).stroke("#CCCCCC");
    doc.fillColor("#AAAAAA").fontSize(8).text("Signature et cachet", 65, sigBoxY + 40);

    // ─── Footer — positionné juste après la signature ────────────────
    const footerY = sigBoxY + 75;
    doc.rect(0, footerY, 595, 46).fill("#1E1C1A");
    doc.fillColor("#AAAAAA").fontSize(7.5).font("Helvetica")
      .text(
        `${companyDisplay} | Agrément SAP | CGI art. 199 sexdecies | Document généré automatiquement par PSM`,
        50, footerY + 8, { width: 495, align: "center" }
      );
    doc.fillColor("#E8720C").fontSize(7)
      .text("Created with Perplexity Computer — perplexity.ai/computer", 50, footerY + 26, { width: 495, align: "center" });

    doc.end();
  });
}