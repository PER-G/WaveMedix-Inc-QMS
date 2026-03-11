import { google } from "googleapis";
import { findOrCreateLiveDoc } from "../../../lib/liveDocHelper";
import { FORMSHEET_REGISTRY } from "../../../lib/formsheetRegistry";
import { SOPS } from "../../../lib/dashboardHelpers";

const OPS_TAB_NAME = "Operative Dokumentenlenkungsliste";
const OPS_HEADERS = [
  "DMS Nr.",
  "Referenz-SOP",
  "Dokumentenname",
  "Version",
  "Status",
  "Erstellt am",
  "Zuletzt ge\u00E4ndert",
  "Verantwortlich",
  "Bemerkungen",
];

// POST /api/populate-master-list — Write all SOPs + formsheets + create Ops tab
export async function POST(request) {
  try {
    const accessToken = request.headers.get("x-access-token");
    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    // 1. Get the live Document Master List
    const liveDoc = await findOrCreateLiveDoc(accessToken, "WM-SOP-001-F-002", "Document Master List");
    const spreadsheetId = liveDoc.id;

    // 2. Set up Sheets API
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const sheets = google.sheets({ version: "v4", auth });

    // 3. Get current sheet metadata
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheets = meta.data.sheets || [];
    const sheetNames = existingSheets.map((s) => s.properties.title);
    const firstSheet = existingSheets[0];
    const firstSheetName = firstSheet?.properties?.title || "QMS Documents";
    const firstSheetGid = firstSheet?.properties?.sheetId || 0;

    // 4. Build QMS document rows
    const qmsHeaders = [
      "Dokument-ID",
      "Dokumentenname (DE)",
      "Dokumentenname (EN)",
      "Typ",
      "Zugeh\u00F6riger SOP",
      "Format",
      "Version",
      "Status",
    ];

    const rows = [];

    // SOPs (including Quality Manual)
    for (const sop of SOPS) {
      const isQM = sop.id.includes("QMS") || sop.id.includes("QMH");
      rows.push([
        sop.id, sop.de, sop.en,
        isQM ? "QM-Handbuch" : "SOP",
        "-", "docx", "1.0", "Active",
      ]);
    }

    // Formsheets
    for (const fs of FORMSHEET_REGISTRY) {
      rows.push([
        fs.id, fs.name, fs.name,
        "Formblatt", fs.sop, fs.type, "1.0", "Active",
      ]);
    }

    // 5. Write QMS Documents to first sheet
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${firstSheetName}'`,
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${firstSheetName}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [qmsHeaders, ...rows] },
    });

    // Format first sheet header
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId: firstSheetGid, startRowIndex: 0, endRowIndex: 1 },
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
              properties: { sheetId: firstSheetGid, gridProperties: { frozenRowCount: 1 } },
              fields: "gridProperties.frozenRowCount",
            },
          },
          {
            autoResizeDimensions: {
              dimensions: { sheetId: firstSheetGid, dimension: "COLUMNS", startIndex: 0, endIndex: qmsHeaders.length },
            },
          },
        ],
      },
    });

    // 6. Create "Operative Dokumentenlenkungsliste" tab if it doesn't exist
    let opsTabCreated = false;
    if (!sheetNames.includes(OPS_TAB_NAME)) {
      // Find the position: should be after first sheet, before "External References"
      const extRefIndex = sheetNames.indexOf("External References");
      const insertIndex = extRefIndex >= 0 ? extRefIndex : existingSheets.length;

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: OPS_TAB_NAME,
                  index: insertIndex,
                },
              },
            },
          ],
        },
      });

      // Get the new sheet's ID
      const updatedMeta = await sheets.spreadsheets.get({ spreadsheetId });
      const opsSheet = updatedMeta.data.sheets.find((s) => s.properties.title === OPS_TAB_NAME);
      const opsGid = opsSheet?.properties?.sheetId || 0;

      // Write headers
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${OPS_TAB_NAME}'!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [OPS_HEADERS] },
      });

      // Format ops header
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: { sheetId: opsGid, startRowIndex: 0, endRowIndex: 1 },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true },
                    backgroundColor: { red: 0.84, green: 0.95, blue: 0.9 },
                  },
                },
                fields: "userEnteredFormat(textFormat,backgroundColor)",
              },
            },
            {
              updateSheetProperties: {
                properties: { sheetId: opsGid, gridProperties: { frozenRowCount: 1 } },
                fields: "gridProperties.frozenRowCount",
              },
            },
            {
              autoResizeDimensions: {
                dimensions: { sheetId: opsGid, dimension: "COLUMNS", startIndex: 0, endIndex: OPS_HEADERS.length },
              },
            },
          ],
        },
      });

      opsTabCreated = true;
      console.log(`[POPULATE] Created '${OPS_TAB_NAME}' tab in Document Master List`);
    }

    console.log(`[POPULATE] Wrote ${SOPS.length} SOPs + ${FORMSHEET_REGISTRY.length} formsheets to Document Master List`);

    return Response.json({
      success: true,
      sopCount: SOPS.length,
      formsheetCount: FORMSHEET_REGISTRY.length,
      totalRows: rows.length,
      opsTabCreated,
    });
  } catch (error) {
    console.error("[POPULATE] Error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
