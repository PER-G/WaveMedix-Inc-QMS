// ═══ FORMSHEET TEMPLATE REGISTRY ═══
// Maps formsheet IDs to their full names for Claude to recognize
// This is the single source of truth for all formsheet templates.

export const FORMSHEET_REGISTRY = [
  // Document formsheets (docx)
  { id: "WM-SOP-001-F-001", name: "Document Change Request", sop: "WM-SOP-001", type: "docx" },
  { id: "WM-SOP-001-T-001", name: "SOP Template", sop: "WM-SOP-001", type: "docx" },
  { id: "WM-SOP-003-F-002", name: "Design Review Minutes", sop: "WM-SOP-003", type: "docx" },
  { id: "WM-SOP-003-F-003", name: "Release Approval Form", sop: "WM-SOP-003", type: "docx" },
  { id: "WM-SOP-003-F-004", name: "User Requirements Specification", sop: "WM-SOP-003", type: "docx" },
  { id: "WM-SOP-004-F-002", name: "Risk Management Plan", sop: "WM-SOP-004", type: "docx" },
  { id: "WM-SOP-005-F-001", name: "Trending Report", sop: "WM-SOP-005", type: "docx" },
  { id: "WM-SOP-006-F-001", name: "Complaint / Adverse Event Form", sop: "WM-SOP-006", type: "docx" },
  { id: "WM-SOP-007-F-001", name: "PMS Plan", sop: "WM-SOP-007", type: "docx" },
  { id: "WM-SOP-007-F-002", name: "PMS Report / PSUR", sop: "WM-SOP-007", type: "docx" },
  { id: "WM-SOP-008-F-001", name: "Deployment Checklist", sop: "WM-SOP-008", type: "docx" },
  { id: "WM-SOP-008-F-002", name: "Field Evaluation Report", sop: "WM-SOP-008", type: "docx" },
  { id: "WM-SOP-011-F-001", name: "Validation Plan", sop: "WM-SOP-011", type: "docx" },
  { id: "WM-SOP-011-F-004", name: "Test Summary Report", sop: "WM-SOP-011", type: "docx" },
  { id: "WM-SOP-011-F-005", name: "Test System Qualification Protocol", sop: "WM-SOP-011", type: "docx" },
  { id: "WM-SOP-012-F-002", name: "Audit Report Template", sop: "WM-SOP-012", type: "docx" },
  { id: "WM-SOP-013-F-001", name: "IT Security Assessment", sop: "WM-SOP-013", type: "docx" },
  { id: "WM-SOP-013-F-002", name: "DMS Qualification Protocol", sop: "WM-SOP-013", type: "docx" },
  { id: "WM-SOP-015-F-001", name: "CAPA Form", sop: "WM-SOP-015", type: "docx" },
  { id: "WM-SOP-016-F-001", name: "Retraining Request / Plan", sop: "WM-SOP-016", type: "docx" },
  { id: "WM-SOP-016-F-002", name: "Training Report", sop: "WM-SOP-016", type: "docx" },
  { id: "WM-SOP-017-F-002", name: "Data Quality Report", sop: "WM-SOP-017", type: "docx" },
  { id: "WM-SOP-018-F-001", name: "Engineering Change Request (ECR)", sop: "WM-SOP-018", type: "docx" },
  { id: "WM-SOP-019-F-001", name: "PCCP Change Record", sop: "WM-SOP-019", type: "docx" },
  // Spreadsheet formsheets (xlsx)
  { id: "WM-SOP-001-F-002", name: "Document Master List", sop: "WM-SOP-001", type: "xlsx" },
  { id: "WM-SOP-002-F-001", name: "Record Retention Matrix", sop: "WM-SOP-002", type: "xlsx" },
  { id: "WM-SOP-003-F-001", name: "Design I/O Checklist", sop: "WM-SOP-003", type: "xlsx" },
  { id: "WM-SOP-004-F-001", name: "Risk Analysis / FMEA", sop: "WM-SOP-004", type: "xlsx" },
  { id: "WM-SOP-005-F-002", name: "KPI Dashboard", sop: "WM-SOP-005", type: "xlsx" },
  { id: "WM-SOP-006-F-002", name: "Complaint Register", sop: "WM-SOP-006", type: "xlsx" },
  { id: "WM-SOP-009-F-001", name: "Regulatory Change Log", sop: "WM-SOP-009", type: "xlsx" },
  { id: "WM-SOP-010-F-001", name: "Approved Supplier List", sop: "WM-SOP-010", type: "xlsx" },
  { id: "WM-SOP-011-F-002", name: "Test Protocol / Test Cases", sop: "WM-SOP-011", type: "xlsx" },
  { id: "WM-SOP-011-F-003", name: "Traceability Matrix", sop: "WM-SOP-011", type: "xlsx" },
  { id: "WM-SOP-012-F-001", name: "Audit Schedule & Finding Tracker", sop: "WM-SOP-012", type: "xlsx" },
  { id: "WM-SOP-015-F-002", name: "CAPA Register", sop: "WM-SOP-015", type: "xlsx" },
  { id: "WM-SOP-017-F-001", name: "Data Source Registry", sop: "WM-SOP-017", type: "xlsx" },
  { id: "WM-SOP-018-F-002", name: "Change Register", sop: "WM-SOP-018", type: "xlsx" },
  { id: "WM-SOP-019-F-002", name: "PCCP Master Record", sop: "WM-SOP-019", type: "xlsx" },
];

// Helper: get registry list formatted for prompts
export function getRegistryPromptList() {
  return FORMSHEET_REGISTRY.map(
    (f) => `${f.id}: ${f.name} (${f.sop}, ${f.type})`
  ).join("\n");
}

// Helper: find registry entry by ID
export function findFormsheet(formsheetId) {
  return FORMSHEET_REGISTRY.find((f) => f.id === formsheetId);
}
