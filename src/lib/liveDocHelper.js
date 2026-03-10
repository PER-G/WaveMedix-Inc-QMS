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

// Search QMH folder (recursively) for a file matching the formsheet ID
async function findTemplateFile(drive, folderId, formsheetId) {
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
      const found = await findTemplateFile(drive, f.id, formsheetId);
      if (found) return found;
    } else if (f.name.includes(formsheetId)) {
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
export async function findOrCreateLiveDoc(accessToken, formsheetId, formsheetName) {
  const drive = createDriveClient(accessToken);
  const qmhFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!qmhFolderId) throw new Error("QMH folder ID not configured");

  // Check if live doc already exists
  let liveDoc = await findLiveDoc(drive, qmhFolderId, formsheetId);
  if (liveDoc) {
    return formatLiveDoc(liveDoc);
  }

  // Find the template
  const template = await findTemplateFile(drive, qmhFolderId, formsheetId);
  if (!template) {
    throw new Error(`Template not found for ${formsheetId}`);
  }

  // Create the live document
  liveDoc = await createLiveDoc(drive, qmhFolderId, template, formsheetId, formsheetName);
  return formatLiveDoc(liveDoc);
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
