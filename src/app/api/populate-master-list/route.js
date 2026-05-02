import { google } from "googleapis";
import { findOrCreateLiveDoc } from "../../../lib/liveDocHelper";
import { FORMSHEET_REGISTRY } from "../../../lib/formsheetRegistry";
import { SOPS } from "../../../lib/dashboardHelpers";

// ═══ TAB 1: QMS Documents — SOPs + Formsheets ═══
// Columns: Document ID | Title | Type | File Type | Version | Status | Signature | Effective Date | Owner | Classification | Next Review | Location in DMS

const QMS_HEADERS = [
  "Document ID", "Title", "Type", "File Type", "Version",
  "Status", "Signature", "Effective Date", "Owner",
  "Classification", "Next Review", "Location in DMS",
];

function buildExpectedQmsDocs() {
  const docs = [];

  // SOPs + Quality Manual
  for (const sop of SOPS) {
    const isQM = sop.id.includes("QMS") || sop.id.includes("QMH");
    docs.push({
      id: sop.id,
      name: sop.en,
      type: isQM ? "QM Manual" : "SOP",
      fileType: "Word (.docx)",
      sop: "-",
    });
  }

  // Formsheets
  for (const fs of FORMSHEET_REGISTRY) {
    docs.push({
      id: fs.id,
      name: fs.name,
      type: "Form",
      fileType: fs.type === "xlsx" ? "Excel (.xlsx)" : "Word (.docx)",
      sop: fs.sop,
    });
  }

  return docs;
}

function qmsDocToRow(d) {
  return [
    d.id,                                          // Document ID
    d.name,                                        // Title
    d.type,                                        // Type (SOP / QM Manual / Form)
    d.fileType,                                    // File Type (Word / Excel / PDF)
    "1.0",                                         // Version
    "Released",                                    // Status
    "N/A",                                         // Signature (only PDFs can be signed)
    "[Date]",                                      // Effective Date
    "Quality Systems Manager",                     // Owner
    "Quality (Q)",                                 // Classification
    "[Date + 3yr]",                                // Next Review
    d.sop === "-"                                  // Location in DMS
      ? `DMS / QMH / ${d.id}`
      : `DMS / QMH / ${d.sop}`,
  ];
}

// ═══ TAB 2: Operative Document Control List — LIVE docs + Ops/Dev files ═══
// Columns: DMS Nr. | Document Name | Type | File Type | Referenced SOP | Area | Category | Status | Responsible | Created | Last Modified

const OPS_HEADERS = [
  "DMS Nr.", "Document Name", "Type", "File Type", "Referenced SOP",
  "Area", "Category", "Status", "Responsible",
  "Created", "Last Modified",
];

// LIVE documents that should appear in the Operative list
const LIVE_DOCS = [
  { id: "WM-SOP-001-F-002_LIVE", name: "Document Master List (LIVE)", type: "Live Register", fileType: "Google Sheets", sop: "WM-SOP-001", area: "QMS", category: "Document Control" },
  { id: "WM-SOP-006-F-002_LIVE", name: "Complaint Register (LIVE)", type: "Live Register", fileType: "Google Sheets", sop: "WM-SOP-006", area: "Operations", category: "CAPA & Complaints" },
  { id: "WM-SOP-011-F-003_LIVE", name: "Traceability Matrix (LIVE)", type: "Live Register", fileType: "Google Sheets", sop: "WM-SOP-011", area: "Operations", category: "Validation" },
  { id: "WM-SOP-015-F-002_LIVE", name: "CAPA Register (LIVE)", type: "Live Register", fileType: "Google Sheets", sop: "WM-SOP-015", area: "Operations", category: "CAPA & Complaints" },
  { id: "WM-SOP-017-F-002_LIVE", name: "Change Register (LIVE)", type: "Live Register", fileType: "Google Sheets", sop: "WM-SOP-017", area: "Operations", category: "Change Management" },
];

function opsDocToRow(d) {
  return [
    d.id,                    // DMS Nr.
    d.name,                  // Document Name
    d.type,                  // Type
    d.fileType,              // File Type
    d.sop,                   // Referenced SOP
    d.area,                  // Area
    d.category,              // Category
    d.status || "Live",      // Status
    d.responsible || "-",    // Responsible
    d.created || "-",        // Created
    d.lastModified || "-",   // Last Modified
  ];
}

// Helper: detect file type from name or mimeType
function detectFileType(name, mimeType) {
  if (mimeType === "application/vnd.google-apps.spreadsheet") return "Google Sheets";
  if (mimeType === "application/vnd.google-apps.document") return "Google Docs";
  const ext = (name.match(/\.(\w+)$/) || [])[1]?.toLowerCase();
  if (ext === "pdf") return "PDF";
  if (ext === "docx" || ext === "doc") return "Word (.docx)";
  if (ext === "xlsx" || ext === "xls") return "Excel (.xlsx)";
  if (ext === "pptx") return "PowerPoint (.pptx)";
  if (ext === "csv") return "CSV";
  return ext ? ext.toUpperCase() : "Unknown";
}

// Detect area category from folder path
function detectCategory(folderPath) {
  if (!folderPath) return "-";
  // Just use the top-level folder name
  const parts = folderPath.split("/");
  return parts[0] || "-";
}

// Helper: get Sheets API client + spreadsheet metadata
async function getSheetsContext(accessToken) {
  const liveDoc = await findOrCreateLiveDoc(accessToken, "WM-SOP-001-F-002", "Document Master List");
  const spreadsheetId = liveDoc.id;

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const sheets = google.sheets({ version: "v4", auth });
  const drive = google.drive({ version: "v3", auth });

  // Get sheet metadata
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = meta.data.sheets || [];

  // Find the QMS Documents tab (first tab)
  const qmsSheetName = existingSheets[0]?.properties?.title || "QMS Documents";

  // Find the Operative tab
  const opsSheet = existingSheets.find((s) =>
    s.properties.title.toLowerCase().includes("operative") ||
    s.properties.title.toLowerCase().includes("operational")
  );
  const opsSheetName = opsSheet?.properties?.title || null;

  return { sheets, drive, spreadsheetId, qmsSheetName, opsSheetName, existingSheets };
}

// Helper: read existing document IDs from column A (skip header rows)
async function readExistingIds(sheets, spreadsheetId, sheetName) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:A`,
    });

    const rows = res.data.values || [];
    const ids = new Set();
    for (const row of rows) {
      const val = (row[0] || "").trim();
      // Skip header-like rows and empty rows
      if (val && (val.startsWith("WM-") || val.startsWith("OPS-") || val.startsWith("DEV-"))) {
        ids.add(val);
      }
    }
    return ids;
  } catch {
    return new Set();
  }
}

// Helper: scan Development and Operations folders recursively for files
async function scanAreaFolder(drive, folderId, areaName, path = "") {
  const files = [];
  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "files(id,name,mimeType,createdTime,modifiedTime,lastModifyingUser)",
      pageSize: 500,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: "allDrives",
    });

    for (const f of res.data.files || []) {
      if (f.mimeType === "application/vnd.google-apps.folder") {
        // Recurse into subfolders
        const subPath = path ? `${path}/${f.name}` : f.name;
        const subFiles = await scanAreaFolder(drive, f.id, areaName, subPath);
        files.push(...subFiles);
      } else {
        // Skip _LIVE_ documents (they're handled separately)
        if (f.name.includes("_LIVE_")) continue;

        // Detect SOP reference from file name
        const sopMatch = f.name.match(/(WM-SOP-\d{3})/);
        const sopRef = sopMatch ? sopMatch[1] : "-";

        // Build a DMS number from area + sequential
        const dmsId = `${areaName.toUpperCase().slice(0, 3)}-${f.name.replace(/\.\w+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50)}`;

        files.push({
          id: dmsId,
          name: f.name,
          type: "Operative Document",
          fileType: detectFileType(f.name, f.mimeType),
          sop: sopRef,
          area: areaName,
          category: detectCategory(path),
          status: "Active",
          responsible: f.lastModifyingUser?.displayName || "-",
          created: f.createdTime ? new Date(f.createdTime).toLocaleDateString("de-DE") : "-",
          lastModified: f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString("de-DE") : "-",
        });
      }
    }
  } catch (e) {
    console.warn(`[POPULATE] Could not scan folder ${folderId}:`, e.message);
  }
  return files;
}

// Helper: find Development and Operations folder IDs
async function findAreaFolders(drive) {
  const qmhFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const qmhMeta = await drive.files.get({
    fileId: qmhFolderId,
    fields: "parents",
    supportsAllDrives: true,
  });
  const parentId = qmhMeta.data.parents?.[0];
  if (!parentId) return { devFolderId: null, opsFolderId: null };

  const siblings = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name)",
    pageSize: 50,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
  });

  let devFolderId = null;
  let opsFolderId = null;
  for (const f of siblings.data.files || []) {
    if (f.name === "Development") devFolderId = f.id;
    if (f.name === "Operations") opsFolderId = f.id;
  }

  return { devFolderId, opsFolderId };
}

// ═══ GET /api/populate-master-list — Check which documents are missing in BOTH tabs ═══
export async function GET(request) {
  try {
    const accessToken = request.headers.get("x-access-token");
    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { sheets, drive, spreadsheetId, qmsSheetName, opsSheetName } = await getSheetsContext(accessToken);

    // ── Tab 1: QMS Documents ──
    const existingQmsIds = await readExistingIds(sheets, spreadsheetId, qmsSheetName);
    const expectedQms = buildExpectedQmsDocs();
    const missingQms = expectedQms.filter((d) => !existingQmsIds.has(d.id));

    // ── Tab 2: Operative Document Control List ──
    let missingOps = [];
    let existingOpsCount = 0;
    let opsTabExists = !!opsSheetName;

    if (opsSheetName) {
      const existingOpsIds = await readExistingIds(sheets, spreadsheetId, opsSheetName);
      existingOpsCount = existingOpsIds.size;

      // Expected: LIVE docs + files from Development & Operations folders
      const expectedOps = [...LIVE_DOCS];

      // Scan Development and Operations folders
      const { devFolderId, opsFolderId } = await findAreaFolders(drive);
      if (devFolderId) {
        const devFiles = await scanAreaFolder(drive, devFolderId, "Development");
        expectedOps.push(...devFiles);
      }
      if (opsFolderId) {
        const opsFiles = await scanAreaFolder(drive, opsFolderId, "Operations");
        expectedOps.push(...opsFiles);
      }

      missingOps = expectedOps.filter((d) => !existingOpsIds.has(d.id));
    } else {
      // Tab doesn't exist yet — all LIVE docs are "missing"
      missingOps = [...LIVE_DOCS];
    }

    console.log(`[POPULATE] Check — QMS: ${existingQmsIds.size} existing, ${missingQms.length} missing | OPS: ${existingOpsCount} existing, ${missingOps.length} missing`);

    return Response.json({
      qms: {
        missing: missingQms,
        existingCount: existingQmsIds.size,
        totalExpected: expectedQms.length,
      },
      ops: {
        missing: missingOps,
        existingCount: existingOpsCount,
        tabExists: opsTabExists,
      },
      totalMissing: missingQms.length + missingOps.length,
    });
  } catch (error) {
    console.error("[POPULATE] GET error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// ═══ POST /api/populate-master-list — Append only missing documents (never delete) ═══
export async function POST(request) {
  try {
    const accessToken = request.headers.get("x-access-token");
    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { sheets, drive, spreadsheetId, qmsSheetName, opsSheetName, existingSheets } = await getSheetsContext(accessToken);
    const results = { qmsAdded: 0, opsAdded: 0, opsHeadersWritten: false };

    // ── Tab 1: QMS Documents — append missing ──
    const existingQmsIds = await readExistingIds(sheets, spreadsheetId, qmsSheetName);
    const expectedQms = buildExpectedQmsDocs();
    const missingQms = expectedQms.filter((d) => !existingQmsIds.has(d.id));

    // Check if headers exist — if sheet is empty, write headers first
    try {
      const headerCheck = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${qmsSheetName}'!A1:L1`,
      });
      const firstRow = headerCheck.data.values?.[0] || [];
      if (firstRow.length === 0) {
        // Empty sheet — write QMS headers
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${qmsSheetName}'!A1`,
          valueInputOption: "RAW",
          requestBody: { values: [QMS_HEADERS] },
        });
        // Format header row
        const qmsSheetId = existingSheets[0]?.properties?.sheetId || 0;
        await formatHeaderRow(sheets, spreadsheetId, qmsSheetId, QMS_HEADERS.length);
      }
    } catch { /* ignore */ }

    if (missingQms.length > 0) {
      const newRows = missingQms.map(qmsDocToRow);
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${qmsSheetName}'!A:L`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: newRows },
      });
      results.qmsAdded = missingQms.length;
    }

    // ── Tab 2: Operative Document Control List — write headers + append missing ──
    let targetOpsSheet = opsSheetName;

    if (!targetOpsSheet) {
      // Tab doesn't exist — skip (user needs to create it manually or we can note it)
      console.log("[POPULATE] Operative tab not found — skipping ops populate");
      results.opsNote = "Operative Document Control List tab not found in spreadsheet";
    } else {
      // Check if headers exist
      try {
        const opsHeaderCheck = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'${targetOpsSheet}'!A1:K1`,
        });
        const opsFirstRow = opsHeaderCheck.data.values?.[0] || [];
        if (opsFirstRow.length === 0) {
          // Empty tab — write headers
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `'${targetOpsSheet}'!A1`,
            valueInputOption: "RAW",
            requestBody: { values: [OPS_HEADERS] },
          });
          // Find the sheet ID for the Operative tab
          const opsSheetMeta = existingSheets.find((s) =>
            s.properties.title === targetOpsSheet
          );
          if (opsSheetMeta) {
            await formatHeaderRow(sheets, spreadsheetId, opsSheetMeta.properties.sheetId, OPS_HEADERS.length);
          }
          results.opsHeadersWritten = true;
        }
      } catch { /* ignore */ }

      // Read existing ops IDs and append missing
      const existingOpsIds = await readExistingIds(sheets, spreadsheetId, targetOpsSheet);

      // Build expected ops docs: LIVE docs + scanned files
      const expectedOps = [...LIVE_DOCS];
      const { devFolderId, opsFolderId } = await findAreaFolders(drive);
      if (devFolderId) {
        const devFiles = await scanAreaFolder(drive, devFolderId, "Development");
        expectedOps.push(...devFiles);
      }
      if (opsFolderId) {
        const opsFiles = await scanAreaFolder(drive, opsFolderId, "Operations");
        expectedOps.push(...opsFiles);
      }

      const missingOps = expectedOps.filter((d) => !existingOpsIds.has(d.id));

      if (missingOps.length > 0) {
        const newOpsRows = missingOps.map(opsDocToRow);
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `'${targetOpsSheet}'!A:K`,
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: newOpsRows },
        });
        results.opsAdded = missingOps.length;
      }
    }

    const totalAdded = results.qmsAdded + results.opsAdded;
    console.log(`[POPULATE] Done — QMS: +${results.qmsAdded}, OPS: +${results.opsAdded}`);

    return Response.json({
      ...results,
      totalAdded,
      message: totalAdded === 0 ? "All documents already present" : `${totalAdded} documents added`,
    });
  } catch (error) {
    console.error("[POPULATE] POST error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// Helper: format header row (bold, background, freeze)
async function formatHeaderRow(sheets, spreadsheetId, sheetId, colCount) {
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: colCount },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true, fontSize: 10 },
                  backgroundColor: { red: 0.85, green: 0.92, blue: 0.98 },
                  horizontalAlignment: "CENTER",
                },
              },
              fields: "userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)",
            },
          },
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: "gridProperties.frozenRowCount",
            },
          },
          {
            autoResizeDimensions: {
              dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: colCount },
            },
          },
        ],
      },
    });
  } catch (e) {
    console.warn("[POPULATE] Could not format header:", e.message);
  }
}
