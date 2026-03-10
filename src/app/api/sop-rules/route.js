import Anthropic from "@anthropic-ai/sdk";
import { fetchAllSopTexts } from "../../../lib/driveHelper";
import { FORMSHEET_REGISTRY } from "../../../lib/formsheetRegistry";
import { promises as fs } from "fs";
import path from "path";

const SOP_RULES_PATH = path.join(process.cwd(), "src", "data", "sop-rules.json");

// ═══ GET: Return current SOP rules ═══
export async function GET() {
  try {
    const data = await fs.readFile(SOP_RULES_PATH, "utf-8");
    const rules = JSON.parse(data);
    return Response.json({ rules, count: rules.length });
  } catch {
    return Response.json({ rules: [], count: 0 });
  }
}

// ═══ POST: Extract SOP rules from Drive documents via Claude ═══
export async function POST(request) {
  try {
    const accessToken = request.headers.get("x-access-token");
    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "Anthropic API key not configured" }, { status: 500 });
    }

    // Step 1: Fetch all SOP texts from Google Drive
    const sopTexts = await fetchAllSopTexts(accessToken);
    const sopIds = Object.keys(sopTexts);

    if (sopIds.length === 0) {
      return Response.json({ error: "No SOP documents found in Google Drive" }, { status: 404 });
    }

    // Step 2: For each SOP, ask Claude to extract key rules
    const client = new Anthropic({ apiKey });
    const rules = [];

    for (const sopId of sopIds) {
      const sopText = sopTexts[sopId];
      // Find formsheets that belong to this SOP
      const relatedFormsheets = FORMSHEET_REGISTRY
        .filter((f) => f.sop === sopId)
        .map((f) => f.id);

      try {
        const result = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: `Du bist ein QMS-Analyst. Analysiere den folgenden SOP-Text und extrahiere die wichtigsten Informationen.

Antworte NUR mit einem JSON-Objekt (kein Markdown, kein Code-Block) in diesem Format:
{
  "id": "${sopId}",
  "name": "Deutscher Name der SOP",
  "nameEn": "English name of the SOP",
  "purpose": "Kurze Zusammenfassung des Zwecks (1-2 Sätze)",
  "keyRules": ["Regel 1", "Regel 2", "Regel 3", "Regel 4", "Regel 5"],
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5", "keyword6", "keyword7", "keyword8"]
}

REGELN:
- "keyRules": Die 3-6 wichtigsten Regeln/Anforderungen aus der SOP, die beim Ausfüllen von Formblättern beachtet werden müssen
- "keywords": 6-10 Suchbegriffe (deutsch UND englisch gemischt) die diese SOP identifizieren
- Halte alles kompakt und präzise`,
          messages: [
            {
              role: "user",
              content: `SOP-Dokument ${sopId}:\n\n${sopText}`,
            },
          ],
        });

        const txt = result.content.map((c) => c.text || "").join("");
        const parsed = JSON.parse(txt.trim());
        // Add the related formsheets
        parsed.formsheets = relatedFormsheets;
        rules.push(parsed);
      } catch (err) {
        console.error(`Failed to extract rules for ${sopId}:`, err.message);
        // Add a minimal entry even if extraction fails
        rules.push({
          id: sopId,
          name: sopId,
          nameEn: sopId,
          purpose: "Konnte nicht automatisch extrahiert werden",
          keyRules: [],
          keywords: [sopId.toLowerCase()],
          formsheets: relatedFormsheets,
        });
      }
    }

    // Step 3: Save to sop-rules.json
    await fs.writeFile(SOP_RULES_PATH, JSON.stringify(rules, null, 2), "utf-8");

    return Response.json({
      success: true,
      count: rules.length,
      rules,
    });
  } catch (error) {
    console.error("SOP rules extraction error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
