import { Readable } from "stream";
import { google } from "googleapis";
import Anthropic from "@anthropic-ai/sdk";
import { loadProjectContext } from "../../../lib/buildSystemPrompt";

// ═══ Canonical SOP ordering ═══
const SOP_ORDER = [
  "WM-QMS-002", "WM-SOP-001", "WM-SOP-002", "WM-SOP-003", "WM-SOP-004",
  "WM-SOP-005", "WM-SOP-006", "WM-SOP-007", "WM-SOP-008", "WM-SOP-009",
  "WM-SOP-010", "WM-SOP-011", "WM-SOP-012", "WM-SOP-013", "WM-SOP-015",
  "WM-SOP-016", "WM-SOP-017", "WM-SOP-018", "WM-SOP-019",
];

// Folders to skip during audit (case-insensitive partial match)
const SKIP_FOLDERS = ["old sop", "old formsheet", "old form", "entwürfe", "drafts"];

function createDriveClient(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

// ═══ List QMH files, skipping "Old" folders ═══
async function listQmhFiles(drive, folderId, prefix = "") {
  const results = [];
  if (!folderId) return results;

  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "files(id,name,mimeType,modifiedTime)",
      pageSize: 500,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: "allDrives",
    });

    for (const f of res.data.files || []) {
      if (f.mimeType === "application/vnd.google-apps.folder") {
        // Skip "Old SOPs", "Old Formsheets", "Entwürfe", "Drafts" etc.
        const lowerName = f.name.toLowerCase();
        if (SKIP_FOLDERS.some((skip) => lowerName.includes(skip))) {
          console.log(`[AUDIT] Skipping folder: ${f.name}`);
          continue;
        }
        const subFiles = await listQmhFiles(drive, f.id, prefix ? `${prefix}/${f.name}` : f.name);
        results.push(...subFiles);
      } else {
        results.push({ ...f, folder: prefix || "root" });
      }
    }
  } catch (err) {
    console.warn(`[AUDIT] Could not list folder ${folderId}:`, err.message);
  }
  return results;
}

// ═══ Extract SOP ID from filename ═══
function extractSopId(name) {
  // Match WM-QMS-002, WM-SOP-001, etc.
  const match = name.match(/(WM-(?:QMS|SOP)-\d{3})/);
  return match ? match[1] : null;
}

// ═══ Extract formsheet suffix (F-001, T-001) from filename ═══
function extractFormsheetSuffix(name) {
  const match = name.match(/(WM-(?:QMS|SOP)-\d{3})-([FT]-\d{3})/);
  return match ? match[2] : null;
}

// ═══ Extract version number from filename ═══
function extractVersion(name) {
  const match = name.match(/[Vv](\d+)[._](\d+)/);
  if (match) return parseFloat(`${match[1]}.${match[2]}`);
  // Fallback: look for just Vx
  const match2 = name.match(/[Vv](\d+)/);
  if (match2) return parseFloat(match2[1]);
  return 0;
}

// ═══ Keep only highest version per document ═══
function filterHighestVersions(files) {
  // Group by base document key (SOP ID + optional formsheet suffix)
  const groups = {};
  for (const f of files) {
    const sopId = extractSopId(f.name);
    if (!sopId) {
      // Include files without SOP IDs too (other QMH docs)
      groups[f.id] = [f];
      continue;
    }
    const fsSuffix = extractFormsheetSuffix(f.name);
    const key = fsSuffix ? `${sopId}-${fsSuffix}` : sopId;
    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  }

  // For each group, keep only the highest version
  const result = [];
  for (const [, group] of Object.entries(groups)) {
    if (group.length === 1) {
      result.push(group[0]);
    } else {
      group.sort((a, b) => extractVersion(b.name) - extractVersion(a.name));
      result.push(group[0]); // highest version
    }
  }
  return result;
}

// ═══ Order files: SOPs first, then their formsheets, in canonical order ═══
function orderBySop(files) {
  const ordered = [];
  const used = new Set();

  for (const sopId of SOP_ORDER) {
    // First: the main SOP document
    const mainSop = files.find((f) => {
      const fSopId = extractSopId(f.name);
      return fSopId === sopId && !extractFormsheetSuffix(f.name);
    });
    if (mainSop) {
      ordered.push(mainSop);
      used.add(mainSop.id);
    }

    // Then: formsheets for this SOP
    const formsheets = files.filter((f) => {
      const fSopId = extractSopId(f.name);
      return fSopId === sopId && extractFormsheetSuffix(f.name);
    });
    formsheets.sort((a, b) => a.name.localeCompare(b.name));
    for (const fs of formsheets) {
      if (!used.has(fs.id)) {
        ordered.push(fs);
        used.add(fs.id);
      }
    }
  }

  // Add any remaining files not matched to known SOPs
  for (const f of files) {
    if (!used.has(f.id)) {
      ordered.push(f);
      used.add(f.id);
    }
  }

  return ordered;
}

// ═══ Extract text from any Drive file (Google Docs, Sheets, .docx, .xlsx) ═══
async function extractText(drive, fileId, mimeType, maxChars = 8000) {
  try {
    let text = null;

    // Native Google Docs → export as plain text
    if (mimeType === "application/vnd.google-apps.document") {
      const res = await drive.files.export({ fileId, mimeType: "text/plain" });
      text = typeof res.data === "string" ? res.data : String(res.data);
    }
    // Native Google Sheets → export as CSV
    else if (mimeType === "application/vnd.google-apps.spreadsheet") {
      const res = await drive.files.export({ fileId, mimeType: "text/csv" });
      text = typeof res.data === "string" ? res.data : String(res.data);
    }
    // Uploaded .docx → convert to temp Google Doc, export as text, then delete temp
    else if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType === "application/msword"
    ) {
      console.log(`[AUDIT] Converting .docx ${fileId} to Google Doc for text extraction...`);
      const tempDoc = await drive.files.copy({
        fileId,
        requestBody: {
          name: "__audit_temp_extract__",
          mimeType: "application/vnd.google-apps.document",
        },
        supportsAllDrives: true,
        fields: "id",
      });
      const tempId = tempDoc.data.id;
      try {
        const res = await drive.files.export({ fileId: tempId, mimeType: "text/plain" });
        text = typeof res.data === "string" ? res.data : String(res.data);
        console.log(`[AUDIT] .docx converted → ${text.length} chars`);
      } finally {
        drive.files.delete({ fileId: tempId, supportsAllDrives: true }).catch(() => {});
      }
    }
    // Uploaded .xlsx → convert to temp Google Sheet, export as CSV, then delete temp
    else if (
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimeType === "application/vnd.ms-excel"
    ) {
      console.log(`[AUDIT] Converting .xlsx ${fileId} to Google Sheet for text extraction...`);
      const tempSheet = await drive.files.copy({
        fileId,
        requestBody: {
          name: "__audit_temp_extract__",
          mimeType: "application/vnd.google-apps.spreadsheet",
        },
        supportsAllDrives: true,
        fields: "id",
      });
      const tempId = tempSheet.data.id;
      try {
        const res = await drive.files.export({ fileId: tempId, mimeType: "text/csv" });
        text = typeof res.data === "string" ? res.data : String(res.data);
        console.log(`[AUDIT] .xlsx converted → ${text.length} chars`);
      } finally {
        drive.files.delete({ fileId: tempId, supportsAllDrives: true }).catch(() => {});
      }
    }
    // Fallback: try to read binary/text file directly
    else {
      console.log(`[AUDIT] Attempting raw read for mimeType: ${mimeType}`);
      try {
        const res = await drive.files.get(
          { fileId, alt: "media" },
          { responseType: "text" }
        );
        text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      } catch {
        text = null;
      }
    }

    if (text && text.length > maxChars) {
      text = text.substring(0, maxChars) + "\n[... truncated ...]";
    }
    return text;
  } catch (err) {
    console.warn(`[AUDIT] Could not extract text for ${fileId}:`, err.message);
    return null;
  }
}

// ═══ Audit a batch of documents with Claude ═══
async function auditBatch(client, docs, projectContext, auditType = "both") {
  const company = projectContext?.company || "Wavemedix Inc.";
  const standards = projectContext?.standards?.join(", ") || "ISO 13485:2016, IEC 62304:2006+A1, ISO 14971:2019, MDR 2017/745";

  const docTexts = docs.map((d, i) => (
    `--- DOCUMENT ${i + 1} ---
ID: ${extractSopId(d.name) || d.name}${extractFormsheetSuffix(d.name) ? `-${extractFormsheetSuffix(d.name)}` : ""}
Name: ${d.name}
Type: ${d.mimeType === "application/vnd.google-apps.spreadsheet" ? "Spreadsheet" : "Document"}

CONTENT:
${d.text || "[COULD NOT EXTRACT - file may be binary or empty]"}
`
  )).join("\n\n");

  // Build audit-type-specific prompt
  let auditInstructions = "";
  if (auditType === "regulatory") {
    auditInstructions = `Focus ONLY on regulatory compliance:
1. STANDARDS REFERENCED: Are all applicable standards (ISO 13485, IEC 62304, ISO 14971, MDR 2017/745, etc.) properly cited? "Yes" / "Partial" / "No".
2. SIGNATURES PRESENT: Are approval/review/author signature blocks present? "Yes" / "No".
3. CONTENT COMPLETE: Are all required regulatory sections present (Purpose, Scope, Responsibilities, Procedure, Records, References, Definitions)? "Yes" / "Partial" / "No".
4. LOGIC & CONTENT COMMENTS: Focus on regulatory gaps, missing references, compliance concerns. 2-4 sentences.
5. IMPROVEMENT SUGGESTIONS: Regulatory-focused recommendations. 2-4 sentences.`;
  } else if (auditType === "content") {
    auditInstructions = `Focus ONLY on content quality and completeness:
1. STANDARDS REFERENCED: "N/A" (skip for content audit).
2. SIGNATURES PRESENT: "N/A" (skip for content audit).
3. CONTENT COMPLETE: Is the content thorough, well-structured, and actionable? "Yes" / "Partial" / "No".
4. LOGIC & CONTENT COMMENTS: Is the content internally consistent? Are procedures clear? Any ambiguities or gaps? Are definitions adequate? 2-4 sentences.
5. IMPROVEMENT SUGGESTIONS: Content-focused improvements — clarity, structure, completeness, actionability. 2-4 sentences.`;
  } else {
    auditInstructions = `Perform a FULL regulatory + content audit:
1. STANDARDS REFERENCED: Are all applicable standards (ISO 13485, IEC 62304, ISO 14971, MDR 2017/745, etc.) properly cited? "Yes" / "Partial" / "No".
2. SIGNATURES PRESENT: Are approval/review/author signature blocks present? "Yes" / "No".
3. CONTENT COMPLETE: Are all required sections present and filled? "Yes" / "Partial" / "No".
4. LOGIC & CONTENT COMMENTS: Question the substance — internal consistency, clarity, actionability, regulatory gaps. 2-4 sentences.
5. IMPROVEMENT SUGGESTIONS: Concrete, actionable improvement recommendations. 2-4 sentences.`;
  }

  const systemPrompt = `You are a regulatory QMS auditor for ${company}.
Standards framework: ${standards}, FDA 21 CFR 820, FDA 21 CFR Part 11.

For EACH document provided, perform a deep audit. Return a JSON array with one object per document:

[
  {
    "documentId": "WM-SOP-001",
    "documentName": "Document name from the header",
    "standardsReferenced": "Yes / No / Partial / N/A",
    "signaturesPresent": "Yes / No / N/A",
    "contentComplete": "Yes / No / Partial",
    "logicComments": "Substantive commentary",
    "improvementSuggestions": "Concrete, actionable recommendations"
  }
]

${auditInstructions}

If a document could not be extracted, note it as "Content not readable" in logicComments.

Language: English. Return ONLY a valid JSON array. No markdown. No code blocks. No explanation text.`;

  try {
    const result = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: docTexts }],
    });

    const responseText = result.content.map((c) => c.text || "").join("");

    // Parse JSON from response — handle potential markdown wrapping
    let cleaned = responseText.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    try {
      return JSON.parse(cleaned);
    } catch {
      // Try extracting JSON array from response
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      console.warn("[AUDIT] Could not parse Claude response as JSON, creating fallback");
      return docs.map((d) => ({
        documentId: extractSopId(d.name) || d.name,
        documentName: d.name,
        standardsReferenced: "N/A",
        signaturesPresent: "N/A",
        contentComplete: "N/A",
        logicComments: "Audit parsing error — manual review needed",
        improvementSuggestions: "Re-run audit or review manually",
      }));
    }
  } catch (err) {
    console.error("[AUDIT] Claude API error for batch:", err.message);
    return docs.map((d) => ({
      documentId: extractSopId(d.name) || d.name,
      documentName: d.name,
      standardsReferenced: "Error",
      signaturesPresent: "Error",
      contentComplete: "Error",
      logicComments: `API error: ${err.message}`,
      improvementSuggestions: "Re-run audit",
    }));
  }
}

// ═══ Escape a CSV field ═══
function csvEscape(val) {
  const str = String(val || "").replace(/"/g, '""');
  return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str}"` : str;
}

// ═══ Create audit report as Google Sheet (upload CSV → auto-convert) ═══
// Uses only the Drive API (no Sheets API needed)
async function createSheetsReport(drive, _sheets, qmhFolderId, auditResults, suffix = "", auditCategory = "", auditType = "") {
  const today = new Date().toISOString().split("T")[0];
  const reportName = `QMS_Audit_Report${suffix}_${today}`;

  const headers = [
    "Audit Category",
    "Audit Type",
    "Document ID",
    "Document Name",
    "Standards Referenced",
    "Signatures Present",
    "Content Complete",
    "Logic & Content Comments",
    "Improvement Suggestions",
  ];

  const catLabel = auditCategory || "All";
  const typeLabel = auditType || "Both";

  // Build CSV content
  const csvRows = [headers.map(csvEscape).join(",")];
  for (const r of auditResults) {
    csvRows.push([
      catLabel, typeLabel,
      r.documentId, r.documentName, r.standardsReferenced,
      r.signaturesPresent, r.contentComplete, r.logicComments,
      r.improvementSuggestions,
    ].map(csvEscape).join(","));
  }
  const csvContent = csvRows.join("\n");

  // Upload CSV and auto-convert to Google Sheet via Drive API
  const stream = Readable.from([csvContent]);

  const newFile = await drive.files.create({
    requestBody: {
      name: reportName,
      mimeType: "application/vnd.google-apps.spreadsheet", // Convert to Google Sheet
      parents: [qmhFolderId],
    },
    media: {
      mimeType: "text/csv",
      body: stream,
    },
    supportsAllDrives: true,
    fields: "id,name,webViewLink",
  });

  console.log(`[AUDIT] Report created: ${newFile.data.name} (${newFile.data.id})`);

  return {
    id: newFile.data.id,
    name: newFile.data.name,
    webViewLink: newFile.data.webViewLink,
  };
}

// ═══ POST: Perform deep regulatory document audit ═══
// Supports optional `scope` parameter to audit specific SOPs: e.g. "WM-SOP-001" or "WM-SOP-001,WM-SOP-003"
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

    const qmhFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!qmhFolderId) {
      return Response.json({ error: "QMH folder ID not configured" }, { status: 500 });
    }

    const body = await request.json();
    const { scope, category, selectedItems, auditType, developmentFolderId, operationsFolderId } = body;

    // Legacy: scope param for chat-based audit
    const scopeIds = scope
      ? scope.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
      : null;

    const drive = createDriveClient(accessToken);
    const client = new Anthropic({ apiKey });
    const projectContext = await loadProjectContext();

    const scopeLabel = category ? `${category}: ${(selectedItems || []).join(", ")}` : (scopeIds ? scopeIds.join(", ") : "ALL");
    console.log(`\n[AUDIT] ═══ Starting Deep Regulatory Audit (scope: ${scopeLabel}, type: ${auditType || "both"}) ═══`);

    // Step 1: Collect files based on category
    let allFiles = [];

    if (category === "development" && developmentFolderId) {
      // Audit Development folder files
      allFiles = await listQmhFiles(drive, developmentFolderId);
      if (selectedItems && selectedItems.length > 0) {
        allFiles = allFiles.filter((f) => {
          const folder = f.folder || "";
          return selectedItems.some((sel) => folder.includes(sel) || folder === sel);
        });
      }
      console.log(`[AUDIT] Development files: ${allFiles.length}`);
    } else if (category === "operations" && operationsFolderId) {
      // Audit Operations folder files
      allFiles = await listQmhFiles(drive, operationsFolderId);
      if (selectedItems && selectedItems.length > 0) {
        allFiles = allFiles.filter((f) => {
          const folder = f.folder || "";
          return selectedItems.some((sel) => folder.includes(sel) || folder === sel);
        });
      }
      console.log(`[AUDIT] Operations files: ${allFiles.length}`);
    } else {
      // Default: QMH files (SOPs + Formsheets)
      allFiles = await listQmhFiles(drive, qmhFolderId);
    }

    console.log(`[AUDIT] Total files found: ${allFiles.length}`);

    // Step 2: Filter to highest versions only
    const filtered = filterHighestVersions(allFiles);
    console.log(`[AUDIT] After version filter: ${filtered.length} documents`);

    // Step 3: Order by SOP (SOP first, then its formsheets)
    let ordered = orderBySop(filtered);
    console.log(`[AUDIT] Ordered ${ordered.length} documents for audit`);

    // Step 3b: Category-based filtering
    if (category === "sops" && selectedItems && selectedItems.length > 0) {
      // Filter to selected SOPs (main SOP docs only, not formsheets)
      ordered = ordered.filter((f) => {
        const sopId = extractSopId(f.name);
        return sopId && selectedItems.includes(sopId);
      });
      console.log(`[AUDIT] Scoped to SOPs: ${ordered.length} documents`);
    } else if (category === "formsheets" && selectedItems && selectedItems.length > 0) {
      // Filter to selected formsheet IDs
      ordered = ordered.filter((f) => {
        const sopId = extractSopId(f.name);
        const fsSuffix = extractFormsheetSuffix(f.name);
        if (!sopId) return false;
        const fullId = fsSuffix ? `${sopId}-${fsSuffix}` : sopId;
        return selectedItems.includes(fullId);
      });
      console.log(`[AUDIT] Scoped to Formsheets: ${ordered.length} documents`);
    } else if (scopeIds && scopeIds.length > 0) {
      // Legacy scope filter
      ordered = ordered.filter((f) => {
        const sopId = extractSopId(f.name);
        return sopId && scopeIds.includes(sopId);
      });
      console.log(`[AUDIT] Scoped to ${scopeIds.join(", ")}: ${ordered.length} documents`);
    }

    // Step 4: Extract text from all documents (parallel batches of 10)
    console.log(`[AUDIT] Extracting text from ${ordered.length} documents...`);
    const TEXT_BATCH = 10;
    for (let i = 0; i < ordered.length; i += TEXT_BATCH) {
      const batch = ordered.slice(i, i + TEXT_BATCH);
      console.log(`[AUDIT] Text extraction ${i + 1}-${Math.min(i + TEXT_BATCH, ordered.length)}/${ordered.length}...`);
      const results = await Promise.all(
        batch.map((doc) => extractText(drive, doc.id, doc.mimeType).catch(() => ""))
      );
      batch.forEach((doc, idx) => { doc.text = results[idx]; });
    }

    // Filter to documents that have extractable text (skip folders, PDFs, images, etc.)
    const SUPPORTED_MIME_TYPES = [
      "application/vnd.google-apps.document",
      "application/vnd.google-apps.spreadsheet",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];
    const auditable = ordered.filter(
      (d) => SUPPORTED_MIME_TYPES.includes(d.mimeType) && d.text
    );
    console.log(`[AUDIT] Auditable documents (with extractable text): ${auditable.length}`);

    if (auditable.length === 0) {
      return Response.json({ error: `No auditable documents found${scopeIds ? ` for scope: ${scopeIds.join(", ")}` : ""}` }, { status: 404 });
    }

    // Count SOPs and formsheets
    const sopCount = auditable.filter((d) => extractSopId(d.name) && !extractFormsheetSuffix(d.name)).length;
    const formsheetCount = auditable.filter((d) => extractFormsheetSuffix(d.name)).length;

    // Step 5: Batch audit with Claude
    const BATCH_SIZE = 5;
    const batches = [];
    for (let i = 0; i < auditable.length; i += BATCH_SIZE) {
      batches.push(auditable.slice(i, i + BATCH_SIZE));
    }
    console.log(`[AUDIT] Processing ${batches.length} batches of ${BATCH_SIZE}...`);

    const allResults = [];
    const CONCURRENT = 3;
    for (let i = 0; i < batches.length; i += CONCURRENT) {
      const chunk = batches.slice(i, i + CONCURRENT);
      console.log(`[AUDIT] Running batches ${i + 1}-${Math.min(i + CONCURRENT, batches.length)}/${batches.length}...`);
      const chunkResults = await Promise.all(
        chunk.map((batch) => auditBatch(client, batch, projectContext, auditType || "both"))
      );
      chunkResults.forEach((r) => allResults.push(...r));
    }

    console.log(`[AUDIT] All batches complete. Total results: ${allResults.length}`);

    // Step 6: Create Google Sheets report
    const reportSuffix = category ? `_${category}` : (scopeIds ? `_${scopeIds.join("_")}` : "");
    console.log(`[AUDIT] Creating Google Sheets report...`);
    const reportFile = await createSheetsReport(drive, null, qmhFolderId, allResults, reportSuffix, category, auditType);
    console.log(`[AUDIT] ═══ Audit Complete: ${reportFile.name} ═══\n`);

    return Response.json({
      success: true,
      file: reportFile,
      stats: {
        documentsAudited: allResults.length,
        sopsAudited: sopCount,
        formsheetsAudited: formsheetCount,
        batchesUsed: batches.length,
      },
    });
  } catch (error) {
    console.error("[AUDIT] Error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
