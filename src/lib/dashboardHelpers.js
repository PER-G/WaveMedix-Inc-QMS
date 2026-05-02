// ═══ Dashboard Helper Functions ═══
// Extracted from Dashboard.jsx — shared across SOP Explorer, Document Explorer, Audit Trail

export function extractVersion(name) {
  const m = name.match(/_V(\d+[._]\d+)/i);
  if (m) return m[1].replace("_", ".");
  const m2 = name.match(/V(\d+\.\d+)/i);
  if (m2) return m2[1];
  return null;
}

export function fileExt(name) {
  const m = name.match(/\.(\w+)$/);
  return m ? m[1].toLowerCase() : "file";
}

export function cleanFormName(name) {
  let clean = name.replace(/\.\w+$/, "");
  clean = clean.replace(/^WM-SOP-\d{3}[-_]/, "");
  clean = clean.replace(/^WM-QM[SH]-\d{3}[-_]/, "");
  clean = clean.replace(/_/g, " ");
  clean = clean.replace(/\s*V\d+[. ]\d+\s*$/, "");
  return clean;
}

export function getPreviewUrl(file) {
  if (file.mimeType === "application/vnd.google-apps.document") {
    return `https://docs.google.com/document/d/${file.id}/preview`;
  }
  if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
    return `https://docs.google.com/spreadsheets/d/${file.id}/preview`;
  }
  if (file.mimeType === "application/vnd.google-apps.presentation") {
    return `https://docs.google.com/presentation/d/${file.id}/preview`;
  }
  return `https://drive.google.com/file/d/${file.id}/preview`;
}

export function fmtSize(b) {
  if (!b) return "\u2013";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
}

export function fmtDate(iso) {
  if (!iso) return "\u2013";
  return new Date(iso).toLocaleDateString("de-DE", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function matchFilesToSops(driveFiles) {
  const map = {};

  driveFiles.forEach((f) => {
    // Skip ENTWURF (draft) files — they belong in the Entwürfe folder, not the SOP tree
    if (f.name && f.name.includes("ENTWURF")) return;
    // Skip files from the Entwürfe folder
    if (f.folder && (f.folder === "Entwürfe" || f.folder.includes("Entwürfe"))) return;

    const sopMatch = f.name.match(/^(WM-(?:SOP|QMH|QMS)-\d{3})/);
    if (sopMatch) {
      // Normalize: QMH-xxx → QMS-xxx, and legacy QMS-002 → QMS-001 (QMS was renumbered)
      let key = sopMatch[1].replace("QMH", "QMS");
      if (key === "WM-QMS-002") key = "WM-QMS-001";
      // Legacy: former SOP-016 (Continuous AI Training) was removed; 017/018/019 renumbered down
      if (key === "WM-SOP-017") key = "WM-SOP-016"; // Data Management & Hygiene
      else if (key === "WM-SOP-018") key = "WM-SOP-017"; // Engineering Change Mgmt
      else if (key === "WM-SOP-019") key = "WM-SOP-018"; // PCCP Management
      if (!map[key]) map[key] = { sop: null, forms: [], oldForms: [] };

      const formMatch = f.name.match(/[-_](F-?\d{3}|T-?\d{3})/);
      const isRootSop = f.folder === "root" && !formMatch;

      if (isRootSop) {
        if (f.isOld) {
          map[key].oldForms.push(f);
        } else if (!map[key].sop || f.modifiedTime > map[key].sop.modifiedTime) {
          map[key].sop = f;
        }
      } else if (f.isOld) {
        map[key].oldForms.push(f);
      } else {
        map[key].forms.push(f);
      }
      return;
    }

    if (f.folder && f.folder !== "root") {
      const folderMatch = f.folder.match(/(WM-(?:SOP|QMH|QMS)-\d{3})/);
      if (folderMatch) {
        let key = folderMatch[1].replace("QMH", "QMS");
        if (key === "WM-QMS-002") key = "WM-QMS-001";
        if (key === "WM-SOP-017") key = "WM-SOP-016";
        else if (key === "WM-SOP-018") key = "WM-SOP-017";
        else if (key === "WM-SOP-019") key = "WM-SOP-018";
        if (!map[key]) map[key] = { sop: null, forms: [], oldForms: [] };
        if (f.isOld) {
          map[key].oldForms.push(f);
        } else {
          map[key].forms.push(f);
        }
      }
    }
  });

  return map;
}

// ═══ Match files to AREA_CONFIG categories (for Dev/Ops tabs) ═══
export function matchFilesToCategories(files, areaConfig) {
  const catMap = {};

  // Initialize all categories
  for (const cat of areaConfig.categories) {
    catMap[cat.path] = { files: [], subModules: {} };
    if (cat.subModules) {
      for (const sub of cat.subModules) {
        catMap[cat.path].subModules[sub.path] = [];
      }
    }
  }

  // Assign files to categories based on subfolderPath
  for (const f of files) {
    const path = f.subfolderPath || f.folder || "";
    let assigned = false;

    for (const cat of areaConfig.categories) {
      if (cat.subModules) {
        for (const sub of cat.subModules) {
          const subPath = `${cat.path}/${sub.path}`;
          if (path === subPath || path.startsWith(subPath + "/")) {
            catMap[cat.path].subModules[sub.path].push(f);
            assigned = true;
            break;
          }
        }
        if (assigned) break;
      }

      if (path === cat.path || path.startsWith(cat.path + "/")) {
        catMap[cat.path].files.push(f);
        assigned = true;
        break;
      }
    }

    // Files in root of the area folder
    if (!assigned && !path) {
      // Put in first category or leave unassigned
    }
  }

  return catMap;
}

// ═══ Count files in a category map ═══
export function countCategoryFiles(catMap, catPath) {
  const cat = catMap[catPath];
  if (!cat) return 0;
  let count = cat.files.length;
  if (cat.subModules) {
    for (const subFiles of Object.values(cat.subModules)) {
      count += subFiles.length;
    }
  }
  return count;
}

// ═══ Translations ═══
export const TX = {
  de: {
    sopT: "SOP Explorer", dev: "Development", ops: "Operations",
    audit: "Audit Trail", qms: "QMS", prod: "Produkte", team: "Team",
    search: "SOPs durchsuchen...", open: "\u00D6ffnen", forms: "Formbl\u00E4tter",
    oldForms: "Alte Versionen", stds: "Regulatorische Grundlagen",
    objT: "Qualit\u00E4tsziele",
    objs: ["Regulatory-Grade AI f\u00FCr klinische Entscheidungsunterst\u00FCtzung", "PCCP-Governance f\u00FCr kontinuierliche Verbesserung", "Glass-Box-Architektur f\u00FCr Erkl\u00E4rbarkeit", "Validiertes QMS mit FDA 21 CFR Part 11", "Post-Market Surveillance mit Drift-Erkennung"],
    prT: "Qualit\u00E4tspolitik",
    prTx: "WAVEMEDIX Inc entwickelt AI-Agents als Medizinprodukte-Software (SaMD) mit h\u00F6chsten Qualit\u00E4ts- und Sicherheitsanspr\u00FCchen.",
    chatPh: "Frage zum QMS...", loading: "Lade Dateien aus Google Drive...",
    signOut: "Abmelden", version: "Version", noForms: "Keine Formbl\u00E4tter",
    previewTitle: "Vorschau", closePreview: "Schlie\u00DFen",
    noDocs: "Keine Dokumente", openDrive: "In Drive \u00F6ffnen",
    setupFolders: "Ordnerstruktur erstellen", refreshFiles: "Aktualisieren",
    product: "Produkt",
    approvals: "Genehmigungen", submitApproval: "Zur Genehmigung einreichen",
    signatureStatus: "Signaturstatus", rejected: "Abgelehnt", approved: "Genehmigt",
    pending: "Ausstehend", hashMismatch: "Hash-Abweichung erkannt",
    withdraw: "Zur\u00FCckziehen", sign: "Genehmigen", reject: "Ablehnen",
    dropHere: "Datei hierher ziehen oder klicken", uploadFile: "Datei hochladen",
    uploading: "Wird hochgeladen...", uploaded: "Hochgeladen",
    editInDocs: "In Google Docs bearbeiten", deleteDraft: "Entwurf l\u00F6schen",
    confirmDelete: "Wirklich l\u00F6schen?", author: "Ersteller", reviewer: "Pr\u00FCfer",
    approver: "Genehmiger", submittedBy: "Eingereicht von", history: "Historie",
    newVersion: "Neue Version", obsolete: "Ung\u00FCltig", superseded: "Ersetzt",
    version: "Version", noApprovals: "Keine offenen Genehmigungen",
    selectSignatories: "Unterzeichner ausw\u00E4hlen",
    allMustBeDifferent: "Alle 3 Unterzeichner m\u00FCssen verschiedene Personen sein",
    docControl: "Dokumentenlenkung", ecm: "\u00C4nderungsmanagement",
    liveDoc: "Live-Dokument", lastModifiedLabel: "Zuletzt ge\u00E4ndert",
    initLiveDoc: "Live-Dokument erstellen", creating: "Wird erstellt...",
    auditWizard: "Audit-Assistent", auditCategory: "Was m\u00F6chtest du auditieren?",
    auditSubcategory: "Elemente ausw\u00E4hlen", auditTypeLabel: "Audit-Typ",
    regulatory: "Regulatorisch", contentAudit: "Inhaltlich", bothAudit: "Beides",
    selectAll: "Alle ausw\u00E4hlen", deselectAll: "Alle abw\u00E4hlen",
    startAudit: "Audit starten", auditProgress: "Audit l\u00E4uft...",
    auditComplete: "Audit abgeschlossen", back: "Zur\u00FCck", next: "Weiter",
    auditRunning: "Auditiere", auditOf: "von",
    sopsLabel: "SOPs", formsheetsLabel: "Formbl\u00E4tter",
    developmentLabel: "Development", operationsLabel: "Operations",
    auditReportReady: "Audit-Bericht erstellt",
    openReport: "Bericht \u00F6ffnen", downloadXlsx: ".xlsx herunterladen",
    docsAudited: "Dokumente gepr\u00FCft", sopsCounted: "SOPs", formsCounted: "Formbl\u00E4tter",
  },
  en: {
    sopT: "SOP Explorer", dev: "Development", ops: "Operations",
    audit: "Audit Trail", qms: "QMS", prod: "Products", team: "Team",
    search: "Search SOPs...", open: "Open", forms: "Form Sheets",
    oldForms: "Old Versions", stds: "Regulatory Foundations",
    objT: "Quality Objectives",
    objs: ["Regulatory-grade AI for clinical decision support", "PCCP governance for continuous improvement", "Glass-box architecture for explainability", "Validated QMS with FDA 21 CFR Part 11", "Post-market surveillance with drift detection"],
    prT: "Quality Policy",
    prTx: "WAVEMEDIX Inc develops AI-Agents as medical device software (SaMD) with the highest quality and safety standards.",
    chatPh: "Ask about QMS...", loading: "Loading files from Google Drive...",
    signOut: "Sign out", version: "Version", noForms: "No form sheets",
    previewTitle: "Preview", closePreview: "Close",
    noDocs: "No documents", openDrive: "Open in Drive",
    setupFolders: "Set up folder structure", refreshFiles: "Refresh",
    product: "Product",
    approvals: "Approvals", submitApproval: "Submit for Approval",
    signatureStatus: "Signature Status", rejected: "Rejected", approved: "Approved",
    pending: "Pending", hashMismatch: "Hash mismatch detected",
    withdraw: "Withdraw", sign: "Approve", reject: "Reject",
    dropHere: "Drag file here or click to browse", uploadFile: "Upload File",
    uploading: "Uploading...", uploaded: "Uploaded",
    editInDocs: "Edit in Google Docs", deleteDraft: "Delete Draft",
    confirmDelete: "Are you sure?", author: "Author", reviewer: "Reviewer",
    approver: "Approver", submittedBy: "Submitted by", history: "History",
    newVersion: "New Version", obsolete: "Obsolete", superseded: "Superseded",
    version: "Version", noApprovals: "No pending approvals",
    selectSignatories: "Select signatories",
    allMustBeDifferent: "All 3 signatories must be different people",
    docControl: "Document Control", ecm: "Change Management",
    liveDoc: "Live Document", lastModifiedLabel: "Last modified",
    initLiveDoc: "Initialize Live Document", creating: "Initializing...",
    auditWizard: "Audit Wizard", auditCategory: "What do you want to audit?",
    auditSubcategory: "Select items", auditTypeLabel: "Audit Type",
    regulatory: "Regulatory", contentAudit: "Content", bothAudit: "Both",
    selectAll: "Select all", deselectAll: "Deselect all",
    startAudit: "Start Audit", auditProgress: "Audit in progress...",
    auditComplete: "Audit Complete", back: "Back", next: "Next",
    auditRunning: "Auditing", auditOf: "of",
    sopsLabel: "SOPs", formsheetsLabel: "Formsheets",
    developmentLabel: "Development", operationsLabel: "Operations",
    auditReportReady: "Audit report ready",
    openReport: "Open Report", downloadXlsx: "Download .xlsx",
    docsAudited: "Documents audited", sopsCounted: "SOPs", formsCounted: "Formsheets",
  },
};

// ═══ Static Data ═══
// Note: Former WM-SOP-016 (Continuous AI Training) was removed for ISO Phase 1.
// SOPs 017/018/019 were renumbered down to 016/017/018.
export const SOPS = [
  { id: "WM-QMS-001", alt: "WM-QMS-002", de: "Quality Manual", en: "Quality Manual" },
  { id: "WM-SOP-001", de: "Dokumentenlenkung", en: "Document Control" },
  { id: "WM-SOP-002", de: "Aufzeichnungslenkung", en: "Record Management" },
  { id: "WM-SOP-003", de: "AI-Agent Design & Entwicklung", en: "AI-Agent Design & Development" },
  { id: "WM-SOP-004", de: "Algorithmus-Risikomanagement", en: "Algorithm Risk Management" },
  { id: "WM-SOP-005", de: "Trending & KPI Management", en: "Trending & KPI Management" },
  { id: "WM-SOP-006", de: "Reklamation & Meldepflicht", en: "Complaint & Adverse Event" },
  { id: "WM-SOP-007", de: "Post-Market Surveillance", en: "Post-Market Surveillance" },
  { id: "WM-SOP-008", de: "FDE Deployment & Release", en: "FDE Deployment & Release" },
  { id: "WM-SOP-009", de: "Regulatory Intelligence", en: "Regulatory Intelligence" },
  { id: "WM-SOP-010", de: "Lieferantenmanagement", en: "Supplier Management" },
  { id: "WM-SOP-011", de: "Software-Validierung", en: "Software Validation Testing" },
  { id: "WM-SOP-012", de: "Internes Auditprogramm", en: "Internal Audit Program" },
  { id: "WM-SOP-013", de: "IT-Sicherheit & Part 11", en: "IT Security & Part 11" },
  { id: "WM-SOP-014", de: "Schulung & Kompetenzmanagement", en: "Training & Competence Management" },
  { id: "WM-SOP-015", de: "CAPA-Management", en: "CAPA Management" },
  { id: "WM-SOP-016", alt: "WM-SOP-017", de: "Datenmanagement & Hygiene", en: "Data Management & Hygiene" },
  { id: "WM-SOP-017", alt: "WM-SOP-018", de: "Engineering Change Mgmt", en: "Engineering Change Mgmt" },
  { id: "WM-SOP-018", alt: "WM-SOP-019", de: "PCCP-Management", en: "PCCP Management" },
];

export const REGS = ["ISO 13485:2016", "FDA 21 CFR 820", "FDA 21 CFR Part 11", "EU MDR 2017/745", "IEC 62304:2006+A1", "ISO 14971:2019", "FDA PCCP Guidance", "IMDRF SaMD"];

export const PRODS = [
  { id: "ammonix", name: "Ammonix ECG AI-Agent", cls: "Class II (SaMD)", reg: "FDA 510(k) + CE Mark", desc: "AI-gest\u00FCtztes EKG-Analyse-System.", descEn: "AI-powered ECG analysis system." },
  { id: "qpsi", name: "Q-PSI Signal Tokenizer", cls: "Class I (Software-Tool)", reg: "FDA Exempt", desc: "Propriet\u00E4re Signalverarbeitung.", descEn: "Proprietary signal processing." },
  { id: "therapy", name: "Therapy Monitor Agent", cls: "Class II (SaMD)", reg: "FDA De Novo / 510(k)", desc: "Therapie-Monitoring.", descEn: "Therapy monitoring." },
];

export const TF = [{ name: "Francesca Stingele", role: "President", roleDe: "Pr\u00E4sidentin", i: "FS", c: "#7C3AED", email: "francesca.stingele@wavemedix.ai" }, { name: "Peter Ruppersberg", role: "CEO & Medical Lead", roleDe: "CEO & Medical Lead", i: "PR", c: "#0369A1", email: "peter.ruppersberg@wavemedix.ai" }];
export const TL = [{ name: "Duangjai Glauser", role: "Director Quality & Operations", roleDe: "Direktorin Qualit\u00E4t & Betrieb", i: "DG", c: "#028090", email: "duangjai.glauser@wavemedix.ai" }];
export const TM = [{ name: "Matthew Todorov", role: "AI Research / System Dev", roleDe: "KI-Forschung / Systementwicklung", i: "MT", c: "#059669", email: "matthew.todorov@wavemedix.ai" }, { name: "Adele Glauser", role: "Algorithm Development", roleDe: "Algorithmus-Entwicklung", i: "AG", c: "#D97706", email: "adele.glauser@wavemedix.ai" }, { name: "Lea Grieder", role: "AI Architecture", roleDe: "KI-Architektur", i: "LG", c: "#DC2626", email: "lea.grieder@wavemedix.ai" }, { name: "Paul Elias Ruppersberg", role: "Process Development", roleDe: "Prozessentwicklung", i: "PE", c: "#7C3AED", email: "paul.ruppersberg@wavemedix.ai" }];
export const ALL_TEAM = [...TF, ...TL, ...TM];
