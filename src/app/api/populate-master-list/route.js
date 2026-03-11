import { google } from "googleapis";
import { findOrCreateLiveDoc } from "../../../lib/liveDocHelper";
import { FORMSHEET_REGISTRY } from "../../../lib/formsheetRegistry";
import { SOPS } from "../../../lib/dashboardHelpers";

// POST /api/populate-master-list — Write all SOPs + formsheets into the Document Master List
export async function POST(request) {
  try {
    const accessToken = request.headers.get("x-access-token");
    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    // 1. Get the live Document Master List
    const liveDoc = await findOrCreateLiveDoc(accessToken, "WM-SOP-001-F-002", "Document Master List");
    const sheetId = liveDoc.id;

    // 2. Set up Sheets API
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const sheets = google.sheets({ version: "v4", auth });

    // 3. Build header + data rows
    const headers = [
      "Dokument-ID",
      "Dokumentenname (DE)",
      "Dokumentenname (EN)",
      "Typ",
      "Zugehöriger SOP",
      "Format",
      "Version",
      "Status",
    ];

    const rows = [];

    // SOPs (including Quality Manual)
    for (const sop of SOPS) {
      const isQM = sop.id.includes("QMS") || sop.id.includes("QMH");
      rows.push([
        sop.id,
        sop.de,
        sop.en,
        isQM ? "QM-Handbuch" : "SOP",
        "-",
        "docx",
        "1.0",
        "Active",
      ]);
    }

    // Formsheets
    for (const fs of FORMSHEET_REGISTRY) {
      rows.push([
        fs.id,
        fs.name,
        fs.name,
        "Formblatt",
        fs.sop,
        fs.type,
        "1.0",
        "Active",
      ]);
    }

    // 4. Clear existing content and write fresh
    try {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: sheetId,
        range: "Sheet1",
      });
    } catch {
      // Sheet might use different name — try the first sheet
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      const firstSheet = meta.data.sheets?.[0]?.properties?.title || "Sheet1";
      await sheets.spreadsheets.values.clear({
        spreadsheetId: sheetId,
        range: firstSheet,
      });
    }

    // Get the first sheet name for writing
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const sheetName = meta.data.sheets?.[0]?.properties?.title || "Sheet1";

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [headers, ...rows],
      },
    });

    // 5. Format header row (bold + freeze)
    const sheetGid = meta.data.sheets?.[0]?.properties?.sheetId || 0;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId: sheetGid, startRowIndex: 0, endRowIndex: 1 },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true },
                  backgroundColor: { red: 0.85, green: 0.92, blue: 0.98 },
                },
              },
              fields: "userEnteredFormat(textFormat,backgroundColor)",
            },
          },
          {
            updateSheetProperties: {
              properties: { sheetId: sheetGid, gridProperties: { frozenRowCount: 1 } },
              fields: "gridProperties.frozenRowCount",
            },
          },
          {
            autoResizeDimensions: {
              dimensions: { sheetId: sheetGid, dimension: "COLUMNS", startIndex: 0, endIndex: headers.length },
            },
          },
        ],
      },
    });

    console.log(`[POPULATE] Wrote ${SOPS.length} SOPs + ${FORMSHEET_REGISTRY.length} formsheets to Document Master List`);

    return Response.json({
      success: true,
      sopCount: SOPS.length,
      formsheetCount: FORMSHEET_REGISTRY.length,
      totalRows: rows.length,
    });
  } catch (error) {
    console.error("[POPULATE] Error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
