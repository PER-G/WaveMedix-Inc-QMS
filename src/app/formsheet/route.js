import { google } from "googleapis";
import Anthropic from "@anthropic-ai/sdk";
import { FORMSHEET_REGISTRY, getRegistryPromptList, findFormsheet } from "../../lib/formsheetRegistry";
import { fetchSopText } from "../../lib/driveHelper";

// ═══ Helper: Create authenticated clients ═══
function createAuth(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

function createDriveClient(accessToken) {
  return google.drive({ version: "v3", auth: createAuth(accessToken) });
}

function createSheetsClient(accessToken) {
  return google.sheets({ version: "v4", auth: createAuth(accessToken) });
}

// ═══ Spreadsheet MIME types ═══
const SPREADSHEET_MIMES = [
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

function isSpreadsheet(mimeType) {
  return SPREADSHEET_MIMES.includes(mimeType);
}

// ═══ Helper: Extract readable text from any Drive file ═══
async function extractTemplateText(drive, fileId, mimeType) {
  console.log(`[EXTRACT] Extracting text from file ${fileId}, mimeType: ${mimeType}`);

  // Google Docs → export as plain text directly
  if (mimeType === "application/vnd.google-apps.document") {
    const res = await drive.files.export({ fileId, mimeType: "text/plain" });
    const text = typeof res.data === "string" ? res.data : String(res.data);
    console.log(`[EXTRACT] Google Doc → ${text.length} chars`);
    return { text, isGoogleDoc: true };
  }

  // Google Sheets → export as CSV
  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    const res = await drive.files.export({ fileId, mimeType: "text/csv" });
    const text = typeof res.data === "string" ? res.data : String(res.data);
    console.log(`[EXTRACT] Google Sheet → ${text.length} chars`);
    return { text, isGoogleDoc: false };
  }

  // Uploaded .docx → Convert to Google Doc first, then export as text
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    console.log(`[EXTRACT] Converting .docx ${fileId} to Google Doc for text extraction...`);
    // Step 1: Copy the file with conversion to Google Doc
    const tempDoc = await drive.files.copy({
      fileId,
      requestBody: {
        name: "__temp_text_extract__",
        mimeType: "application/vnd.google-apps.document", // Force convert
      },
      supportsAllDrives: true,
      fields: "id",
    });
    const tempId = tempDoc.data.id;
    console.log(`[EXTRACT] Temp Google Doc created: ${tempId}`);

    try {
      // Step 2: Export the converted doc as plain text
      const res = await drive.files.export({
        fileId: tempId,
        mimeType: "text/plain",
      });
      const text = typeof res.data === "string" ? res.data : String(res.data);
      console.log(`[EXTRACT] Converted .docx → ${text.length} chars, preview: ${text.substring(0, 150)}`);
      return { text, isGoogleDoc: false };
    } finally {
      // Step 3: Delete the temp doc (fire and forget)
      drive.files.delete({ fileId: tempId, supportsAllDrives: true }).catch((e) => {
        console.warn(`[EXTRACT] Could not delete temp doc ${tempId}:`, e.message);
      });
    }
  }

  // Uploaded .xlsx → Convert to Google Sheet, export as CSV
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel"
  ) {
    console.log(`[EXTRACT] Converting .xlsx to Google Sheet...`);
    const tempSheet = await drive.files.copy({
      fileId,
      requestBody: {
        name: "__temp_csv_extract__",
        mimeType: "application/vnd.google-apps.spreadsheet",
      },
      supportsAllDrives: true,
      fields: "id",
    });
    try {
      const res = await drive.files.export({
        fileId: tempSheet.data.id,
        mimeType: "text/csv",
      });
      const text = typeof res.data === "string" ? res.data : String(res.data);
      return { text, isGoogleDoc: false };
    } finally {
      drive.files.delete({ fileId: tempSheet.data.id, supportsAllDrives: true }).catch(() => {});
    }
  }

  // Unknown format → try to read as text
  console.warn(`[EXTRACT] Unknown mimeType ${mimeType}, trying raw read...`);
  try {
    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "text" }
    );
    const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    return { text, isGoogleDoc: false };
  } catch {
    return { text: "[Could not read template]", isGoogleDoc: false };
  }
}

// ═══ Helper: Find template file — always searches Drive directly for accurate mimeType ═══
async function findTemplateFile(formsheetId, driveFiles, accessToken) {
  const drive = createDriveClient(accessToken);

  // Strategy 1: Search Drive directly (most reliable — gives accurate mimeType)
  try {
    console.log(`[FIND] Searching Drive for template: ${formsheetId}`);
    const res = await drive.files.list({
      q: `name contains '${formsheetId}' and trashed = false`,
      fields: "files(id,name,mimeType)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: "allDrives",
      orderBy: "modifiedTime desc",
    });

    if (res.data.files?.length > 0) {
      // Prefer non-draft files (exclude files with ENTWURF in name)
      const templates = res.data.files.filter(f => !f.name.includes("ENTWURF") && !f.name.includes("DRAFT") && !f.name.includes("_temp_"));
      const file = templates.length > 0 ? templates[0] : res.data.files[0];
      console.log(`[FIND] Found in Drive: ${file.name} (${file.id}), mimeType: ${file.mimeType}`);
      return file;
    }
  } catch (err) {
    console.error(`[FIND] Drive search failed:`, err.message);
  }

  // Strategy 2: Fallback to driveFiles from frontend (may have inaccurate mimeType)
  if (driveFiles?.length > 0) {
    // Exact match in driveFiles
    let file = driveFiles.find((f) => f.name?.includes(formsheetId) && !f.isOld && !f.name?.includes("ENTWURF") && !f.name?.includes("DRAFT"));
    if (!file) {
      const idNorm = formsheetId.replace(/[-_]/g, "").toLowerCase();
      file = driveFiles.find((f) => {
        const nameNorm = (f.name || "").replace(/[-_]/g, "").toLowerCase();
        return nameNorm.includes(idNorm) && !f.isOld && !f.name?.includes("ENTWURF") && !f.name?.includes("DRAFT");
      });
    }
    if (file) {
      console.log(`[FIND] Found in driveFiles: ${file.name} (${file.id}), mimeType: ${file.mimeType}`);
      // Re-fetch from Drive to get accurate mimeType
      try {
        const meta = await drive.files.get({
          fileId: file.id,
          fields: "id,name,mimeType",
          supportsAllDrives: true,
        });
        return meta.data;
      } catch {
        return file;
      }
    }
  }

  console.error(`[FIND] Template ${formsheetId} NOT FOUND anywhere`);
  return null;
}

// ═══ Helper: Parse JSON from Claude response (handles markdown, code blocks, etc.) ═══
function parseClaudeJson(rawText) {
  let text = rawText.trim();
  // Strip markdown code blocks
  text = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  // Find the JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.replacements || parsed;
  } catch {
    return null;
  }
}

// ═══ POST: Detect formsheet intent + fill template ═══
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

    const body = await request.json();
    const { action } = body;

    // ─── ACTION: Detect formsheet intent from user message ───
    if (action === "detect") {
      const { message, lang, activeArea } = body;
      const registryList = getRegistryPromptList();

      const client = new Anthropic({ apiKey });
      const result = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: `Du bist ein QMS-Assistent für Wavemedix Inc. Analysiere die Benutzeranfrage und entscheide, ob der Benutzer ein Formsheet ausfüllen oder ein QMS-Dokument erstellen möchte.

WICHTIG: Du darfst NUR die offiziellen Wavemedix-Formblätter verwenden. Wenn der Benutzer ein Dokument anfragt (z.B. IQ/OQ/PQ, CAPA, Validierung, etc.), musst du das NÄCHSTBESTE passende Formblatt aus der Liste identifizieren, auch wenn kein exaktes Match existiert.

AKTUELLER KONTEXT: Der Benutzer befindet sich im Bereich "${activeArea || "qmh"}".
- "qmh" = QMS-Regelwerk (SOPs, Formblätter) → Entwürfe im QMH-Ordner speichern
- "development" = Produktentwicklung (Wavemedix SaMD Suite: Q-PSI Tokenizer, Ammonix ECG Agent) → Entwürfe im Development-Ordner speichern
- "operations" = Betrieb (IT Infrastructure, Supplier, CAPA, PMS, Training) → Entwürfe im Operations-Ordner speichern

ORDNERSTRUKTUR FÜR SPEICHERORT:
Development-Unterordner: "Design & Requirements", "Architecture & Components", "Architecture & Components/Q-PSI Tokenizer", "Architecture & Components/Ammonix ECG Agent", "Risk Management", "Validation & Testing", "Change Management", "Release"
Operations-Unterordner: "IT Infrastructure", "IT Infrastructure/Google Vault", "IT Infrastructure/DMS", "IT Infrastructure/Security", "Supplier Management", "CAPA & Complaints", "Post-Market Surveillance", "Training & Competence"

Bestimme anhand der Anfrage den PASSENDEN Unterordner (subfolderPath) für das Dokument.

Beispiele:
- "Validation Plan für Google Vault" → area: "operations", subfolderPath: "IT Infrastructure/Google Vault"
- "Risk Analysis für Q-PSI Tokenizer" → area: "development", subfolderPath: "Risk Management"
- "Engineering Change Request für Ammonix ECG" → area: "development", subfolderPath: "Change Management"
- "CAPA für Drift-Erkennung" → area: "operations", subfolderPath: "CAPA & Complaints"
- "Supplier Evaluation" → area: "operations", subfolderPath: "Supplier Management"
- "IQ/OQ/PQ für DMS" → area: "operations", subfolderPath: "IT Infrastructure/DMS"

Beispiele für Formsheet-Mapping:
- IQ/OQ/PQ, Qualifizierung → WM-SOP-011-F-005 oder WM-SOP-013-F-002
- Validierungsplan → WM-SOP-011-F-001
- Risikoanalyse, FMEA → WM-SOP-004-F-001 oder WM-SOP-004-F-002
- Change Request → WM-SOP-018-F-001 oder WM-SOP-001-F-001
- Audit → WM-SOP-012-F-002
- Security Assessment → WM-SOP-013-F-001

Verfügbare Formsheets:
${registryList}

Antworte NUR mit einem JSON-Objekt (kein Markdown, kein Code-Block):
- Wenn ein Formsheet passt: {"isFormsheet": true, "formsheetId": "WM-SOP-XXX-F-XXX", "formsheetName": "Name", "summary": "Kurze Zusammenfassung", "area": "development|operations|qmh", "subfolderPath": "Unterordner/Pfad"}
- Wenn definitiv kein Formsheet passt: {"isFormsheet": false}`,
        messages: [{ role: "user", content: message }],
      });

      const txt = result.content.map((c) => c.text || "").join("");
      try {
        const parsed = JSON.parse(txt.trim());
        return Response.json(parsed);
      } catch {
        const jsonMatch = txt.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            return Response.json(JSON.parse(jsonMatch[0]));
          } catch {}
        }
        return Response.json({ isFormsheet: false, rawResponse: txt });
      }
    }

    // ─── ACTION: Smart clarification — ask questions before filling ───
    if (action === "clarify") {
      const { formsheetId, userRequest, lang, driveFiles } = body;
      console.log(`\n[CLARIFY] ═══ Analyzing need for clarification: ${formsheetId} ═══`);

      const registryEntry = findFormsheet(formsheetId);

      // Step 1: Find and read the template to understand its structure
      const templateFile = await findTemplateFile(formsheetId, driveFiles, accessToken);
      let templatePreview = "";
      if (templateFile) {
        try {
          const drive = createDriveClient(accessToken);
          const extracted = await extractTemplateText(drive, templateFile.id, templateFile.mimeType);
          templatePreview = extracted.text?.substring(0, 2000) || "";
        } catch (err) {
          console.warn(`[CLARIFY] Template read failed:`, err.message);
        }
      }

      // Step 2: Fetch SOP context
      let sopText = null;
      try {
        if (registryEntry?.sop) {
          sopText = await fetchSopText(accessToken, registryEntry.sop, 1500);
        }
      } catch (sopErr) {
        console.warn(`[CLARIFY] SOP fetch failed:`, sopErr.message);
      }

      // Step 3: Ask Claude whether clarification is needed
      const client = new Anthropic({ apiKey });
      const clarifyResult = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: `Du bist ein intelligenter QMS-Assistent für Wavemedix Inc. Der Benutzer möchte das Formblatt "${formsheetId}" (${registryEntry?.name || formsheetId}) ausfüllen.

AUFGABE: Analysiere die Benutzeranfrage und das Template. Entscheide, ob du genug Informationen hast, um das Formblatt sinnvoll auszufüllen — ODER ob du erst klärende Fragen stellen musst.

TEMPLATE-VORSCHAU:
${templatePreview || "[Template konnte nicht gelesen werden]"}
${sopText ? `\nSOP-KONTEXT:\n${sopText}` : ""}

REGELN:
1. Wenn der Benutzer SPEZIFISCHE Details angibt (Produktname, System, Zweck, Testumgebung etc.), dann brauchst du KEINE Rückfragen.
2. Wenn die Anfrage VAGE ist (z.B. nur "Erstelle einen Validation Plan" ohne zu sagen WOFÜR), dann stelle 2-4 klärende Fragen.
3. Fragen sollen KONKRET und RELEVANT für dieses Formblatt sein.
4. Fragen in der Sprache des Benutzers stellen.

Antworte NUR mit einem JSON-Objekt:
- Wenn genug Infos vorhanden: {"needsClarification": false}
- Wenn Fragen nötig: {"needsClarification": true, "questions": ["Frage 1?", "Frage 2?", ...]}`,
        messages: [{ role: "user", content: `Benutzeranfrage: "${userRequest}"` }],
      });

      const clarifyTxt = clarifyResult.content.map((c) => c.text || "").join("").trim();
      console.log(`[CLARIFY] Response: ${clarifyTxt.substring(0, 200)}`);

      try {
        let parsed = JSON.parse(clarifyTxt);
        if (!parsed) parsed = { needsClarification: false };
        return Response.json(parsed);
      } catch {
        const jsonMatch = clarifyTxt.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            return Response.json(JSON.parse(jsonMatch[0]));
          } catch {}
        }
        return Response.json({ needsClarification: false });
      }
    }

    // ─── ACTION: Read template from Drive and fill it ───
    if (action === "fill") {
      const { formsheetId, userRequest, lang, driveFiles, clarifications } = body;
      console.log(`\n[FILL] ═══ Starting fill for ${formsheetId} ═══`);
      console.log(`[FILL] User request: "${userRequest}"`);
      if (clarifications) console.log(`[FILL] Clarifications provided: ${clarifications.substring(0, 200)}`);

      // Step 1: Find template file in Drive
      const templateFile = await findTemplateFile(formsheetId, driveFiles, accessToken);
      if (!templateFile) {
        return Response.json({
          error: `Formsheet ${formsheetId} not found in Google Drive. Please make sure the template exists.`,
        }, { status: 404 });
      }

      console.log(`[FILL] Template: ${templateFile.name} (${templateFile.id}), type: ${templateFile.mimeType}`);

      // Step 2: Extract readable text from template
      const drive = createDriveClient(accessToken);
      let templateContent;
      try {
        const extracted = await extractTemplateText(drive, templateFile.id, templateFile.mimeType);
        templateContent = extracted.text;
      } catch (extractErr) {
        console.error(`[FILL] Template extraction FAILED:`, extractErr.message);
        return Response.json({
          error: `Could not read template ${formsheetId}: ${extractErr.message}. Please try signing in again.`,
        }, { status: 500 });
      }

      // Validate that we got useful content (not binary garbage)
      if (!templateContent || templateContent.length < 50) {
        console.error(`[FILL] Template content too short: ${templateContent?.length} chars`);
        return Response.json({
          error: `Template ${formsheetId} appears empty or unreadable (${templateContent?.length} chars).`,
        }, { status: 500 });
      }

      // Check for binary garbage (ZIP headers, etc.)
      const binaryCheck = templateContent.substring(0, 20);
      if (binaryCheck.includes("PK") || binaryCheck.includes("\x00") || /[\x00-\x08\x0E-\x1F]/.test(binaryCheck)) {
        console.error(`[FILL] Template content looks like binary data! First bytes: ${JSON.stringify(binaryCheck)}`);
        return Response.json({
          error: `Template ${formsheetId} could not be converted to text. The file may be corrupt or access was denied.`,
        }, { status: 500 });
      }

      console.log(`[FILL] Template text: ${templateContent.length} chars`);
      console.log(`[FILL] Template preview: ${templateContent.substring(0, 200)}`);

      // Step 3a: Determine if this is a spreadsheet template
      const registryEntry = findFormsheet(formsheetId);
      const isSheet = registryEntry?.type === "xlsx" || isSpreadsheet(templateFile.mimeType);
      console.log(`[FILL] isSpreadsheet: ${isSheet}, registry type: ${registryEntry?.type}, mimeType: ${templateFile.mimeType}`);

      // Step 4: Fetch the governing SOP text for context
      let sopText = null;
      try {
        if (registryEntry?.sop) {
          sopText = await fetchSopText(accessToken, registryEntry.sop, 2000);
        }
      } catch (sopErr) {
        console.warn(`[FILL] SOP fetch failed (non-critical):`, sopErr.message);
      }

      // Step 5: Determine content language from template
      const englishWords = (templateContent.match(/\b(version|date|name|product|purpose|scope|prepared|approved|signature|validation|plan|report|description|status|review|change|test|result)\b/gi) || []).length;
      const germanWords = (templateContent.match(/\b(Version|Datum|Name|Produkt|Zweck|Umfang|erstellt|genehmigt|Unterschrift|Validierung|Plan|Bericht|Beschreibung|Status|Prüfung|Änderung|Test|Ergebnis)\b/g) || []).length;
      const contentLang = englishWords >= germanWords ? "English" : "Deutsch";
      console.log(`[FILL] Language detection: EN=${englishWords} DE=${germanWords} → ${contentLang}`);

      const client = new Anthropic({ apiKey });
      const today = new Date().toLocaleDateString("de-DE");

      // ═══ SPREADSHEET MODE: Generate rows for Excel/Sheets templates ═══
      if (isSheet) {
        console.log(`[FILL] ═══ SPREADSHEET MODE ═══`);

        // Parse CSV to understand headers and existing data
        const csvLines = templateContent.split("\n").map(l => l.trim()).filter(Boolean);
        const headers = csvLines.length > 0 ? csvLines[0] : "";
        const existingRows = csvLines.slice(1);
        console.log(`[FILL] CSV headers: ${headers}`);
        console.log(`[FILL] Existing data rows: ${existingRows.length}`);

        try {
          const sheetResult = await client.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 8192,
            system: `Return ONLY a valid JSON object. No markdown. No code blocks. No explanations.

You fill in official Wavemedix QMS spreadsheet templates. The user wants to create/fill template "${formsheetId}" (${registryEntry?.name || formsheetId}).
${sopText ? `\nSOP CONTEXT:\n${sopText}` : ""}

The template is a spreadsheet (Excel/Sheets) with the following CSV structure:

HEADER ROW:
${headers}

EXISTING DATA (${existingRows.length} rows):
${existingRows.slice(0, 10).join("\n")}${existingRows.length > 10 ? `\n... (${existingRows.length - 10} more rows)` : ""}

RULES:
1. Analyze the headers and understand what each column means.
2. Generate new data rows based on the user's request.
3. Each row must have values matching the column count of the header.
4. Use "[TODO: description]" where specific information is needed.
5. Date fields → "${today}"
6. Language for content: ${contentLang}
7. Company name: Wavemedix Inc.
8. Generate realistic, professional QMS entries.
9. For FMEA: include hazard identification, severity, probability, detectability, RPN calculations.
10. For registers/lists: include proper IDs, descriptions, status fields.

FORMAT:
{
  "headers": ["col1", "col2", ...],
  "rows": [
    ["value1", "value2", ...],
    ["value1", "value2", ...]
  ],
  "cellReplacements": {"A1": "new value", "B2": "new value"}
}

- "headers" = the column headers from the template (as array)
- "rows" = NEW data rows to append after existing data
- "cellReplacements" = optional: replace specific cells that have placeholder values (like [Company], [Date], etc.)
- Generate at least 3-5 meaningful rows based on the user's request
- Start with { and end with }`,
            messages: [{
              role: "user",
              content: `User request: "${userRequest}"${clarifications ? `\n\nAdditional context from user:\n${clarifications}` : ""}`,
            }],
          });

          const sheetTxt = sheetResult.content.map((c) => c.text || "").join("").trim();
          console.log(`[FILL] Spreadsheet Claude response: ${sheetTxt.length} chars`);

          // Parse response
          let sheetData = null;
          try {
            let cleaned = sheetTxt.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              sheetData = JSON.parse(jsonMatch[0]);
            }
          } catch (parseErr) {
            console.error(`[FILL] Spreadsheet JSON parse failed:`, parseErr.message);
          }

          if (sheetData && (sheetData.rows?.length > 0 || sheetData.cellReplacements)) {
            const rowCount = sheetData.rows?.length || 0;
            const cellCount = sheetData.cellReplacements ? Object.keys(sheetData.cellReplacements).length : 0;
            console.log(`[FILL] ═══ SUCCESS: spreadsheet with ${rowCount} rows, ${cellCount} cell replacements ═══\n`);

            // Build preview text for the chat
            const previewLines = [];
            if (sheetData.headers) {
              previewLines.push(sheetData.headers.join(" | "));
              previewLines.push(sheetData.headers.map(() => "---").join(" | "));
            }
            if (sheetData.rows) {
              for (const row of sheetData.rows.slice(0, 8)) {
                previewLines.push(row.join(" | "));
              }
              if (sheetData.rows.length > 8) {
                previewLines.push(`... (+${sheetData.rows.length - 8} weitere Zeilen)`);
              }
            }
            if (cellCount > 0) {
              previewLines.push("");
              previewLines.push("Zell-Ersetzungen:");
              for (const [cell, val] of Object.entries(sheetData.cellReplacements).slice(0, 5)) {
                previewLines.push(`  ${cell} → ${val}`);
              }
            }

            return Response.json({
              mode: "spreadsheet",
              headers: sheetData.headers || [],
              rows: sheetData.rows || [],
              cellReplacements: sheetData.cellReplacements || {},
              templateFileId: templateFile.id,
              templateFileName: templateFile.name,
              templateFileMimeType: templateFile.mimeType,
              formsheetId,
              previewText: previewLines.join("\n"),
              existingRowCount: existingRows.length,
            });
          }

          // Fallback: spreadsheet couldn't be parsed
          console.warn(`[FILL] Spreadsheet response could not be parsed. Raw: ${sheetTxt.substring(0, 200)}`);
          return Response.json({
            error: `Could not generate spreadsheet data for ${formsheetId}. Please try again.`,
            templateContent: templateContent.substring(0, 2000),
          }, { status: 422 });

        } catch (sheetErr) {
          console.error(`[FILL] Spreadsheet fill failed:`, sheetErr.message);
          return Response.json({ error: `Spreadsheet fill error: ${sheetErr.message}` }, { status: 500 });
        }
      }

      // ═══ DOCUMENT MODE: Extract placeholders and generate replacements ═══
      // Step 3b: Extract placeholders from template
      const placeholderRegex = /\[([^\]]{2,80})\]/g;
      const foundPlaceholders = [];
      let match;
      while ((match = placeholderRegex.exec(templateContent)) !== null) {
        if (!foundPlaceholders.includes(match[0])) {
          foundPlaceholders.push(match[0]);
        }
      }
      console.log(`[FILL] Found ${foundPlaceholders.length} unique placeholders in template`);
      if (foundPlaceholders.length > 0) {
        console.log(`[FILL] Placeholders: ${foundPlaceholders.slice(0, 10).join(", ")}${foundPlaceholders.length > 10 ? "..." : ""}`);
      }

      // Step 6: Ask Claude to generate placeholder replacements
      let replacements = null;

      // Attempt 1: Full template text + placeholder identification
      if (foundPlaceholders.length > 0) {
        console.log(`[FILL] Attempt 1: Sending ${foundPlaceholders.length} placeholders to Claude...`);
        try {
          const fillResult = await client.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            system: `Return ONLY a valid JSON object. No markdown. No code blocks. No explanations.

You fill in official Wavemedix QMS formsheet templates. The user wants to create a document using template "${formsheetId}" (${registryEntry?.name || formsheetId}).
${sopText ? `\nSOP CONTEXT:\n${sopText}` : ""}

RULES:
1. Replace each placeholder with an appropriate value based on the user's request.
2. If specific information is missing → use "[TODO: brief description of what's needed]"
3. Date fields → "${today}"
4. Language for content: ${contentLang}
5. Company name: Wavemedix Inc.

FORMAT: {"replacements": {"[exact placeholder text]": "replacement value"}}
- Keys MUST exactly match the placeholders including square brackets
- Start with { and end with }`,
            messages: [{
              role: "user",
              content: `User request: "${userRequest}"${clarifications ? `\n\nAdditional context from user:\n${clarifications}` : ""}\n\nPlaceholders to fill:\n${foundPlaceholders.join("\n")}`,
            }],
          });

          const fillTxt = fillResult.content.map((c) => c.text || "").join("").trim();
          console.log(`[FILL] Claude response length: ${fillTxt.length}, starts with: ${fillTxt.substring(0, 50)}`);

          replacements = parseClaudeJson(fillTxt);
          if (replacements && typeof replacements === "object" && !Array.isArray(replacements)) {
            console.log(`[FILL] ✅ Attempt 1 SUCCESS: ${Object.keys(replacements).length} replacements`);
          } else {
            console.warn(`[FILL] Attempt 1 parsed but invalid format`);
            replacements = null;
          }
        } catch (err) {
          console.error(`[FILL] Attempt 1 failed:`, err.message);
        }
      }

      // Attempt 2: Simpler prompt with explicit placeholder list
      if (!replacements && foundPlaceholders.length > 0) {
        console.log(`[FILL] Attempt 2: Simplified prompt...`);
        try {
          const retryResult = await client.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            system: `Return ONLY a JSON object. The user needs a "${registryEntry?.name || formsheetId}" for: "${userRequest}".
Use "${today}" for dates. Write in ${contentLang}. Company: Wavemedix Inc.
If unsure about a value, use "[TODO: description]".
Format: {"replacements": {"[placeholder]": "value"}}`,
            messages: [{
              role: "user",
              content: `Fill these placeholders:\n${foundPlaceholders.map(p => `${p}`).join("\n")}${clarifications ? `\n\nAdditional context:\n${clarifications}` : ""}`,
            }],
          });

          const retryTxt = retryResult.content.map((c) => c.text || "").join("").trim();
          replacements = parseClaudeJson(retryTxt);
          if (replacements && typeof replacements === "object" && !Array.isArray(replacements)) {
            console.log(`[FILL] ✅ Attempt 2 SUCCESS: ${Object.keys(replacements).length} replacements`);
          } else {
            replacements = null;
          }
        } catch (err) {
          console.error(`[FILL] Attempt 2 failed:`, err.message);
        }
      }

      // Attempt 3: Build replacements manually if Claude keeps failing
      if (!replacements && foundPlaceholders.length > 0) {
        console.warn(`[FILL] Attempt 3: Building minimal replacements manually...`);
        replacements = {};
        for (const ph of foundPlaceholders) {
          const lower = ph.toLowerCase();
          if (lower.includes("date") || lower.includes("datum")) {
            replacements[ph] = today;
          } else if (lower.includes("company") || lower.includes("firma") || lower.includes("organization")) {
            replacements[ph] = "Wavemedix Inc.";
          } else if (lower.includes("product") || lower.includes("produkt") || lower.includes("system")) {
            replacements[ph] = userRequest.split(" ").slice(-3).join(" ") || "Google Vault";
          } else {
            replacements[ph] = `[TODO: ${ph.replace(/[\[\]]/g, "")}]`;
          }
        }
        console.log(`[FILL] ✅ Attempt 3: Built ${Object.keys(replacements).length} manual replacements`);
      }

      // Return result
      if (replacements && Object.keys(replacements).length > 0) {
        console.log(`[FILL] ═══ SUCCESS: copy-and-replace with ${Object.keys(replacements).length} replacements ═══\n`);
        return Response.json({
          replacements,
          templateFileId: templateFile.id,
          templateFileName: templateFile.name,
          templateFileMimeType: templateFile.mimeType,
          formsheetId,
          mode: "copy-and-replace",
        });
      }

      // No placeholders found at all — this should be very rare
      console.warn(`[FILL] No placeholders found in template. Returning template as-is for reference.`);
      return Response.json({
        error: `No placeholders [like this] found in template ${formsheetId}. The template may not have fillable fields.`,
        templateContent: templateContent.substring(0, 2000), // Send preview for debugging
      }, { status: 422 });
    }

    // ─── ACTION: Save filled formsheet by COPYING original and replacing placeholders ───
    if (action === "save") {
      const { formsheetId, filledContent, replacements, templateFileId, formsheetName, targetFolderId, subfolderPath } = body;
      console.log(`\n[SAVE] ═══ Saving ${formsheetId} ═══`);
      console.log(`[SAVE] Mode: ${replacements ? "copy-and-replace" : "text"}, targetFolder: ${targetFolderId || "default"}, subfolder: ${subfolderPath || "none"}`);

      const drive = createDriveClient(accessToken);
      // Use targetFolderId if provided (for Dev/Ops context-aware saving), otherwise default to QMH
      const baseFolderId = targetFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID;

      // ── Resolve save destination ──
      // If subfolderPath is provided (e.g. "IT Infrastructure/Google Vault"), navigate to that subfolder.
      // Otherwise fallback to "Entwürfe" folder.
      let saveFolderId;
      let saveFolderName;

      if (subfolderPath && targetFolderId) {
        // Navigate subfolder path within the area folder
        try {
          let currentParent = targetFolderId;
          const pathParts = subfolderPath.split("/").filter(Boolean);
          for (const part of pathParts) {
            const searchRes = await drive.files.list({
              q: `'${currentParent}' in parents and name = '${part.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
              fields: "files(id,name)",
              pageSize: 1,
              supportsAllDrives: true,
              includeItemsFromAllDrives: true,
              corpora: "allDrives",
            });
            if (searchRes.data.files?.length > 0) {
              currentParent = searchRes.data.files[0].id;
            } else {
              // Create the missing subfolder
              console.log(`[SAVE] Creating subfolder: ${part} in ${currentParent}`);
              const newSub = await drive.files.create({
                requestBody: { name: part, mimeType: "application/vnd.google-apps.folder", parents: [currentParent] },
                supportsAllDrives: true,
                fields: "id",
              });
              currentParent = newSub.data.id;
            }
          }
          saveFolderId = currentParent;
          saveFolderName = subfolderPath;
          console.log(`[SAVE] Resolved subfolder: ${subfolderPath} → ${saveFolderId}`);
        } catch (subErr) {
          console.warn(`[SAVE] Subfolder resolution failed: ${subErr.message}, falling back to Entwürfe`);
          saveFolderId = null; // will fall through to Entwürfe below
        }
      }

      // Fallback: use "Entwürfe" folder
      if (!saveFolderId) {
        try {
          const folderSearch = await drive.files.list({
            q: `'${baseFolderId}' in parents and name = 'Entwürfe' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: "files(id)",
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
            corpora: "allDrives",
          });

          if (folderSearch.data.files?.length > 0) {
            saveFolderId = folderSearch.data.files[0].id;
          } else {
            const newFolder = await drive.files.create({
              requestBody: { name: "Entwürfe", mimeType: "application/vnd.google-apps.folder", parents: [baseFolderId] },
              supportsAllDrives: true,
              fields: "id",
            });
            saveFolderId = newFolder.data.id;
          }
          saveFolderName = "Entwürfe";
        } catch (folderErr) {
          console.error(`[SAVE] Folder search/create failed:`, folderErr.message);
          return Response.json({ error: `Could not access folder: ${folderErr.message}` }, { status: 500 });
        }
      }

      const today = new Date().toISOString().split("T")[0];
      const docName = `${formsheetId}_DRAFT_${today}`;

      // ── SPREADSHEET MODE: Copy template as Google Sheet, insert rows via Sheets API ──
      if (body.mode === "spreadsheet" && templateFileId) {
        const { rows, cellReplacements, existingRowCount } = body;
        console.log(`[SAVE] SPREADSHEET MODE: copying template ${templateFileId}...`);
        console.log(`[SAVE] Rows to append: ${rows?.length || 0}, cell replacements: ${cellReplacements ? Object.keys(cellReplacements).length : 0}`);

        // Check original file type
        const origMeta = await drive.files.get({
          fileId: templateFileId,
          fields: "mimeType,name",
          supportsAllDrives: true,
        });

        const origMime = origMeta.data.mimeType;
        const isGoogleSheet = origMime === "application/vnd.google-apps.spreadsheet";

        console.log(`[SAVE] Original: ${origMeta.data.name}, mimeType: ${origMime}, isGoogleSheet: ${isGoogleSheet}`);

        // Copy template — convert to Google Sheet if it's an .xlsx
        const copiedFile = await drive.files.copy({
          fileId: templateFileId,
          requestBody: {
            name: docName,
            ...(isGoogleSheet ? {} : { mimeType: "application/vnd.google-apps.spreadsheet" }),
            parents: [saveFolderId],
          },
          supportsAllDrives: true,
          fields: "id,name,webViewLink",
        });

        console.log(`[SAVE] Copied → ${copiedFile.data.id} (${isGoogleSheet ? "native Sheet" : "converted to Sheet"})`);

        const sheets = createSheetsClient(accessToken);
        const spreadsheetId = copiedFile.data.id;
        let totalChanges = 0;

        // Step 1: Get sheet metadata (to find the first sheet name)
        let sheetName = "Sheet1";
        try {
          const sheetMeta = await sheets.spreadsheets.get({
            spreadsheetId,
            fields: "sheets.properties",
          });
          if (sheetMeta.data.sheets?.length > 0) {
            sheetName = sheetMeta.data.sheets[0].properties.title;
          }
          console.log(`[SAVE] Sheet name: "${sheetName}"`);
        } catch (metaErr) {
          console.warn(`[SAVE] Could not get sheet name, using default:`, metaErr.message);
        }

        // Step 2: Apply cell replacements (e.g. A1 → "Wavemedix Inc.", B2 → "2025-01-15")
        if (cellReplacements && Object.keys(cellReplacements).length > 0) {
          try {
            const valueRanges = Object.entries(cellReplacements).map(([cell, value]) => ({
              range: `'${sheetName}'!${cell}`,
              values: [[String(value)]],
            }));

            const batchRes = await sheets.spreadsheets.values.batchUpdate({
              spreadsheetId,
              requestBody: {
                valueInputOption: "USER_ENTERED",
                data: valueRanges,
              },
            });
            totalChanges += batchRes.data.totalUpdatedCells || 0;
            console.log(`[SAVE] ✅ Cell replacements: ${totalChanges} cells updated`);
          } catch (cellErr) {
            console.error(`[SAVE] Cell replacement error:`, cellErr.message);
          }
        }

        // Step 3: Append new rows after existing data
        if (rows && rows.length > 0) {
          try {
            // Determine the start row for appending (after header + existing data)
            // existingRowCount is the number of data rows (excluding header)
            const startRow = (existingRowCount || 0) + 2; // +1 for header, +1 for 1-indexed
            const endRow = startRow + rows.length - 1;
            const maxCol = Math.max(...rows.map(r => r.length), 1);
            // Convert column number to letter (1=A, 2=B, ..., 26=Z, 27=AA)
            const colLetter = (n) => {
              let s = "";
              while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
              return s;
            };
            const range = `'${sheetName}'!A${startRow}:${colLetter(maxCol)}${endRow}`;

            console.log(`[SAVE] Appending ${rows.length} rows at ${range}`);

            const appendRes = await sheets.spreadsheets.values.update({
              spreadsheetId,
              range,
              valueInputOption: "USER_ENTERED",
              requestBody: {
                values: rows.map(row => row.map(cell => String(cell))),
              },
            });
            totalChanges += appendRes.data.updatedCells || 0;
            console.log(`[SAVE] ✅ Appended ${rows.length} rows (${appendRes.data.updatedCells} cells)`);
          } catch (appendErr) {
            console.error(`[SAVE] Row append error:`, appendErr.message);
            // Try fallback: use values.append instead
            try {
              console.log(`[SAVE] Trying append fallback...`);
              const appendRes = await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: `'${sheetName}'!A1`,
                valueInputOption: "USER_ENTERED",
                insertDataOption: "INSERT_ROWS",
                requestBody: {
                  values: rows.map(row => row.map(cell => String(cell))),
                },
              });
              totalChanges += appendRes.data.updates?.updatedCells || 0;
              console.log(`[SAVE] ✅ Append fallback success: ${appendRes.data.updates?.updatedCells} cells`);
            } catch (appendErr2) {
              console.error(`[SAVE] Append fallback also failed:`, appendErr2.message);
            }
          }
        }

        console.log(`[SAVE] ═══ SPREADSHEET SUCCESS → ${saveFolderName} (${totalChanges} total changes) ═══\n`);
        return Response.json({
          success: true,
          file: {
            id: copiedFile.data.id,
            name: copiedFile.data.name,
            webViewLink: copiedFile.data.webViewLink,
          },
          folder: saveFolderName || "Entwürfe",
          replacementCount: totalChanges,
          isSpreadsheet: true,
          rowsAdded: rows?.length || 0,
        });
      }

      // ── COPY-AND-REPLACE MODE: Copy template and replace placeholders ──
      if (replacements && templateFileId) {
        console.log(`[SAVE] COPY-AND-REPLACE: copying template ${templateFileId}...`);

        // Check original file type
        const origMeta = await drive.files.get({
          fileId: templateFileId,
          fields: "mimeType,name",
          supportsAllDrives: true,
        });

        const origMime = origMeta.data.mimeType;
        const isGoogleDoc = origMime === "application/vnd.google-apps.document";

        console.log(`[SAVE] Original: ${origMeta.data.name}, mimeType: ${origMime}, isGoogleDoc: ${isGoogleDoc}`);

        // Copy the template — always convert to Google Doc for replaceAllText to work
        const copiedFile = await drive.files.copy({
          fileId: templateFileId,
          requestBody: {
            name: docName,
            // Convert to Google Doc if not already (critical for .docx uploads!)
            ...(isGoogleDoc ? {} : { mimeType: "application/vnd.google-apps.document" }),
            parents: [saveFolderId],
          },
          supportsAllDrives: true,
          fields: "id,name,webViewLink",
        });

        console.log(`[SAVE] Copied → ${copiedFile.data.id} (${isGoogleDoc ? "native GoogleDoc" : "converted to GoogleDoc"})`);

        // Replace placeholders using Google Docs API
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });
        const docs = google.docs({ version: "v1", auth });

        const replaceRequests = Object.entries(replacements).map(([oldText, newText]) => ({
          replaceAllText: {
            containsText: { text: oldText, matchCase: false },
            replaceText: String(newText),
          },
        }));

        let replaceCount = 0;
        if (replaceRequests.length > 0) {
          try {
            const batchResult = await docs.documents.batchUpdate({
              documentId: copiedFile.data.id,
              requestBody: { requests: replaceRequests },
            });
            // Count how many were actually replaced
            replaceCount = (batchResult.data.replies || []).reduce((sum, r) => {
              return sum + (r.replaceAllText?.occurrencesChanged || 0);
            }, 0);
            console.log(`[SAVE] ✅ Replaced ${replaceCount} occurrences across ${replaceRequests.length} patterns`);
          } catch (replaceErr) {
            console.error(`[SAVE] Replace error:`, replaceErr.message);
            // Don't fail — the document is still saved with the original placeholders
          }
        }

        console.log(`[SAVE] ═══ SUCCESS → ${saveFolderName} ═══\n`);
        return Response.json({
          success: true,
          file: {
            id: copiedFile.data.id,
            name: copiedFile.data.name,
            webViewLink: copiedFile.data.webViewLink,
          },
          folder: saveFolderName || "Entwürfe",
          replacementCount: replaceCount,
          patternsUsed: replaceRequests.length,
        });
      }

      // ── FALLBACK: Create new doc with plain text ──
      console.log(`[SAVE] TEXT FALLBACK: creating new Google Doc...`);
      const newDoc = await drive.files.create({
        requestBody: {
          name: docName,
          mimeType: "application/vnd.google-apps.document",
          parents: [saveFolderId],
        },
        supportsAllDrives: true,
        fields: "id,name,webViewLink",
      });

      const auth2 = new google.auth.OAuth2();
      auth2.setCredentials({ access_token: accessToken });
      const docs = google.docs({ version: "v1", auth: auth2 });
      await docs.documents.batchUpdate({
        documentId: newDoc.data.id,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: filledContent || "",
              },
            },
          ],
        },
      });

      return Response.json({
        success: true,
        file: {
          id: newDoc.data.id,
          name: newDoc.data.name,
          webViewLink: newDoc.data.webViewLink,
        },
        folder: saveFolderName || "Entwürfe",
      });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Formsheet API error:", error.message, error.stack);
    // Provide helpful error messages
    const msg = error.message || "Unknown error";
    if (msg.includes("Invalid Credentials") || msg.includes("invalid_grant")) {
      return Response.json({ error: "Invalid Credentials — your session has expired. Please sign in again." }, { status: 401 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}

// ═══ GET: Return formsheet registry ═══
export async function GET() {
  return Response.json({ formsheets: FORMSHEET_REGISTRY });
}
