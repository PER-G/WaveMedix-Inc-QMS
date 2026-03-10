import { google } from "googleapis";
import crypto from "crypto";

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

const QUEUE_SHEET_NAME = "QMS_Approval_Queue";
const LOG_SHEET_NAME = "QMS_Signature_Log";

const QUEUE_HEADERS = [
  "requestId", "fileId", "fileName", "formsheetId", "version", "previousVersionFileId",
  "status", "authorEmail", "authorName", "submittedAt",
  "signatoryAuthor", "signatoryReviewer", "signatoryApprover",
  "adobeAgreementId", "documentHash",
  "signedAuthor", "signedReviewer", "signedApprover",
  "finalizedAt", "finalFileId", "changeRequestId", "notes",
];

const LOG_HEADERS = [
  "logId", "requestId", "action", "actorEmail", "actorName",
  "timestamp", "documentHash", "fileId", "details",
];

// ═══ Auth helpers ═══

function getAuthClient(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

function getSheetsClient(accessToken) {
  return google.sheets({ version: "v4", auth: getAuthClient(accessToken) });
}

function getDriveClient(accessToken) {
  return google.drive({ version: "v3", auth: getAuthClient(accessToken) });
}

// ═══ Sheet discovery / creation ═══

let cachedSheetIds = null;
let cacheTime = 0;
const SHEET_CACHE_TTL = 10 * 60 * 1000; // 10 min

export async function ensureSheets(accessToken) {
  if (cachedSheetIds && Date.now() - cacheTime < SHEET_CACHE_TTL) {
    return cachedSheetIds;
  }

  const drive = getDriveClient(accessToken);

  // Search for existing sheets in QMH folder
  const res = await drive.files.list({
    q: `'${FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: "files(id,name)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const files = res.data.files || [];
  let queueId = files.find((f) => f.name === QUEUE_SHEET_NAME)?.id;
  let logId = files.find((f) => f.name === LOG_SHEET_NAME)?.id;

  const sheets = getSheetsClient(accessToken);

  // Create queue sheet if not found
  if (!queueId) {
    console.log("[SHEETS] Creating", QUEUE_SHEET_NAME);
    const created = await drive.files.create({
      requestBody: {
        name: QUEUE_SHEET_NAME,
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: [FOLDER_ID],
      },
      supportsAllDrives: true,
    });
    queueId = created.data.id;
    await sheets.spreadsheets.values.update({
      spreadsheetId: queueId,
      range: "Sheet1!A1",
      valueInputOption: "RAW",
      requestBody: { values: [QUEUE_HEADERS] },
    });
  }

  // Create log sheet if not found
  if (!logId) {
    console.log("[SHEETS] Creating", LOG_SHEET_NAME);
    const created = await drive.files.create({
      requestBody: {
        name: LOG_SHEET_NAME,
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: [FOLDER_ID],
      },
      supportsAllDrives: true,
    });
    logId = created.data.id;
    await sheets.spreadsheets.values.update({
      spreadsheetId: logId,
      range: "Sheet1!A1",
      valueInputOption: "RAW",
      requestBody: { values: [LOG_HEADERS] },
    });
  }

  cachedSheetIds = { queueId, logId };
  cacheTime = Date.now();
  return cachedSheetIds;
}

// ═══ Document hash ═══

export async function computeDocumentHash(accessToken, fileId) {
  const drive = getDriveClient(accessToken);
  const meta = await drive.files.get({
    fileId,
    fields: "mimeType",
    supportsAllDrives: true,
  });

  let content;
  const mime = meta.data.mimeType;

  if (mime === "application/vnd.google-apps.document") {
    const exp = await drive.files.export({ fileId, mimeType: "text/plain" });
    content = exp.data;
  } else if (mime === "application/vnd.google-apps.spreadsheet") {
    const exp = await drive.files.export({ fileId, mimeType: "text/csv" });
    content = exp.data;
  } else {
    const dl = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );
    content = Buffer.from(dl.data);
  }

  const text = typeof content === "string" ? content : content.toString("utf8");
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// ═══ Queue operations ═══

async function readSheet(accessToken, sheetId) {
  const sheets = getSheetsClient(accessToken);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Sheet1",
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ""; });
    return obj;
  });
}

export async function getApprovalQueue(accessToken) {
  const { queueId } = await ensureSheets(accessToken);
  return readSheet(accessToken, queueId);
}

export async function getPendingForUser(accessToken, userEmail) {
  const queue = await getApprovalQueue(accessToken);
  return queue.filter((r) => {
    if (r.status !== "SUBMITTED" && r.status !== "SIGNING") return false;
    // Check if user is a designated signatory who hasn't signed yet
    if (r.signatoryAuthor === userEmail && !r.signedAuthor) return true;
    if (r.signatoryReviewer === userEmail && !r.signedReviewer) return true;
    if (r.signatoryApprover === userEmail && !r.signedApprover) return true;
    return false;
  });
}

export async function addApprovalRequest(accessToken, request) {
  const { queueId } = await ensureSheets(accessToken);
  const sheets = getSheetsClient(accessToken);

  const row = QUEUE_HEADERS.map((h) => request[h] || "");

  await sheets.spreadsheets.values.append({
    spreadsheetId: queueId,
    range: "Sheet1!A1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  // Also log the submission
  await appendToLog(accessToken, {
    requestId: request.requestId,
    action: "SUBMITTED",
    actorEmail: request.authorEmail,
    actorName: request.authorName,
    documentHash: request.documentHash,
    fileId: request.fileId,
    details: `Submitted ${request.fileName} for approval`,
  });
}

export async function updateApprovalStatus(accessToken, requestId, updates) {
  const { queueId } = await ensureSheets(accessToken);
  const sheets = getSheetsClient(accessToken);

  // Read all rows to find the one to update
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: queueId,
    range: "Sheet1",
  });

  const rows = res.data.values || [];
  if (rows.length < 2) return null;

  const headers = rows[0];
  const reqIdCol = headers.indexOf("requestId");
  const rowIndex = rows.findIndex((r, i) => i > 0 && r[reqIdCol] === requestId);
  if (rowIndex < 0) return null;

  // Apply updates
  const row = [...rows[rowIndex]];
  for (const [key, value] of Object.entries(updates)) {
    const col = headers.indexOf(key);
    if (col >= 0) {
      // Pad row if needed
      while (row.length <= col) row.push("");
      row[col] = value;
    }
  }

  // Write back the updated row
  const range = `Sheet1!A${rowIndex + 1}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: queueId,
    range,
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });

  // Return updated object
  const obj = {};
  headers.forEach((h, i) => { obj[h] = row[i] || ""; });
  return obj;
}

// ═══ Signature Log ═══

export async function appendToLog(accessToken, entry) {
  const { logId } = await ensureSheets(accessToken);
  const sheets = getSheetsClient(accessToken);

  const logEntry = {
    logId: `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };

  const row = LOG_HEADERS.map((h) => logEntry[h] || "");

  await sheets.spreadsheets.values.append({
    spreadsheetId: logId,
    range: "Sheet1!A1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  return logEntry;
}

// ═══ Utilities ═══

export function generateRequestId() {
  return `REQ-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export async function getRequestById(accessToken, requestId) {
  const queue = await getApprovalQueue(accessToken);
  return queue.find((r) => r.requestId === requestId) || null;
}

export async function getRecentHistory(accessToken, limit = 20) {
  const queue = await getApprovalQueue(accessToken);
  return queue
    .filter((r) => ["APPROVED", "REJECTED", "EXPIRED", "WITHDRAWN", "SUPERSEDED", "OBSOLETE"].includes(r.status))
    .sort((a, b) => (b.finalizedAt || b.submittedAt || "").localeCompare(a.finalizedAt || a.submittedAt || ""))
    .slice(0, limit);
}

export async function getSignatureLog(accessToken, requestId) {
  const { logId } = await ensureSheets(accessToken);
  const entries = await readSheet(accessToken, logId);
  if (!requestId) return entries;
  return entries.filter((e) => e.requestId === requestId);
}
