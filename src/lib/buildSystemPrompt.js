import { FORMSHEET_REGISTRY, getRegistryPromptList } from "./formsheetRegistry";
import { promises as fs } from "fs";
import path from "path";

// ═══ Load project context (cached) ═══
let cachedContext = null;
let contextLoadedAt = 0;
const CONTEXT_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

export async function loadProjectContext() {
  if (cachedContext && Date.now() - contextLoadedAt < CONTEXT_CACHE_TTL) {
    return cachedContext;
  }
  try {
    const data = await fs.readFile(path.join(process.cwd(), "src", "data", "project-context.json"), "utf-8");
    cachedContext = JSON.parse(data);
    contextLoadedAt = Date.now();
    return cachedContext;
  } catch {
    return null;
  }
}

// ═══ Format project context for system prompt ═══
function formatProjectContext(ctx) {
  if (!ctx) return "";
  const products = (ctx.products || []).map(p => `  - ${p.name} (${p.type} ${p.class}, ${p.status})`).join("\n");
  const standards = (ctx.standards || []).join(", ");
  const team = (ctx.team || []).map(t => `  - ${t.name}: ${t.role}`).join("\n");
  return `UNTERNEHMENSPROFIL:
- Firma: ${ctx.company || "Wavemedix Inc."}
- Produkte:
${products}
- Standards: ${standards}
- Team:
${team}
- Phase: ${ctx.currentPhase || "N/A"}
${ctx.keyDecisions?.length > 0 ? `- Entscheidungen: ${ctx.keyDecisions.join("; ")}` : ""}

`;
}

// ═══ Find relevant SOPs based on keyword matching ═══
// Returns top 2 SOP IDs sorted by relevance score
export function findRelevantSops(userMessage, sopRules) {
  if (!userMessage || !sopRules || sopRules.length === 0) return [];

  const msgLower = userMessage.toLowerCase();
  const scored = sopRules.map((sop) => {
    let score = 0;

    // Match SOP ID directly (highest weight)
    if (msgLower.includes(sop.id.toLowerCase())) score += 10;

    // Match keywords
    for (const kw of sop.keywords || []) {
      if (msgLower.includes(kw.toLowerCase())) score += 2;
    }

    // Match SOP name
    if (sop.name && msgLower.includes(sop.name.toLowerCase())) score += 5;
    if (sop.nameEn && msgLower.includes(sop.nameEn.toLowerCase())) score += 5;

    // Match formsheet IDs
    for (const fsId of sop.formsheets || []) {
      if (msgLower.includes(fsId.toLowerCase())) score += 8;
    }

    return { sopId: sop.id, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((s) => s.sopId);
}

// ═══ Build the Chat system prompt ═══
export function buildChatSystemPrompt(lang, sopRules, relevantSopTexts, projectContext) {
  const isDE = lang === "de";
  const registryList = getRegistryPromptList();

  // Compact SOP overview from rules
  let sopOverview = "";
  if (sopRules && sopRules.length > 0) {
    sopOverview = sopRules
      .map((s) => {
        const name = isDE ? s.name : (s.nameEn || s.name);
        const forms = (s.formsheets || []).join(", ");
        return `${s.id}: ${name} — ${s.purpose}${forms ? ` [Formblätter: ${forms}]` : ""}`;
      })
      .join("\n");
  }

  // Relevant SOP full texts
  let sopDetails = "";
  if (relevantSopTexts && Object.keys(relevantSopTexts).length > 0) {
    sopDetails = Object.entries(relevantSopTexts)
      .map(([id, text]) => `── ${id} ──\n${text}`)
      .join("\n\n");
  }

  const contextBlock = formatProjectContext(projectContext);

  return `${contextBlock}Du bist der QMS-Assistent für Wavemedix Inc. (SaMD / AI-Medizinprodukte).

WICHTIGE REGELN:
1. Antworte IMMER in der Sprache, in der der User schreibt. Wenn er deutsch schreibt → antworte deutsch. Wenn er englisch schreibt → antworte englisch.
2. Gehe auf die WÜNSCHE und FRAGEN des Users ein. Beantworte seine Fragen direkt und hilfreich.
3. Bei Dokumentenanfragen (IQ/OQ/PQ, CAPA, Validierung, etc.) → schlage das passende Formblatt vor, NIEMALS eigene Strukturen erfinden.
4. Wenn kein exaktes Formblatt existiert → nächstbestes vorschlagen mit Begründung.
5. Die Formblätter und SOPs sind das Regelwerk — sie definieren WIE ein Dokument aussehen muss und welche Inhalte nötig sind.
6. Du darfst dem User erklären, beraten, und bei Fragen zum QMS helfen. Sei ein hilfreicher Assistent, nicht nur ein Formblatt-Detektor.

STRENG VERBOTEN:
- Generiere NIEMALS ein ganzes Dokument als Chat-Antwort. Kein Validation Plan, kein CAPA Report, kein Risk Assessment als Freitext.
- Schreibe NIEMALS lange Dokument-Texte mit Überschriften, Abschnitten, Tabellen etc. im Chat.
- Wenn der User ein Dokument anfordert, sage ihm welches Formblatt passt und dass er auf "Ausfüllen" klicken soll.
- Der Chat ist NUR für Beratung, Erklärungen und kurze Antworten. Die Dokumenterstellung läuft über die Formblatt-Funktion.

SOPs:
${sopOverview || "Regeln werden geladen..."}

FORMBLÄTTER:
${registryList}
${sopDetails ? `\nSOP-DETAILS:\n${sopDetails}` : ""}`;
}

// ═══ Build the Fill system prompt (for formsheet filling) ═══
export function buildFillSystemPrompt(lang, sopText, formsheetId) {
  const isDE = lang === "de";
  const today = new Date().toLocaleDateString("de-DE");

  const sopSection = sopText
    ? `\nSOP-KONTEXT:\n${sopText}`
    : "";

  return `Wavemedix QMS-Assistent. Fülle ${formsheetId} aus.
${sopSection}

REGELN:
1. Platzhalter [xxx] → sinnvolle Werte aus der Anfrage
2. Fehlende Info → [TODO: beschreibung]
3. [Date]/[Datum] → ${today}
4. Template-Struktur KOMPLETT beibehalten
5. NUR ausgefüllten Text zurückgeben, keine Erklärungen
6. Sprache: ${isDE ? "Deutsch" : "English"}`;
}
