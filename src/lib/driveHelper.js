import { google } from "googleapis";

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

// ═══ In-Memory Cache ═══
// Caches SOP text with 15-minute TTL to avoid redundant Drive API calls
const sopTextCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000;

function getCached(key) {
  const entry = sopTextCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.text;
  }
  sopTextCache.delete(key);
  return null;
}

function setCache(key, text) {
  sopTextCache.set(key, { text, timestamp: Date.now() });
}

// ═══ Create authenticated Drive client ═══
export function getDriveClient(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

// ═══ Find SOP document in Drive by SOP ID ═══
// Searches for the main SOP document (not formsheets) matching the SOP ID pattern
export async function findSopFile(drive, sopId) {
  // Search in the root QMS folder and subfolders
  const rootItems = await drive.files.list({
    q: `'${FOLDER_ID}' in parents and trashed = false`,
    fields: "files(id,name,mimeType)",
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
  });

  const allFolders = [];
  const allFiles = [];

  for (const item of rootItems.data.files || []) {
    if (item.mimeType === "application/vnd.google-apps.folder") {
      if (!item.name.toLowerCase().startsWith("old")) {
        allFolders.push(item);
      }
    } else {
      allFiles.push(item);
    }
  }

  // Check root-level files first (skip SUPERSEDED, formsheets, templates)
  const rootMatch = allFiles.find(
    (f) => f.name.includes(sopId) && !f.name.match(/[-_](F-?\d{3}|T-?\d{3})/) && !f.name.includes("SUPERSEDED")
  );
  if (rootMatch) return rootMatch;

  // Search in SOP subfolders
  for (const folder of allFolders) {
    if (!folder.name.includes(sopId)) continue;
    const subItems = await drive.files.list({
      q: `'${folder.id}' in parents and trashed = false and name contains '${sopId}'`,
      fields: "files(id,name,mimeType)",
      pageSize: 50,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: "allDrives",
    });
    // Find the main SOP doc (not a formsheet F-XXX or template T-XXX, not SUPERSEDED)
    const sopDoc = (subItems.data.files || []).find(
      (f) =>
        f.name.includes(sopId) &&
        !f.name.match(/[-_](F-?\d{3}|T-?\d{3})/) &&
        !f.name.includes("SUPERSEDED") &&
        f.mimeType !== "application/vnd.google-apps.folder"
    );
    if (sopDoc) return sopDoc;
  }

  return null;
}

// ═══ Export file content as text ═══
export async function exportFileAsText(drive, file) {
  if (file.mimeType === "application/vnd.google-apps.document") {
    const res = await drive.files.export({
      fileId: file.id,
      mimeType: "text/plain",
    });
    return typeof res.data === "string" ? res.data : String(res.data);
  }
  if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
    const res = await drive.files.export({
      fileId: file.id,
      mimeType: "text/csv",
    });
    return typeof res.data === "string" ? res.data : String(res.data);
  }
  // Regular file
  try {
    const res = await drive.files.get(
      { fileId: file.id, alt: "media" },
      { responseType: "text" }
    );
    return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  } catch {
    return null;
  }
}

// ═══ PUBLIC: Fetch a single SOP's full text ═══
// maxChars: limit text length (default 4000 for chat, use 2000 for fill to save tokens)
export async function fetchSopText(accessToken, sopId, maxChars = 4000) {
  // Check cache first (cache stores full 4000-char version)
  const cached = getCached(sopId);
  if (cached) {
    return cached.length > maxChars ? cached.substring(0, maxChars) + "\n[... gekürzt ...]" : cached;
  }

  try {
    const drive = getDriveClient(accessToken);
    const sopFile = await findSopFile(drive, sopId);
    if (!sopFile) return null;

    const text = await exportFileAsText(drive, sopFile);
    if (text) {
      // Cache at 4000 chars
      const capped = text.length > 4000 ? text.substring(0, 4000) + "\n[... gekürzt ...]" : text;
      setCache(sopId, capped);
      return capped.length > maxChars ? capped.substring(0, maxChars) + "\n[... gekürzt ...]" : capped;
    }
    return null;
  } catch (err) {
    console.error(`Failed to fetch SOP ${sopId}:`, err.message);
    return null;
  }
}

// ═══ PUBLIC: Fetch all SOP texts (for rule extraction) ═══
export async function fetchAllSopTexts(accessToken) {
  const SOP_IDS = [
    "WM-QMS-001", "WM-SOP-001", "WM-SOP-002", "WM-SOP-003", "WM-SOP-004",
    "WM-SOP-005", "WM-SOP-006", "WM-SOP-007", "WM-SOP-008", "WM-SOP-009",
    "WM-SOP-010", "WM-SOP-011", "WM-SOP-012", "WM-SOP-013", "WM-SOP-014",
    "WM-SOP-015", "WM-SOP-016", "WM-SOP-017", "WM-SOP-018",
  ];

  const results = {};
  for (const sopId of SOP_IDS) {
    const text = await fetchSopText(accessToken, sopId);
    if (text) {
      results[sopId] = text;
    }
  }
  return results;
}
