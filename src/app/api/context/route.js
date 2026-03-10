import { promises as fs } from "fs";
import path from "path";

const CONTEXT_PATH = path.join(process.cwd(), "src", "data", "project-context.json");

// ═══ GET: Read project context ═══
export async function GET() {
  try {
    const data = await fs.readFile(CONTEXT_PATH, "utf-8");
    return Response.json(JSON.parse(data));
  } catch {
    return Response.json({ error: "Project context not found" }, { status: 404 });
  }
}

// ═══ PUT: Update project context ═══
export async function PUT(request) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.company || !body.products || !body.standards || !body.team) {
      return Response.json({ error: "Missing required fields: company, products, standards, team" }, { status: 400 });
    }

    // Add timestamp
    body.updatedAt = new Date().toISOString().split("T")[0];

    await fs.writeFile(CONTEXT_PATH, JSON.stringify(body, null, 2), "utf-8");
    return Response.json({ success: true, updatedAt: body.updatedAt });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
