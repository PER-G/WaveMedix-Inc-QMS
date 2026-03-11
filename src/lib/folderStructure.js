// ═══ FOLDER STRUCTURE CONFIGURATION ═══
// Defines Development and Operations folder trees for auto-creation and UI rendering.

export const AREA_CONFIG = {
  development: {
    label: { de: "Entwicklung", en: "Development" },
    icon: "zap",
    color: "#7C3AED",
    product: "Wavemedix SaMD Suite",
    folderName: "Development",
    categories: [
      { path: "Design & Requirements", label: { de: "Design & Anforderungen", en: "Design & Requirements" }, icon: "edit" },
      {
        path: "Architecture & Components",
        label: { de: "Architektur & Komponenten", en: "Architecture & Components" },
        icon: "box",
        subModules: [
          { path: "Q-PSI Tokenizer", label: { de: "Q-PSI Tokenizer", en: "Q-PSI Tokenizer" } },
          { path: "Ammonix ECG Agent", label: { de: "Ammonix ECG Agent", en: "Ammonix ECG Agent" } },
        ],
      },
      { path: "Risk Management", label: { de: "Risikomanagement", en: "Risk Management" }, icon: "shield" },
      { path: "Validation & Testing", label: { de: "Validierung & Testing", en: "Validation & Testing" }, icon: "check" },
      { path: "Change Management", label: { de: "Änderungsmanagement", en: "Change Management" }, icon: "edit" },
      { path: "Release", label: { de: "Release", en: "Release" }, icon: "send" },
    ],
  },
  operations: {
    label: { de: "Betrieb", en: "Operations" },
    icon: "clock",
    color: "#028090",
    folderName: "Operations",
    categories: [
      {
        path: "IT Infrastructure",
        label: { de: "IT Infrastruktur", en: "IT Infrastructure" },
        icon: "table",
        subModules: [
          { path: "Google Vault", label: { de: "Google Vault", en: "Google Vault" } },
          { path: "DMS", label: { de: "DMS", en: "DMS" } },
          { path: "Security", label: { de: "Sicherheit", en: "Security" } },
        ],
      },
      { path: "Supplier Management", label: { de: "Lieferantenmanagement", en: "Supplier Management" }, icon: "users" },
      {
        path: "CAPA & Complaints",
        label: { de: "CAPA & Reklamationen", en: "CAPA & Complaints" },
        icon: "clipDoc",
        liveDocs: [
          { formsheetId: "WM-SOP-006-F-002", name: { de: "Reklamationsregister", en: "Complaint Register" } },
          { formsheetId: "WM-SOP-015-F-002", name: { de: "CAPA-Register", en: "CAPA Register" } },
        ],
      },
      { path: "Post-Market Surveillance", label: { de: "Post-Market Surveillance", en: "Post-Market Surveillance" }, icon: "eye" },
      { path: "Training & Competence", label: { de: "Schulung & Kompetenz", en: "Training & Competence" }, icon: "users" },
      {
        path: "Validation",
        label: { de: "Validierung", en: "Validation" },
        icon: "check",
        liveDocs: [
          { formsheetId: "WM-SOP-011-F-003", name: { de: "Traceability Matrix (MVP)", en: "Traceability Matrix (MVP)" }, driveSearchName: "Validation_MVP_Traceability_Matrix" },
        ],
      },
    ],
  },
};

// Get flat list of all folder paths to create (for auto-setup)
export function getFolderPaths(area) {
  const config = AREA_CONFIG[area];
  if (!config) return [];
  const paths = [];
  for (const cat of config.categories) {
    paths.push(cat.path);
    if (cat.subModules) {
      for (const sub of cat.subModules) {
        paths.push(`${cat.path}/${sub.path}`);
      }
    }
  }
  return paths;
}
