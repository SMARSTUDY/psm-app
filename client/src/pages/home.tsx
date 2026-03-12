import { useState, useRef, useCallback } from "react";
import psmLogoUrl from "@assets/psm-logo.jpg"; // PSM official logo
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Upload, FileText, Trash2, Download, Sparkles,
  TrendingUp, Users, Receipt, AlertCircle, CheckCircle2,
  Building2, UserPlus, X, ChevronRight, ChevronLeft
} from "lucide-react";
import type { Invoice, Attestation } from "@shared/schema";

// ── Helpers ────────────────────────────────────────────────────────
function formatEuro(amount: number) {
  return amount.toFixed(2).replace(".", ",") + " €";
}

function triggerBlobDownload(blob: Blob, clientName: string, year: number) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attestation-fiscale-${clientName.replace(/\s+/g, "-")}-${year}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function groupByClient(invoices: Invoice[]) {
  const map = new Map<string, { client: string; total: number; count: number; years: number[] }>();
  for (const inv of invoices) {
    const existing = map.get(inv.clientName);
    if (existing) {
      existing.total += inv.amount;
      existing.count++;
      if (!existing.years.includes(inv.year)) existing.years.push(inv.year);
    } else {
      map.set(inv.clientName, { client: inv.clientName, total: inv.amount, count: 1, years: [inv.year] });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

// ── Header ─────────────────────────────────────────────────────────
function Header() {
  return (
    <header className="bg-[#1E1C1A] border-b border-[#333]">
      <div className="max-w-6xl mx-auto px-6 py-0 flex items-center justify-between">
        <div className="flex items-center gap-3 py-3">
          <img
            src={psmLogoUrl}
            alt="PSM logo"
            className="h-10 w-auto object-contain"
          />
          <div>
            <p className="text-[#F5A623] text-xs font-medium">Personal Services Management</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-[#E8720C] text-[#E8720C] text-xs">
            Beta v1.0
          </Badge>
          <span className="text-[#666] text-xs hidden sm:inline">Attestations fiscales automatiques</span>
        </div>
      </div>
      {/* Orange accent line */}
      <div className="h-0.5 bg-gradient-to-r from-[#E8720C] via-[#F5A623] to-transparent"/>
    </header>
  );
}

// ── Upload Zone ────────────────────────────────────────────────────
function UploadZone({ onUpload }: { onUpload: (files: File[]) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === "application/pdf");
    if (files.length > 0) onUpload(files);
  }, [onUpload]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type === "application/pdf");
    if (files.length > 0) onUpload(files);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div
      data-testid="upload-zone"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`
        drop-zone relative border-2 border-dashed rounded-xl p-10 cursor-pointer text-center
        transition-all duration-200
        ${isDragging
          ? "border-[#E8720C] bg-orange-50 scale-[1.01]"
          : "border-[#E8E4DF] bg-[#FAFAF8] hover:border-[#E8720C] hover:bg-orange-50"
        }
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        className="hidden"
        onChange={handleFileChange}
        data-testid="input-file-upload"
      />
      <div className="flex flex-col items-center gap-3">
        <div className="w-14 h-14 rounded-full bg-orange-100 flex items-center justify-center">
          <Upload className="w-7 h-7 text-[#E8720C]" />
        </div>
        <div>
          <p className="font-semibold text-[#1E1C1A] text-base">
            {isDragging ? "Déposez vos factures ici" : "Importer des factures PDF"}
          </p>
          <p className="text-[#888] text-sm mt-1">
            Glissez-déposez ou cliquez • Plusieurs fichiers acceptés
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-[#E8720C] text-[#E8720C] hover:bg-[#E8720C] hover:text-white pointer-events-none"
          data-testid="button-browse-files"
        >
          <FileText className="w-4 h-4 mr-2" />
          Parcourir les fichiers
        </Button>
      </div>
    </div>
  );
}

// ── Stats Cards ────────────────────────────────────────────────────
function StatsCards({ invoices }: { invoices: Invoice[] }) {
  const totalAmount = invoices.reduce((s, inv) => s + inv.amount, 0);
  const clients = new Set(invoices.map(inv => inv.clientName)).size;
  const creditFiscal = totalAmount * 0.5;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {[
        {
          icon: Receipt,
          label: "Factures importées",
          value: invoices.length.toString(),
          sub: "fichiers PDF analysés",
          color: "#E8720C",
          bg: "bg-orange-50",
        },
        {
          icon: Users,
          label: "Clients distincts",
          value: clients.toString(),
          sub: "bénéficiaires détectés",
          color: "#1E1C1A",
          bg: "bg-gray-50",
        },
        {
          icon: TrendingUp,
          label: "Crédit d'impôt estimé",
          value: formatEuro(creditFiscal),
          sub: `sur ${formatEuro(totalAmount)} de prestations`,
          color: "#16A34A",
          bg: "bg-green-50",
        },
      ].map(({ icon: Icon, label, value, sub, color, bg }) => (
        <div key={label} className={`${bg} rounded-xl p-4 border border-[#E8E4DF]`}>
          <div className="flex items-center gap-2 mb-2">
            <Icon className="w-4 h-4" style={{ color }} />
            <span className="text-xs font-medium text-[#888] uppercase tracking-wide">{label}</span>
          </div>
          <p className="text-2xl font-bold" style={{ color }}>{value}</p>
          <p className="text-xs text-[#999] mt-0.5">{sub}</p>
        </div>
      ))}
    </div>
  );
}

// ── Attestation Generator Modal ────────────────────────────────────
type Intervenant = { name: string; hourlyRate: string };

function AttestationModal({
  invoices,
  onGenerated,
}: {
  invoices: Invoice[];
  onGenerated: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1); // 1=client/year, 2=company, 3=intervenants

  // Step 1
  const [selectedClient, setSelectedClient] = useState("");
  const [selectedYear, setSelectedYear] = useState("");

  // Step 2 — société
  const [companyName, setCompanyName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companySiret, setCompanySiret] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");

  // Step 3 — intervenants
  const [intervenants, setIntervenants] = useState<Intervenant[]>([{ name: "", hourlyRate: "" }]);

  const clients = [...new Set(invoices.map(inv => inv.clientName))].sort();
  const years = [...new Set(invoices.map(inv => inv.year))].sort((a, b) => b - a);

  const clientInvoices = invoices.filter(
    inv => inv.clientName === selectedClient && inv.year === parseInt(selectedYear)
  );
  const total = clientInvoices.reduce((s, inv) => s + inv.amount, 0);

  const resetForm = () => {
    setStep(1);
    setSelectedClient(""); setSelectedYear("");
    setCompanyName(""); setCompanyAddress(""); setCompanySiret(""); setCompanyPhone(""); setCompanyEmail("");
    setIntervenants([{ name: "", hourlyRate: "" }]);
  };

  const addIntervenant = () => setIntervenants(prev => [...prev, { name: "", hourlyRate: "" }]);
  const removeIntervenant = (i: number) => setIntervenants(prev => prev.filter((_, idx) => idx !== i));
  const updateIntervenant = (i: number, field: keyof Intervenant, value: string) =>
    setIntervenants(prev => prev.map((int, idx) => idx === i ? { ...int, [field]: value } : int));

  const generateMutation = useMutation({
    mutationFn: async () => {
      const validIntervenants = intervenants.filter(i => i.name.trim());
      const res = await fetch("/api/attestations/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Visitor-Id": "browser-session",
        },
        body: JSON.stringify({
          clientName: selectedClient,
          year: parseInt(selectedYear),
          companyName, companyAddress, companySiret, companyPhone, companyEmail,
          intervenants: validIntervenants,
        }),
      });
      if (!res.ok) {
        // Try to parse error JSON
        let msg = "Impossible de générer l'attestation.";
        try { const e = await res.json(); msg = e.error || msg; } catch {}
        throw new Error(msg);
      }
      return res.blob();
    },
    onSuccess: (blob: Blob) => {
      triggerBlobDownload(blob, selectedClient, parseInt(selectedYear));
      toast({ title: "Attestation générée", description: `PDF téléchargé pour ${selectedClient} (${selectedYear}).` });
      setOpen(false);
      resetForm();
      onGenerated();
    },
    onError: (err: any) => {
      toast({ title: "Erreur", description: err.message || "Impossible de générer l'attestation.", variant: "destructive" });
    },
  });

  const stepLabel = ["Client & Année", "Informations société", "Intervenants"];

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        <Button
          className="bg-[#E8720C] hover:bg-[#D0650B] text-white"
          disabled={invoices.length === 0}
          data-testid="button-generate-attestation"
        >
          <Sparkles className="w-4 h-4 mr-2" />
          Générer attestation fiscale
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg" data-testid="dialog-attestation">
        <DialogHeader>
          <DialogTitle className="text-[#1E1C1A] flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#E8720C]" />
            Attestation fiscale — Étape {step}/3
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 pb-1">
          {[1, 2, 3].map(s => (
            <div key={s} className="flex items-center gap-1 flex-1">
              <div className={`flex-1 h-1.5 rounded-full transition-all ${s <= step ? "bg-[#E8720C]" : "bg-[#E8E4DF]"}`} />
              {s < 3 && <div className={`w-1.5 h-1.5 rounded-full ${s < step ? "bg-[#E8720C]" : "bg-[#E8E4DF]"}`} />}
            </div>
          ))}
        </div>
        <p className="text-xs text-[#888] -mt-1 mb-1 font-medium">{stepLabel[step - 1]}</p>

        {/* ── STEP 1 : Client & Année ── */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-[#1E1C1A]">Client bénéficiaire</label>
              <Select value={selectedClient} onValueChange={setSelectedClient}>
                <SelectTrigger data-testid="select-client">
                  <SelectValue placeholder="Choisir un client…" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-[#1E1C1A]">Année fiscale</label>
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger data-testid="select-year">
                  <SelectValue placeholder="Choisir l'année…" />
                </SelectTrigger>
                <SelectContent>
                  {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {selectedClient && selectedYear && (
              <div className="bg-orange-50 border border-[#E8720C] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 className="w-4 h-4 text-[#E8720C]" />
                  <span className="text-sm font-medium text-[#1E1C1A]">
                    {clientInvoices.length} facture{clientInvoices.length > 1 ? "s" : ""} •{" "}
                    <strong className="text-[#E8720C]">{formatEuro(total)}</strong>
                  </span>
                </div>
                <p className="text-xs text-[#888]">Crédit d'impôt estimé : {formatEuro(total * 0.5)}</p>
              </div>
            )}
            <Button
              className="w-full bg-[#E8720C] hover:bg-[#D0650B] text-white"
              disabled={!selectedClient || !selectedYear}
              onClick={() => setStep(2)}
            >
              Suivant <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* ── STEP 2 : Société ── */}
        {step === 2 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="w-4 h-4 text-[#E8720C]" />
              <p className="text-sm text-[#555]">Informations de votre société (apparaîtront sur l'attestation)</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[#666] uppercase tracking-wide">Nom de la société *</label>
              <Input
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                placeholder="ex: CCFORMATION SARL"
                data-testid="input-company-name"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[#666] uppercase tracking-wide">Adresse</label>
              <Input value={companyAddress} onChange={e => setCompanyAddress(e.target.value)} placeholder="ex: 12 rue de la Paix, 42110 Feurs" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#666] uppercase tracking-wide">SIRET</label>
                <Input value={companySiret} onChange={e => setCompanySiret(e.target.value)} placeholder="xxx xxx xxx xxxxx" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#666] uppercase tracking-wide">Téléphone</label>
                <Input value={companyPhone} onChange={e => setCompanyPhone(e.target.value)} placeholder="06 xx xx xx xx" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[#666] uppercase tracking-wide">Email</label>
              <Input value={companyEmail} onChange={e => setCompanyEmail(e.target.value)} placeholder="contact@ma-societe.fr" type="email" />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Retour
              </Button>
              <Button
                className="flex-1 bg-[#E8720C] hover:bg-[#D0650B] text-white"
                disabled={!companyName.trim()}
                onClick={() => setStep(3)}
              >
                Suivant <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 3 : Intervenants ── */}
        {step === 3 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <UserPlus className="w-4 h-4 text-[#E8720C]" />
              <p className="text-sm text-[#555]">Qui a effectué les prestations ?</p>
            </div>
            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {intervenants.map((int, i) => (
                <div key={i} className="flex gap-2 items-center bg-[#FAFAF8] border border-[#E8E4DF] rounded-lg p-2">
                  <div className="flex-1 space-y-1">
                    <Input
                      value={int.name}
                      onChange={e => updateIntervenant(i, "name", e.target.value)}
                      placeholder={`Nom prénom intervenant ${i + 1}`}
                      className="text-sm h-8"
                      data-testid={`input-intervenant-name-${i}`}
                    />
                  </div>
                  <div className="w-28">
                    <Input
                      value={int.hourlyRate}
                      onChange={e => updateIntervenant(i, "hourlyRate", e.target.value)}
                      placeholder="Tarif /h"
                      className="text-sm h-8"
                      data-testid={`input-intervenant-rate-${i}`}
                    />
                  </div>
                  {intervenants.length > 1 && (
                    <button
                      onClick={() => removeIntervenant(i)}
                      className="text-[#CCC] hover:text-red-400 transition-colors flex-shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={addIntervenant}
              className="flex items-center gap-1.5 text-sm text-[#E8720C] hover:text-[#D0650B] font-medium"
              data-testid="button-add-intervenant"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Ajouter un intervenant
            </button>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setStep(2)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Retour
              </Button>
              <Button
                className="flex-1 bg-[#E8720C] hover:bg-[#D0650B] text-white"
                disabled={generateMutation.isPending}
                onClick={() => generateMutation.mutate()}
                data-testid="button-confirm-generate"
              >
                {generateMutation.isPending ? (
                  <span className="uploading-pulse">Génération…</span>
                ) : (
                  <><Download className="w-4 h-4 mr-1.5" />Générer le PDF</>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Invoice Table ──────────────────────────────────────────────────
function InvoiceTable({
  invoices,
  onDelete,
  isDeleting,
}: {
  invoices: Invoice[];
  onDelete: (id: number) => void;
  isDeleting: boolean;
}) {
  return (
    <div className="border border-[#E8E4DF] rounded-xl overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-[#1E1C1A] hover:bg-[#1E1C1A]">
            {["Fichier", "Client", "Nature prestation", "Date", "Montant", ""].map(h => (
              <TableHead key={h} className="text-white font-semibold text-xs uppercase tracking-wide py-3">
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((inv, idx) => (
            <TableRow
              key={inv.id}
              className={idx % 2 === 0 ? "bg-white hover:bg-orange-50" : "bg-[#FAFAF8] hover:bg-orange-50"}
              data-testid={`row-invoice-${inv.id}`}
            >
              <TableCell className="text-xs text-[#666] max-w-[120px] truncate" title={inv.fileName}>
                <div className="flex items-center gap-1.5">
                  <FileText className="w-3 h-3 text-[#E8720C] flex-shrink-0" />
                  <span className="truncate">{inv.fileName}</span>
                </div>
              </TableCell>
              <TableCell className="font-medium text-sm text-[#1E1C1A]">{inv.clientName}</TableCell>
              <TableCell className="text-xs text-[#666]">{inv.serviceType}</TableCell>
              <TableCell className="text-xs text-[#888]">{inv.date}</TableCell>
              <TableCell>
                <span className="font-bold text-[#E8720C]">{formatEuro(inv.amount)}</span>
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 hover:bg-red-50 hover:text-red-500"
                  onClick={() => onDelete(inv.id)}
                  disabled={isDeleting}
                  data-testid={`button-delete-invoice-${inv.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Client Summary Cards ───────────────────────────────────────────
function ClientSummaryCards({ invoices }: { invoices: Invoice[] }) {
  const groups = groupByClient(invoices);
  if (groups.length === 0) return null;

  return (
    <div>
      <h3 className="text-sm font-semibold text-[#1E1C1A] mb-3 uppercase tracking-wide">
        Récapitulatif par client
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {groups.map(g => (
          <div
            key={g.client}
            className="bg-white border border-[#E8E4DF] rounded-xl p-4 hover:border-[#E8720C] transition-colors"
            data-testid={`card-client-${g.client.replace(/\s+/g, "-")}`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center">
                <span className="text-[#E8720C] font-bold text-sm">
                  {g.client.charAt(0).toUpperCase()}
                </span>
              </div>
              <Badge variant="outline" className="text-xs border-[#E8E4DF] text-[#888]">
                {g.count} facture{g.count > 1 ? "s" : ""}
              </Badge>
            </div>
            <p className="font-semibold text-[#1E1C1A] text-sm truncate" title={g.client}>{g.client}</p>
            <p className="text-lg font-bold text-[#E8720C] mt-1">{formatEuro(g.total)}</p>
            <p className="text-xs text-[#999] mt-0.5">
              {g.years.sort().join(", ")} • Crédit : {formatEuro(g.total * 0.5)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Attestation History ────────────────────────────────────────────
function AttestationHistory() {
  const { toast } = useToast();
  const { data: attestations = [], isLoading } = useQuery<Attestation[]>({
    queryKey: ["/api/attestations"],
  });

  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (attestations.length === 0) return null;

  return (
    <div className="bg-[#1E1C1A] rounded-xl p-5 mt-2">
      <h3 className="text-white text-sm font-semibold uppercase tracking-wide mb-3 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-[#E8720C]" />
        Attestations générées
      </h3>
      <div className="space-y-2">
        {attestations.map(att => (
          <div
            key={att.id}
            className="flex items-center justify-between bg-[#2D2D2D] rounded-lg px-4 py-3"
            data-testid={`card-attestation-${att.id}`}
          >
            <div>
              <p className="text-white text-sm font-medium">{att.clientName}</p>
              <p className="text-[#888] text-xs">
                {att.year} • {formatEuro(att.totalAmount)} •{" "}
                {new Date(att.generatedAt).toLocaleDateString("fr-FR")}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-[#E8720C] text-[#E8720C] hover:bg-[#E8720C] hover:text-white h-8"
              data-testid={`link-download-attestation-${att.id}`}
              onClick={() => toast({ title: "Info", description: "Veuillez regénérer l'attestation depuis le bouton principal." })}
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              PDF
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────
export default function HomePage() {
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>("");

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/invoices/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de supprimer la facture.", variant: "destructive" });
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/invoices");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Factures effacées", description: "Toutes les factures ont été supprimées." });
    },
  });

  const handleUpload = async (files: File[]) => {
    setIsUploading(true);
    setUploadProgress(`Analyse de ${files.length} facture${files.length > 1 ? "s" : ""} par IA…`);

    const formData = new FormData();
    files.forEach(f => formData.append("files", f));

    try {
      const res = await fetch(`/api/invoices/upload`, {
        method: "POST",
        body: formData,
        headers: { "X-Visitor-Id": "browser-session" },
      });
      const data = await res.json();

      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });

      const ok = data.success?.length || 0;
      const err = data.errors?.length || 0;

      if (ok > 0) {
        toast({
          title: `${ok} facture${ok > 1 ? "s" : ""} importée${ok > 1 ? "s" : ""}`,
          description: err > 0 ? `${err} fichier(s) en erreur.` : "Extraction IA réussie.",
        });
      }
      if (err > 0 && ok === 0) {
        toast({
          title: "Erreur d'import",
          description: data.errors?.[0]?.error || "Impossible de lire les PDFs.",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Erreur réseau", description: "Impossible de contacter le serveur.", variant: "destructive" });
    } finally {
      setIsUploading(false);
      setUploadProgress("");
    }
  };

  const totalAmount = invoices.reduce((s, inv) => s + inv.amount, 0);

  return (
    <div className="min-h-screen bg-[#F5F3F0] flex flex-col">
      <Header />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-8 space-y-8">

        {/* Hero section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-[#1E1C1A]">Tableau de bord fiscal</h2>
            <p className="text-[#888] text-sm mt-0.5">
              Importez vos factures PDF — l'IA extrait et calcule automatiquement
            </p>
          </div>
          <div className="flex items-center gap-3">
            {invoices.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="border-red-200 text-red-500 hover:bg-red-50"
                onClick={() => clearMutation.mutate()}
                disabled={clearMutation.isPending}
                data-testid="button-clear-all"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                Tout effacer
              </Button>
            )}
            <AttestationModal
              invoices={invoices}
              onGenerated={() => queryClient.invalidateQueries({ queryKey: ["/api/attestations"] })}
            />
          </div>
        </div>

        {/* Upload zone */}
        {isUploading ? (
          <div className="border-2 border-dashed border-[#E8720C] rounded-xl p-10 bg-orange-50 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-full bg-orange-100 flex items-center justify-center uploading-pulse">
                <Sparkles className="w-7 h-7 text-[#E8720C]" />
              </div>
              <p className="font-semibold text-[#1E1C1A]">{uploadProgress}</p>
              <p className="text-[#888] text-sm">L'IA lit et extrait les données de chaque facture…</p>
            </div>
          </div>
        ) : (
          <UploadZone onUpload={handleUpload} />
        )}

        {/* Stats */}
        {invoices.length > 0 && <StatsCards invoices={invoices} />}

        {/* Invoices table */}
        {invoicesLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : invoices.length > 0 ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#1E1C1A] uppercase tracking-wide">
                Factures importées ({invoices.length})
              </h3>
              {totalAmount > 0 && (
                <span className="text-sm text-[#888]">
                  Total : <strong className="text-[#E8720C]">{formatEuro(totalAmount)}</strong>
                </span>
              )}
            </div>
            <InvoiceTable
              invoices={invoices}
              onDelete={(id) => deleteMutation.mutate(id)}
              isDeleting={deleteMutation.isPending}
            />
          </div>
        ) : (
          <div className="text-center py-16 text-[#AAA]">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="font-medium">Aucune facture importée</p>
            <p className="text-sm mt-1">Importez vos PDF pour commencer l'analyse</p>
          </div>
        )}

        {/* Client summaries */}
        <ClientSummaryCards invoices={invoices} />

        {/* Attestation history */}
        <AttestationHistory />

        {/* Info banner */}
        <div className="bg-[#1E1C1A] rounded-xl p-5 flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-[#E8720C] flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-white font-semibold text-sm">Comment ça marche ?</p>
            <ol className="text-[#AAA] text-xs mt-1 space-y-0.5 list-decimal list-inside">
              <li>Importez une ou plusieurs factures PDF</li>
              <li>L'IA (Claude) extrait automatiquement : client, montant, date, nature</li>
              <li>Les factures sont regroupées par client et sommées</li>
              <li>Générez l'attestation fiscale annuelle en un clic (CGI art. 199 sexdecies)</li>
            </ol>
          </div>
        </div>

      </main>

      <footer className="bg-[#1E1C1A] border-t border-[#333] mt-8">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <p className="text-[#666] text-xs">© 2025 PSM · Personal Services Management · Agrément SAP</p>
          <a
            href="https://www.perplexity.ai/computer"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#666] text-xs hover:text-[#E8720C] transition-colors"
          >
            Created with Perplexity Computer
          </a>
        </div>
      </footer>
    </div>
  );
}
