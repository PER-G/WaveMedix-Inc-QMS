import { google } from "googleapis";
import { ensureSheets, getApprovalQueue, appendToLog } from "../../../lib/sheetsHelper";

export async function GET(request) {
  try {
    const accessToken = request.headers.get("x-access-token");
    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: "v3", auth });

    // Support custom folderId via query param (for Development/Operations)
    const url = new URL(request.url);
    const customFolderId = url.searchParams.get("folderId");
    const folderId = customFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID;
    const isCustomFolder = !!customFolderId;
    const allFiles = [];

    const listFiles = async (parentId) => {
      const res = await drive.files.list({
        q: `'${parentId}' in parents and trashed = false`,
        fields: "files(id,name,mimeType,modifiedTime,size,webViewLink,webContentLink,lastModifyingUser,version)",
        orderBy: "name",
        pageSize: 200,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        corpora: "allDrives",
      });
      return res.data.files || [];
    };

    // ═══ CUSTOM FOLDER MODE (Development / Operations) ═══
    // Simple recursive listing with subfolderPath tracking
    if (isCustomFolder) {
      const recurse = async (parentId, pathPrefix) => {
        const items = await listFiles(parentId);
        for (const f of items) {
          if (f.mimeType === "application/vnd.google-apps.folder") {
            // Recurse into subfolders (max 2 levels deep)
            const subPath = pathPrefix ? `${pathPrefix}/${f.name}` : f.name;
            await recurse(f.id, subPath);
          } else {
            allFiles.push({
              id: f.id, name: f.name, mimeType: f.mimeType,
              modifiedTime: f.modifiedTime, size: parseInt(f.size || "0"),
              webViewLink: f.webViewLink, webContentLink: f.webContentLink,
              lastModifiedBy: f.lastModifyingUser?.displayName || "Unknown",
              version: f.version,
              folder: pathPrefix || "root",
              subfolderPath: pathPrefix || "",
              isOld: false,
            });
          }
        }
      };

      await recurse(folderId, "");
      console.log(`[DRIVE] Custom folder ${folderId}: ${allFiles.length} files`);
      return Response.json({ files: allFiles, folderCount: 0 });
    }

    // ═══ QMH MODE (original behavior) ═══
    // Step 1: Root folder contents
    const rootItems = await listFiles(folderId);
    const formsheetFolders = [];
    const oldRootFolders = [];

    rootItems.forEach((f) => {
      if (f.mimeType === "application/vnd.google-apps.folder") {
        const nameL = f.name.toLowerCase();
        // Any folder starting with "old" at root level is an archive
        if (nameL.startsWith("old")) {
          oldRootFolders.push(f);
        } else if (f.name === "Entwürfe" || nameL === "entwürfe" || nameL === "entwuerfe") {
          // Skip "Entwürfe" (drafts) folder — not part of the SOP tree
          console.log(`[DRIVE] Skipping drafts folder: ${f.name} (${f.id})`);
        } else {
          formsheetFolders.push(f);
        }
      } else {
        // Skip ENTWURF files at root level too
        if (f.name && f.name.includes("ENTWURF")) return;
        allFiles.push({
          id: f.id, name: f.name, mimeType: f.mimeType,
          modifiedTime: f.modifiedTime, size: parseInt(f.size || "0"),
          webViewLink: f.webViewLink, webContentLink: f.webContentLink,
          lastModifiedBy: f.lastModifyingUser?.displayName || "Unknown",
          version: f.version, folder: "root", isOld: false,
        });
      }
    });

    // Step 2: Read old root folders (Old Formsheets, Old SOP) recursively
    for (const oldFolder of oldRootFolders) {
      try {
        const items = await listFiles(oldFolder.id);
        for (const f of items) {
          if (f.mimeType === "application/vnd.google-apps.folder") {
            // Sub-folders inside Old Formsheets (e.g. per-SOP folders)
            try {
              const subItems = await listFiles(f.id);
              subItems.forEach((sf) => {
                if (sf.mimeType !== "application/vnd.google-apps.folder") {
                  allFiles.push({
                    id: sf.id, name: sf.name, mimeType: sf.mimeType,
                    modifiedTime: sf.modifiedTime, size: parseInt(sf.size || "0"),
                    webViewLink: sf.webViewLink, webContentLink: sf.webContentLink,
                    lastModifiedBy: sf.lastModifyingUser?.displayName || "Unknown",
                    version: sf.version, folder: oldFolder.name, isOld: true,
                  });
                }
              });
            } catch (err) {
              console.error(`Old sub-folder error:`, err.message);
            }
          } else {
            allFiles.push({
              id: f.id, name: f.name, mimeType: f.mimeType,
              modifiedTime: f.modifiedTime, size: parseInt(f.size || "0"),
              webViewLink: f.webViewLink, webContentLink: f.webContentLink,
              lastModifiedBy: f.lastModifyingUser?.displayName || "Unknown",
              version: f.version, folder: oldFolder.name, isOld: true,
            });
          }
        }
      } catch (err) {
        console.error(`Old root folder error:`, err.message);
      }
    }

    // Step 3: Each formsheet folder - separate current vs old subfolders
    for (const folder of formsheetFolders) {
      try {
        const subItems = await listFiles(folder.id);
        const oldSubFolders = [];

        subItems.forEach((f) => {
          if (f.mimeType === "application/vnd.google-apps.folder") {
            const nameL = f.name.toLowerCase();
            if (nameL.startsWith("old") || nameL.includes("old")) {
              oldSubFolders.push(f);
            }
          } else {
            allFiles.push({
              id: f.id, name: f.name, mimeType: f.mimeType,
              modifiedTime: f.modifiedTime, size: parseInt(f.size || "0"),
              webViewLink: f.webViewLink, webContentLink: f.webContentLink,
              lastModifiedBy: f.lastModifyingUser?.displayName || "Unknown",
              version: f.version, folder: folder.name, isOld: false,
            });
          }
        });

        for (const oldFolder of oldSubFolders) {
          try {
            const oldItems = await listFiles(oldFolder.id);
            oldItems.forEach((f) => {
              if (f.mimeType !== "application/vnd.google-apps.folder") {
                allFiles.push({
                  id: f.id, name: f.name, mimeType: f.mimeType,
                  modifiedTime: f.modifiedTime, size: parseInt(f.size || "0"),
                  webViewLink: f.webViewLink, webContentLink: f.webContentLink,
                  lastModifiedBy: f.lastModifyingUser?.displayName || "Unknown",
                  version: f.version, folder: folder.name, isOld: true,
                });
              }
            });
          } catch (err) {
            console.error(`Old subfolder error:`, err.message);
          }
        }
      } catch (err) {
        console.error(`Subfolder ${folder.name} error:`, err.message);
      }
    }

    const currentCount = allFiles.filter(f => !f.isOld).length;
    const oldCount = allFiles.filter(f => f.isOld).length;
    console.log(`RESULT: ${currentCount} current + ${oldCount} old = ${allFiles.length} total`);
    return Response.json({ files: allFiles, folderCount: formsheetFolders.length });
  } catch (error) {
    console.error("Drive API error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// ═══ DELETE: Move draft to trash ═══
export async function DELETE(request) {
  try {
    const accessToken = request.headers.get("x-access-token");
    if (!accessToken) return Response.json({ error: "Not authenticated" }, { status: 401 });

    const url = new URL(request.url);
    const fileId = url.searchParams.get("fileId");
    const actorEmail = url.searchParams.get("actorEmail") || "";
    const actorName = url.searchParams.get("actorName") || "";

    if (!fileId) return Response.json({ error: "fileId is required" }, { status: 400 });

    // Check if file is in an active approval request
    try {
      await ensureSheets(accessToken);
      const queue = await getApprovalQueue(accessToken);
      const activeRequest = queue.find(
        (r) => r.fileId === fileId && (r.status === "SUBMITTED" || r.status === "SIGNING")
      );
      if (activeRequest) {
        return Response.json({
          error: "This document is in an active approval process and cannot be deleted. Withdraw the request first.",
        }, { status: 422 });
      }
    } catch (err) {
      console.warn("[DRIVE] Could not check approval queue:", err.message);
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: "v3", auth });

    // Get file metadata to check name
    const fileMeta = await drive.files.get({
      fileId,
      fields: "name,parents",
      supportsAllDrives: true,
    });

    // Move to trash (not permanent delete)
    await drive.files.update({
      fileId,
      requestBody: { trashed: true },
      supportsAllDrives: true,
    });

    // Log the deletion
    try {
      await appendToLog(accessToken, {
        requestId: "",
        action: "DELETED",
        actorEmail,
        actorName,
        documentHash: "",
        fileId,
        details: `Draft deleted: ${fileMeta.data.name}`,
      });
    } catch (logErr) {
      console.warn("[DRIVE] Could not log deletion:", logErr.message);
    }

    console.log("[DRIVE] File trashed:", fileMeta.data.name, fileId);
    return Response.json({ success: true, fileName: fileMeta.data.name });
  } catch (error) {
    console.error("Drive DELETE error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}