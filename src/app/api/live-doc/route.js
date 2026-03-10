import { findOrCreateLiveDoc, getLiveDocInfo } from "../../../lib/liveDocHelper";

// GET /api/live-doc?formsheetId=WM-SOP-001-F-002
export async function GET(request) {
  try {
    const accessToken = request.headers.get("x-access-token");
    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const formsheetId = searchParams.get("formsheetId");
    if (!formsheetId) {
      return Response.json({ error: "formsheetId is required" }, { status: 400 });
    }

    try {
      const doc = await findOrCreateLiveDoc(accessToken, formsheetId, "");
      return Response.json(doc);
    } catch (err) {
      if (err.message.includes("Template not found")) {
        return Response.json({ notFound: true, formsheetId });
      }
      throw err;
    }
  } catch (error) {
    console.error("[LIVE-DOC] GET error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/live-doc  body: { formsheetId, formsheetName }
export async function POST(request) {
  try {
    const accessToken = request.headers.get("x-access-token");
    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { formsheetId, formsheetName } = await request.json();
    if (!formsheetId || !formsheetName) {
      return Response.json({ error: "formsheetId and formsheetName are required" }, { status: 400 });
    }

    const doc = await findOrCreateLiveDoc(accessToken, formsheetId, formsheetName);
    return Response.json(doc);
  } catch (error) {
    console.error("[LIVE-DOC] POST error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
