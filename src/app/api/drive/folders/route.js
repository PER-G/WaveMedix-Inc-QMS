import { google } from "googleapis";
import { AREA_CONFIG, getFolderPaths } from "../../../../lib/folderStructure";

// ═══ Helper: Create authenticated Drive client ═══
function createDriveClient(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

// ═══ Helper: List children of a folder ═══
async function listChildren(drive, parentId) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and trashed = false`,
    fields: "files(id,name,mimeType)",
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
  });
  return res.data.files || [];
}

// ═══ Helper: Find a subfolder by name ═══
async function findSubfolder(drive, parentId, name) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
  });
  return res.data.files?.[0] || null;
}

// ═══ Helper: Create a folder ═══
async function createFolder(drive, parentId, name) {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    supportsAllDrives: true,
    fields: "id,name",
  });
  return res.data;
}

// ═══ GET: Discover QMH, Development, Operations folder IDs ═══
// Returns: { qmh: { id, name }, development: { id, name, subfolders: { "path": id } }, operations: { ... } }
export async function GET(request) {
  try {
    const accessToken = request.headers.get("x-access-token");
    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const drive = createDriveClient(accessToken);
    const qmhFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    // Step 1: Get QMH folder parent
    const qmhMeta = await drive.files.get({
      fileId: qmhFolderId,
      fields: "id,name,parents",
      supportsAllDrives: true,
    });

    const parentId = qmhMeta.data.parents?.[0];
    if (!parentId) {
      return Response.json({
        error: "Could not find parent folder of QMH. Is the Drive folder set up correctly?",
      }, { status: 404 });
    }

    console.log(`[FOLDERS] QMH folder: ${qmhMeta.data.name} (${qmhFolderId}), parent: ${parentId}`);

    // Step 2: List parent's children to find Development & Operations
    const siblings = await listChildren(drive, parentId);
    const result = {
      qmh: { id: qmhFolderId, name: qmhMeta.data.name },
      parentId,
    };

    for (const area of ["development", "operations"]) {
      const config = AREA_CONFIG[area];
      if (!config) continue;

      const folder = siblings.find(
        (f) =>
          f.mimeType === "application/vnd.google-apps.folder" &&
          f.name === config.folderName
      );

      if (folder) {
        console.log(`[FOLDERS] Found ${area}: ${folder.name} (${folder.id})`);

        // List subfolders inside
        const children = await listChildren(drive, folder.id);
        const subfolders = {};
        for (const child of children) {
          if (child.mimeType === "application/vnd.google-apps.folder") {
            subfolders[child.name] = child.id;

            // Check for sub-subfolders (e.g. Architecture & Components/Q-PSI Tokenizer)
            const cat = config.categories.find((c) => c.path === child.name);
            if (cat?.subModules) {
              const grandchildren = await listChildren(drive, child.id);
              for (const gc of grandchildren) {
                if (gc.mimeType === "application/vnd.google-apps.folder") {
                  subfolders[`${child.name}/${gc.name}`] = gc.id;
                }
              }
            }
          }
        }

        result[area] = { id: folder.id, name: folder.name, subfolders };
      } else {
        console.log(`[FOLDERS] ${area} folder "${config.folderName}" not found among siblings`);
        result[area] = null;
      }
    }

    return Response.json(result);
  } catch (error) {
    console.error("[FOLDERS] Error:", error.message);
    if (error.message?.includes("Invalid Credentials")) {
      return Response.json({ error: "Invalid Credentials — session expired." }, { status: 401 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// ═══ POST: Create missing subfolders for an area (idempotent) ═══
// Body: { area: "development" | "operations" }
// Returns: { folderMap: { "Validation & Testing": "folderId123", ... } }
export async function POST(request) {
  try {
    const accessToken = request.headers.get("x-access-token");
    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { area } = await request.json();
    if (!area || !AREA_CONFIG[area]) {
      return Response.json({ error: `Invalid area: ${area}` }, { status: 400 });
    }

    const config = AREA_CONFIG[area];
    const drive = createDriveClient(accessToken);
    const qmhFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    // Find parent folder
    const qmhMeta = await drive.files.get({
      fileId: qmhFolderId,
      fields: "parents",
      supportsAllDrives: true,
    });
    const parentId = qmhMeta.data.parents?.[0];
    if (!parentId) {
      return Response.json({ error: "Could not find parent folder" }, { status: 404 });
    }

    // Find or create the area root folder (Development / Operations)
    let areaFolder = await findSubfolder(drive, parentId, config.folderName);
    if (!areaFolder) {
      console.log(`[FOLDERS] Creating area folder: ${config.folderName}`);
      areaFolder = await createFolder(drive, parentId, config.folderName);
    }

    // Create subfolders from config
    const folderMap = {};
    let created = 0;

    for (const cat of config.categories) {
      // Find or create category folder
      let catFolder = await findSubfolder(drive, areaFolder.id, cat.path);
      if (!catFolder) {
        console.log(`[FOLDERS] Creating: ${config.folderName}/${cat.path}`);
        catFolder = await createFolder(drive, areaFolder.id, cat.path);
        created++;
      }
      folderMap[cat.path] = catFolder.id;

      // Create sub-module folders if any
      if (cat.subModules) {
        for (const sub of cat.subModules) {
          let subFolder = await findSubfolder(drive, catFolder.id, sub.path);
          if (!subFolder) {
            console.log(`[FOLDERS] Creating: ${config.folderName}/${cat.path}/${sub.path}`);
            subFolder = await createFolder(drive, catFolder.id, sub.path);
            created++;
          }
          folderMap[`${cat.path}/${sub.path}`] = subFolder.id;
        }
      }
    }

    console.log(`[FOLDERS] Done: ${Object.keys(folderMap).length} folders total, ${created} newly created`);

    return Response.json({
      areaId: areaFolder.id,
      areaName: areaFolder.name,
      folderMap,
      created,
      total: Object.keys(folderMap).length,
    });
  } catch (error) {
    console.error("[FOLDERS] POST Error:", error.message);
    if (error.message?.includes("Invalid Credentials")) {
      return Response.json({ error: "Invalid Credentials — session expired." }, { status: 401 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
}
