import { pgTable, text, integer, real, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Factures importées ──────────────────────────────────────────────
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  fileName: text("file_name").notNull(),
  clientName: text("client_name").notNull(),
  amount: real("amount").notNull(),
  date: text("date").notNull(),
  serviceType: text("service_type").notNull(),
  year: integer("year").notNull(),
});

export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

// ── Attestations fiscales générées ─────────────────────────────────
export const attestations = pgTable("attestations", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  clientName: text("client_name").notNull(),
  year: integer("year").notNull(),
  totalAmount: real("total_amount").notNull(),
  invoiceIds: text("invoice_ids").notNull(), // JSON array string
  generatedAt: text("generated_at").notNull(),
  // Nouvelles infos société
  companyName: text("company_name").notNull().default(""),
  companyAddress: text("company_address").notNull().default(""),
  companySiret: text("company_siret").notNull().default(""),
  companyPhone: text("company_phone").notNull().default(""),
  companyEmail: text("company_email").notNull().default(""),
  // Intervenants (JSON array of {name, hourlyRate})
  intervenants: text("intervenants").notNull().default("[]"),
});

export const insertAttestationSchema = createInsertSchema(attestations).omit({ id: true });
export type InsertAttestation = z.infer<typeof insertAttestationSchema>;
export type Attestation = typeof attestations.$inferSelect;
