import Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "fs";
import path from "path";
import { buildChatSystemPrompt, findRelevantSops, loadProjectContext } from "../../../lib/buildSystemPrompt";
import { fetchSopText } from "../../../lib/driveHelper";

const SOP_RULES_PATH = path.join(process.cwd(), "src", "data", "sop-rules.json");

// Load SOP rules from the JSON file (cached in module scope)
let cachedRules = null;
let rulesLoadedAt = 0;
const RULES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function loadSopRules() {
  if (cachedRules && Date.now() - rulesLoadedAt < RULES_CACHE_TTL) {
    return cachedRules;
  }
  try {
    const data = await fs.readFile(SOP_RULES_PATH, "utf-8");
    cachedRules = JSON.parse(data);
    rulesLoadedAt = Date.now();
    return cachedRules;
  } catch {
    return [];
  }
}

export async function POST(request) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "Anthropic API key not configured" }, { status: 500 });
    }

    const accessToken = request.headers.get("x-access-token");
    const body = await request.json();
    const { messages, lang } = body;

    // Load SOP rules
    const sopRules = await loadSopRules();

    // Find relevant SOPs based on the last user message
    const lastUserMsg = [...(messages || [])].reverse().find((m) => m.role === "user")?.content || "";
    const relevantSopIds = findRelevantSops(lastUserMsg, sopRules);

    // Fetch text of relevant SOPs from Drive (limited to 3000 chars each to stay within token limits)
    const relevantSopTexts = {};
    if (accessToken && relevantSopIds.length > 0) {
      for (const sopId of relevantSopIds) {
        const text = await fetchSopText(accessToken, sopId, 3000);
        if (text) relevantSopTexts[sopId] = text;
      }
    }

    // Load project context for persistent knowledge
    const projectContext = await loadProjectContext();

    // Build the enhanced system prompt
    const systemPrompt = buildChatSystemPrompt(lang || "de", sopRules, relevantSopTexts, projectContext);

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages || [],
    });

    return Response.json({
      content: message.content,
      usage: message.usage,
    });
  } catch (error) {
    console.error("Claude API error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
