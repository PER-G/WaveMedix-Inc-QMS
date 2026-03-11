// ═══ LIVE DOCUMENT HELPER ═══
// Manages "live" register documents — continuous monitoring spreadsheets
// that are copies of formsheet templates, kept in the QMH folder.

import { google } from "googleapis";

const LIVE_PREFIX = "_LIVE_";

function createDriveClient(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

// Search QMH folder (recursively) for a file matching the formsheet ID or alt name
async function findTemplateFile(drive, folderId, formsheetId, altSearchName) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id,name,mimeType)",
    pageSize: 500,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
  });

  for (const f of res.data.files || []) {
    if (f.mimeType === "application/vnd.google-apps.folder") {
      const found = await findTemplateFile(drive, f.id, formsheetId, altSearchName);
      if (found) return found;
    } else if (f.name.includes(formsheetId)) {
      return f;
    } else if (altSearchName && f.name.includes(altSearchName)) {
      return f;
    }
  }
  return null;
}

// Find an existing live document in the QMH folder
async function findLiveDoc(drive, qmhFolderId, formsheetId) {
  const liveFileName = `${formsheetId}${LIVE_PREFIX}`;
  const res = await drive.files.list({
    q: `'${qmhFolderId}' in parents and trashed = false and name contains '${formsheetId}' and name contains '${LIVE_PREFIX}'`,
    fields: "files(id,name,mimeType,webViewLink,modifiedTime,lastModifyingUser)",
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
  });

  return (res.data.files || [])[0] || null;
}

// Create a live document by copying the template
async function createLiveDoc(drive, qmhFolderId, templateFile, formsheetId, formsheetName) {
  // Copy template to QMH root
  const copy = await drive.files.copy({
    fileId: templateFile.id,
    requestBody: {
      name: `${formsheetId}${LIVE_PREFIX}${formsheetName}`,
      parents: [qmhFolderId],
      // Convert to Google Sheets for live editing
      mimeType: "application/vnd.google-apps.spreadsheet",
    },
    supportsAllDrives: true,
    fields: "id,name,mimeType,webViewLink,modifiedTime,lastModifyingUser",
  });

  console.log(`[LIVE-DOC] Created live document: ${copy.data.name} (${copy.data.id})`);
  return copy.data;
}

// Find or create a live document
export async function findOrCreateLiveDoc(accessToken, formsheetId, formsheetName, altSearchName) {
  const drive = createDriveClient(accessToken);
  const qmhFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!qmhFolderId) throw new Error("QMH folder ID not configured");

  // Check if live doc already exists
  let liveDoc = await findLiveDoc(drive, qmhFolderId, formsheetId);
  if (liveDoc) {
    return formatLiveDoc(liveDoc);
  }

  // Find the template (also try altSearchName if provided)
  const template = await findTemplateFile(drive, qmhFolderId, formsheetId, altSearchName);
  if (!template) {
    throw new Error(`Template not found for ${formsheetId}`);
  }

  // Create the live document
  liveDoc = await createLiveDoc(drive, qmhFolderId, template, formsheetId, formsheetName);
  return formatLiveDoc(liveDoc);
}

// Find or create a BLANK live document (no template needed — creates empty Google Sheet with headers)
export async function findOrCreateBlankLiveDoc(accessToken, docId, docName, headers) {
  const drive = createDriveClient(accessToken);
  const qmhFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!qmhFolderId) throw new Error("QMH folder ID not configured");

  // Check if live doc already exists
  let liveDoc = await findLiveDoc(drive, qmhFolderId, docId);
  if (liveDoc) {
    return formatLiveDoc(liveDoc);
  }

  // Create a blank Google Sheet
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const sheets = google.sheets({ version: "v4", auth });

  // Create the spreadsheet via Sheets API
  const sheetRes = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `${docId}${LIVE_PREFIX}${docName}` },
      sheets: [{ properties: { title: "Register" } }],
    },
  });

  const newSheetId = sheetRes.data.spreadsheetId;

  // Move to QMH folder
  const fileInfo = await drive.files.get({ fileId: newSheetId, fields: "parents", supportsAllDrives: true });
  const prevParent = (fileInfo.data.parents || [])[0];
  await drive.files.update({
    fileId: newSheetId,
    addParents: qmhFolderId,
    removeParents: prevParent || undefined,
    supportsAllDrives: true,
  });

  // Write header row if provided
  if (headers && headers.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: newSheetId,
      range: "Register!A1",
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });

    // Format header: bold + background + freeze
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: newSheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
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
              properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } },
              fields: "gridProperties.frozenRowCount",
            },
          },
          {
            autoResizeDimensions: {
              dimensions: { sheetId: 0, dimension: "COLUMNS", startIndex: 0, endIndex: headers.length },
            },
          },
        ],
      },
    });
  }

  // Fetch the created file metadata
  const created = await drive.files.get({
    fileId: newSheetId,
    fields: "id,name,mimeType,webViewLink,modifiedTime,lastModifyingUser",
    supportsAllDrives: true,
  });

  console.log(`[LIVE-DOC] Created blank live document: ${created.data.name} (${created.data.id})`);
  return formatLiveDoc(created.data);
}

// Get metadata for an existing live document
export async function getLiveDocInfo(accessToken, fileId) {
  const drive = createDriveClient(accessToken);
  const res = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,webViewLink,modifiedTime,lastModifyingUser",
    supportsAllDrives: true,
  });
  return formatLiveDoc(res.data);
}

function formatLiveDoc(file) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    webViewLink: file.webViewLink,
    lastModified: file.modifiedTime,
    modifiedBy: file.lastModifyingUser?.displayName || "Unknown",
  };
}
