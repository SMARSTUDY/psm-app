import type { Invoice, InsertInvoice, Attestation, InsertAttestation } from "@shared/schema";

export interface IStorage {
  // Invoices
  getInvoices(sessionId: string): Invoice[];
  createInvoice(invoice: InsertInvoice): Invoice;
  deleteInvoice(id: number, sessionId: string): boolean;
  clearInvoices(sessionId: string): void;

  // Attestations
  getAttestations(sessionId: string): Attestation[];
  createAttestation(attestation: InsertAttestation): Attestation;
}

export class MemStorage implements IStorage {
  private invoices: Map<number, Invoice> = new Map();
  private attestations: Map<number, Attestation> = new Map();
  private invoiceCounter = 1;
  private attestationCounter = 1;

  getInvoices(sessionId: string): Invoice[] {
    return Array.from(this.invoices.values()).filter(inv => inv.sessionId === sessionId);
  }

  createInvoice(invoice: InsertInvoice): Invoice {
    const id = this.invoiceCounter++;
    const record: Invoice = { ...invoice, id };
    this.invoices.set(id, record);
    return record;
  }

  deleteInvoice(id: number, sessionId: string): boolean {
    const inv = this.invoices.get(id);
    if (!inv || inv.sessionId !== sessionId) return false;
    this.invoices.delete(id);
    return true;
  }

  clearInvoices(sessionId: string): void {
    for (const [id, inv] of this.invoices.entries()) {
      if (inv.sessionId === sessionId) this.invoices.delete(id);
    }
  }

  getAttestations(sessionId: string): Attestation[] {
    return Array.from(this.attestations.values()).filter(a => a.sessionId === sessionId);
  }

  createAttestation(attestation: InsertAttestation): Attestation {
    const id = this.attestationCounter++;
    const record: Attestation = { ...attestation, id };
    this.attestations.set(id, record);
    return record;
  }
}

export const storage = new MemStorage();
