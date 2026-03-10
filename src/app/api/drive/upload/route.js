import { google } from "googleapis";
import { appendToLog, ensureSheets } from "../../../../lib/sheetsHelper";

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const ALLOWED_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",      // .xlsx
  "application/pdf",                                                         // .pdf
];
const ALLOWED_EXTENSIONS = [".docx", ".xlsx", ".pdf"];

function getDriveClient(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

export async function POST(req) {
  try {
    const accessToken = req.headers.get("x-access-token");
    if (!accessToken) return Response.json({ error: "Not authenticated" }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get("file");
    const targetFolderId = formData.get("folderId") || FOLDER_ID;
    const convertToGoogle = formData.get("convert") === "true";
    const uploaderEmail = formData.get("uploaderEmail") || "";
    const uploaderName = formData.get("uploaderName") || "";

    if (!file || !(file instanceof File)) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return Response.json({ error: `File too large. Maximum size: 25 MB` }, { status: 422 });
    }

    // Validate file type
    const ext = "." + file.name.split(".").pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return Response.json({
        error: `File type not allowed. Supported: ${ALLOWED_EXTENSIONS.join(", ")}`,
      }, { status: 422 });
    }

    const drive = getDriveClient(accessToken);
    const buffer = Buffer.from(await file.arrayBuffer());

    // Determine MIME type for upload
    let mimeType = file.type;
    if (!ALLOWED_TYPES.includes(mimeType)) {
      // Fallback based on extension
      if (ext === ".docx") mimeType = ALLOWED_TYPES[0];
      else if (ext === ".xlsx") mimeType = ALLOWED_TYPES[1];
      else if (ext === ".pdf") mimeType = ALLOWED_TYPES[2];
    }

    const requestBody = {
      name: file.name,
      parents: [targetFolderId],
    };

    // Optionally convert to Google format
    if (convertToGoogle) {
      if (ext === ".docx") requestBody.mimeType = "application/vnd.google-apps.document";
      else if (ext === ".xlsx") requestBody.mimeType = "application/vnd.google-apps.spreadsheet";
    }

    const { Readable } = await import("stream");
    const stream = Readable.from(buffer);

    const uploaded = await drive.files.create({
      requestBody,
      media: {
        mimeType,
        body: stream,
      },
      fields: "id,name,webViewLink,mimeType,size",
      supportsAllDrives: true,
    });

    // Log the upload
    try {
      await ensureSheets(accessToken);
      await appendToLog(accessToken, {
        requestId: "",
        action: "UPLOADED",
        actorEmail: uploaderEmail,
        actorName: uploaderName,
        documentHash: "",
        fileId: uploaded.data.id,
        details: `File uploaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`,
      });
    } catch (logErr) {
      console.warn("[UPLOAD] Could not log upload:", logErr.message);
    }

    console.log("[UPLOAD] File uploaded:", uploaded.data.name, uploaded.data.id);

    return Response.json({
      success: true,
      file: {
        id: uploaded.data.id,
        name: uploaded.data.name,
        webViewLink: uploaded.data.webViewLink,
        mimeType: uploaded.data.mimeType,
        size: file.size,
      },
    });
  } catch (err) {
    console.error("[UPLOAD] Error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
