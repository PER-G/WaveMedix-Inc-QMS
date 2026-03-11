import { google } from "googleapis";
import { findOrCreateLiveDoc } from "../../../lib/liveDocHelper";
import { FORMSHEET_REGISTRY } from "../../../lib/formsheetRegistry";
import { SOPS } from "../../../lib/dashboardHelpers";

// Build the complete list of expected QMS documents
function buildExpectedDocs() {
  const docs = [];

  // SOPs + Quality Manual
  for (const sop of SOPS) {
    const isQM = sop.id.includes("QMS") || sop.id.includes("QMH");
    docs.push({
      id: sop.id,
      name: sop.en,
      type: isQM ? "QM Manual" : "SOP",
      sop: "-",
      format: "docx",
    });
  }

  // Formsheets
  for (const fs of FORMSHEET_REGISTRY) {
    docs.push({
      id: fs.id,
      name: fs.name,
      type: fs.type === "xlsx" ? "Form" : "Form",
      sop: fs.sop,
      format: fs.type,
    });
  }

  return docs;
}

// Helper: get Sheets API client + spreadsheet metadata
async function getSheetsContext(accessToken) {
  const liveDoc = await findOrCreateLiveDoc(accessToken, "WM-SOP-001-F-002", "Document Master List");
  const spreadsheetId = liveDoc.id;

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const sheets = google.sheets({ version: "v4", auth });

  // Get sheet metadata
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = meta.data.sheets || [];
  const firstSheetName = existingSheets[0]?.properties?.title || "QMS Documents";

  return { sheets, spreadsheetId, firstSheetName };
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
      if (val && val.startsWith("WM-")) {
        ids.add(val);
      }
    }
    return ids;
  } catch {
    return new Set();
  }
}

// GET /api/populate-master-list — Check which documents are missing
export async function GET(request) {
  try {
    const accessToken = request.headers.get("x-access-token");
    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { sheets, spreadsheetId, firstSheetName } = await getSheetsContext(accessToken);

    // Read existing document IDs
    const existingIds = await readExistingIds(sheets, spreadsheetId, firstSheetName);

    // Build expected documents
    const expectedDocs = buildExpectedDocs();

    // Find missing
    const missing = expectedDocs.filter((d) => !existingIds.has(d.id));

    console.log(`[POPULATE] Check: ${existingIds.size} existing, ${missing.length} missing of ${expectedDocs.length} expected`);

    return Response.json({
      missing,
      existingCount: existingIds.size,
      totalExpected: expectedDocs.length,
    });
  } catch (error) {
    console.error("[POPULATE] GET error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/populate-master-list — Append only missing documents (never delete)
export async function POST(request) {
  try {
    const accessToken = request.headers.get("x-access-token");
    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { sheets, spreadsheetId, firstSheetName } = await getSheetsContext(accessToken);

    // Re-read existing IDs (safety check against duplicates)
    const existingIds = await readExistingIds(sheets, spreadsheetId, firstSheetName);

    // Build expected and filter to only missing
    const expectedDocs = buildExpectedDocs();
    const missing = expectedDocs.filter((d) => !existingIds.has(d.id));

    if (missing.length === 0) {
      return Response.json({ added: 0, skipped: expectedDocs.length, message: "All documents already present" });
    }

    // Build rows matching existing sheet format:
    // Document ID | Title | Type | Version | Status | Effective Date | Owner | Classification | Next Review | Location in DMS
    const newRows = missing.map((d) => [
      d.id,                                          // Document ID
      d.name,                                        // Title
      d.type,                                        // Type (SOP / QM Manual / Form)
      "1.0",                                         // Version
      "Released",                                    // Status
      "[Date]",                                      // Effective Date
      "Quality Systems Manager",                     // Owner
      "Quality (Q)",                                 // Classification
      "[Date + 3yr]",                                // Next Review
      d.sop === "-"                                  // Location in DMS
        ? `/QMS/01_Documents/SOPs/${d.id}/`
        : `/QMS/01_Documents/Forms/${d.sop}/`,
    ]);

    // Append rows at the end (never clear, never delete)
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${firstSheetName}'!A:J`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: newRows },
    });

    console.log(`[POPULATE] Appended ${missing.length} missing documents (skipped ${existingIds.size} existing)`);

    return Response.json({
      added: missing.length,
      skipped: existingIds.size,
      addedDocs: missing.map((d) => d.id),
    });
  } catch (error) {
    console.error("[POPULATE] POST error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
