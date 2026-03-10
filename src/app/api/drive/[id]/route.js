import { google } from "googleapis";

export async function GET(request, { params }) {
  try {
    const accessToken = request.headers.get("x-access-token");
    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: "v3", auth });

    const fileId = params.id;
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "metadata";

    if (action === "download") {
      // Get file metadata first to check type
      const meta = await drive.files.get({
        fileId,
        fields: "name,mimeType",
        supportsAllDrives: true,
      });

      // Google Workspace files need to be exported (not downloaded directly)
      if (meta.data.mimeType === "application/vnd.google-apps.document") {
        // Export Google Doc as .docx
        const res = await drive.files.export(
          { fileId, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
          { responseType: "arraybuffer" }
        );
        const filename = meta.data.name.replace(/\.[^.]*$/, "") + ".docx";
        return new Response(res.data, {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "Content-Disposition": `attachment; filename="${filename}"`,
          },
        });
      }
      if (meta.data.mimeType === "application/vnd.google-apps.spreadsheet") {
        // Export Google Sheet as .xlsx
        const res = await drive.files.export(
          { fileId, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
          { responseType: "arraybuffer" }
        );
        const filename = meta.data.name.replace(/\.[^.]*$/, "") + ".xlsx";
        return new Response(res.data, {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="${filename}"`,
          },
        });
      }

      // Regular files: download directly
      const res = await drive.files.get(
        { fileId, alt: "media", supportsAllDrives: true },
        { responseType: "arraybuffer" }
      );
      return new Response(res.data, {
        headers: {
          "Content-Type": meta.data.mimeType,
          "Content-Disposition": `attachment; filename="${meta.data.name}"`,
        },
      });
    }

    if (action === "revisions") {
      const res = await drive.revisions.list({
        fileId,
        fields: "revisions(id,modifiedTime,lastModifyingUser,size)",
      });
      return Response.json({ revisions: res.data.revisions || [] });
    }

    // Default: metadata
    const res = await drive.files.get({
      fileId,
      fields: "id,name,mimeType,modifiedTime,size,webViewLink,lastModifyingUser,version,description",
    });
    return Response.json(res.data);
  } catch (error) {
    console.error("Drive file error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
