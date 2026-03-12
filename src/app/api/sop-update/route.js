import { google } from "googleapis";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Header,
  Footer,
  AlignmentType,
  PageNumber,
} from "docx";
import { getDriveClient, findSopFile, exportFileAsText } from "../../../lib/driveHelper";
import { Readable } from "stream";

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

// ═══ SOP-specific patches ═══
// Each patch defines content to INSERT or REPLACE in specific sections.

const SOP_PATCHES = {
  "WM-SOP-003": {
    versionBump: { from: "V0.04", to: "V0.05" },
    // Inject SRS section after "Design Output" or "Design and Development Output"
    insertAfterPattern: /design\s*(and\s*development\s*)?output/i,
    insertContent: `

### Software Requirements Specification (SRS)

A Software Requirements Specification (SRS) shall be derived from the User Requirements Specification (URS, WM-SOP-003-F-004). The SRS defines all functional, performance, interface, and regulatory requirements for the AI-Agent software product. It translates user needs into verifiable technical requirements.

The SRS shall include:
- Functional requirements (features, algorithms, data processing)
- Performance requirements (response time, accuracy, throughput)
- Interface requirements (APIs, data formats, external systems)
- Regulatory requirements (applicable standards per intended use)
- Safety and security requirements

The SRS serves as the primary input for Software Verification and Validation activities (see WM-SOP-011). All SRS requirements shall be traceable via the Traceability Matrix (WM-SOP-011-F-003).

The SRS document (WM-SOP-003-F-005) shall be maintained in the Development folder in the DMS.

`,
    // Replace hardcoded folder paths
    pathReplacements: [
      {
        pattern: /\/QMS\/02_Records\/Design_Records\/\[?Agent[_\s]*Name\]?[_\/]*DHF\/?/gi,
        replacement: "the Development folder in the DMS, organized per AI-Agent product",
      },
      {
        pattern: /Google\s*Drive:\s*\/QMS\/[^\n]*/gi,
        replacement: "the DMS (Google Drive), in the corresponding area folder",
      },
      {
        pattern: /stored\s+in\s+Google\s+Drive\s*:\s*\/[^\n]*/gi,
        replacement: "stored in the DMS (Google Drive), in the corresponding area folder",
      },
    ],
  },

  "WM-SOP-011": {
    versionBump: { from: "V0.04", to: "V0.05" },
    // Insert V&V sections after "Procedure" heading or at the end of procedure section
    insertAfterPattern: /procedure|verification\s*and\s*validation|test\s*process/i,
    insertContent: `

### Software Verification

Software Verification confirms that the software implementation correctly fulfills all requirements specified in the Software Requirements Specification (SRS, per WM-SOP-003).

**Process:**
1. Derive test cases from each SRS requirement (line-by-line requirement coverage).
2. Document test cases in the Test Protocol (WM-SOP-011-F-002).
3. Execute functional tests under defined, reproducible conditions.
4. Record pass/fail results and observations in the Test Summary Report (WM-SOP-011-F-004).
5. Map each test case to its corresponding SRS requirement via the Traceability Matrix (WM-SOP-011-F-003) to ensure complete requirement coverage.

**Inputs:** SRS (WM-SOP-003-F-005), Test System Qualification Protocol (WM-SOP-011-F-005).
**Outputs:** Test Protocol (F-002), Test Summary Report (F-004), Traceability Matrix (F-003).

### Software Validation

Software Validation confirms that the finished software product meets its intended clinical use and satisfies user needs. This includes the statistical validation of diagnostic performance.

**Process:**
1. Define validation objectives, scope, and acceptance criteria in the Validation Plan (WM-SOP-011-F-001).
2. Validate clinical/diagnostic performance using representative, independent datasets.
3. Evaluate statistical significance of diagnostic capability, including but not limited to: sensitivity, specificity, accuracy, positive/negative predictive value.
4. Document validation results, statistical analysis, and conclusions in the Test Summary Report (WM-SOP-011-F-004).

**Inputs:** Validation Plan (F-001), representative clinical/reference datasets, applicable regulatory requirements.
**Outputs:** Validation Plan (F-001), Traceability Matrix (F-003), Test Summary Report (F-004).

### Relationship between Verification and Validation

Both Verification and Validation activities shall reference the SRS (defined per WM-SOP-003) as the primary source of truth for expected software behavior. Verification addresses the question "Did we build the software correctly?" while Validation addresses "Did we build the correct software for the intended clinical use?"

All V&V records are maintained in the Development folder in the DMS.

`,
    pathReplacements: [
      {
        pattern: /\/QMS\/[^\n]*(?:Record|DHF|Design)[^\n]*/gi,
        replacement: "the Development folder in the DMS",
      },
      {
        pattern: /Google\s*Drive:\s*\/QMS\/[^\n]*/gi,
        replacement: "the DMS (Google Drive), in the corresponding area folder",
      },
    ],
  },
};

// ═══ Parse SOP text into sections ═══
function parseSections(text) {
  const lines = text.split("\n");
  const sections = [];
  let currentSection = { heading: "", content: [] };

  for (const line of lines) {
    // Detect section headings (numbered: "1.", "2.", "1.1", or markdown: "## ", "### ")
    const isHeading =
      /^\d+(\.\d+)*\.?\s+[A-Z]/.test(line.trim()) ||
      /^#{1,3}\s/.test(line.trim());

    if (isHeading && currentSection.content.length > 0) {
      sections.push({ ...currentSection });
      currentSection = { heading: line.trim(), content: [] };
    } else if (isHeading) {
      currentSection.heading = line.trim();
    } else {
      currentSection.content.push(line);
    }
  }
  // Push last section
  if (currentSection.heading || currentSection.content.length > 0) {
    sections.push(currentSection);
  }

  return sections;
}

// ═══ Apply patches to SOP text ═══
function applyPatches(text, sopId) {
  const patch = SOP_PATCHES[sopId];
  if (!patch) return text;

  let result = text;

  // Apply path replacements first
  if (patch.pathReplacements) {
    for (const { pattern, replacement } of patch.pathReplacements) {
      result = result.replace(pattern, replacement);
    }
  }

  // Insert new content after matching pattern
  if (patch.insertAfterPattern && patch.insertContent) {
    const lines = result.split("\n");
    let insertIndex = -1;

    // Find the section that matches the pattern
    for (let i = 0; i < lines.length; i++) {
      if (patch.insertAfterPattern.test(lines[i])) {
        // Find the end of this section (next numbered heading or end of text)
        for (let j = i + 1; j < lines.length; j++) {
          if (/^\d+(\.\d+)*\.?\s+[A-Z]/.test(lines[j].trim())) {
            insertIndex = j;
            break;
          }
        }
        if (insertIndex === -1) insertIndex = lines.length;
        break;
      }
    }

    if (insertIndex > 0) {
      lines.splice(insertIndex, 0, patch.insertContent);
      result = lines.join("\n");
    } else {
      // If pattern not found, append at the end before "References" or "Document History"
      const refIndex = lines.findIndex((l) =>
        /^\d+\.?\s*(References|Document\s*History|Revision\s*History|Anhang)/i.test(l.trim())
      );
      if (refIndex > 0) {
        lines.splice(refIndex, 0, patch.insertContent);
      } else {
        lines.push(patch.insertContent);
      }
      result = lines.join("\n");
    }
  }

  return result;
}

// ═══ Convert text to docx elements ═══
function textToDocxElements(text, sopId, sopName, version) {
  const lines = text.split("\n");
  const children = [];

  // Title
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 },
      children: [
        new TextRun({ text: `${sopId}: ${sopName}`, bold: true, size: 32, font: "Calibri" }),
      ],
    })
  );
  children.push(
    new Paragraph({
      spacing: { after: 400 },
      children: [
        new TextRun({ text: `Version ${version} | ${new Date().toLocaleDateString("en-US")}`, size: 20, color: "666666", font: "Calibri" }),
      ],
    })
  );

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      children.push(new Paragraph({ text: "", spacing: { after: 100 } }));
      continue;
    }

    // Markdown ### heading
    if (trimmed.startsWith("### ")) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
          children: [new TextRun({ text: trimmed.replace(/^###\s*/, ""), bold: true, size: 24, font: "Calibri" })],
        })
      );
      continue;
    }

    // Markdown ## heading
    if (trimmed.startsWith("## ")) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 100 },
          children: [new TextRun({ text: trimmed.replace(/^##\s*/, ""), bold: true, size: 28, font: "Calibri" })],
        })
      );
      continue;
    }

    // Numbered section heading (e.g., "1. Purpose", "2.1 Scope")
    const sectionMatch = trimmed.match(/^(\d+(?:\.\d+)*\.?)\s+(.+)/);
    if (sectionMatch && /^[A-Z]/.test(sectionMatch[2])) {
      const level = sectionMatch[1].split(".").filter(Boolean).length;
      children.push(
        new Paragraph({
          heading: level <= 1 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          spacing: { before: level <= 1 ? 400 : 200, after: 100 },
          children: [
            new TextRun({ text: `${sectionMatch[1]} `, bold: true, size: level <= 1 ? 28 : 24, font: "Calibri" }),
            new TextRun({ text: sectionMatch[2], bold: true, size: level <= 1 ? 28 : 24, font: "Calibri" }),
          ],
        })
      );
      continue;
    }

    // Bold line (**text**)
    if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
      children.push(
        new Paragraph({
          spacing: { before: 100, after: 50 },
          children: [new TextRun({ text: trimmed.replace(/\*\*/g, ""), bold: true, size: 22, font: "Calibri" })],
        })
      );
      continue;
    }

    // Bullet points
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const bulletText = trimmed.replace(/^[-*]\s*/, "");
      children.push(
        new Paragraph({
          indent: { left: 360 },
          spacing: { after: 50 },
          children: [
            new TextRun({ text: "\u2022 ", size: 22, font: "Calibri" }),
            ...parseInline(bulletText),
          ],
        })
      );
      continue;
    }

    // Numbered items (1. text)
    const numMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
    if (numMatch && !/^[A-Z][a-z]*\s/.test(numMatch[2]) === false) {
      // Only treat as list item if not a section heading
      if (numMatch[2] && !numMatch[2].match(/^[A-Z][a-z]+\s+[A-Z]/)) {
        children.push(
          new Paragraph({
            indent: { left: 360 },
            spacing: { after: 50 },
            children: [
              new TextRun({ text: `${numMatch[1]}. `, bold: true, size: 22, font: "Calibri" }),
              ...parseInline(numMatch[2]),
            ],
          })
        );
        continue;
      }
    }

    // Regular paragraph
    children.push(
      new Paragraph({
        spacing: { after: 80 },
        children: parseInline(trimmed),
      })
    );
  }

  return children;
}

// Parse inline bold/italic formatting
function parseInline(text) {
  const runs = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index), size: 22, font: "Calibri" }));
    }
    runs.push(new TextRun({ text: match[1], bold: true, size: 22, font: "Calibri" }));
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex), size: 22, font: "Calibri" }));
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text, size: 22, font: "Calibri" }));
  }

  return runs;
}

// ═══ Generate .docx buffer ═══
function generateDocx(children, sopId, version) {
  const today = new Date().toLocaleDateString("en-US");

  return new Document({
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22 },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1200, right: 1200 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: "WAVEMEDIX Inc. | Quality Management System", size: 16, color: "028090", font: "Calibri" }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: `${sopId} | ${version} | ${today}`, size: 14, color: "999999", font: "Calibri" }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: `${sopId} — ${version} — Page `, size: 14, color: "999999" }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 14, color: "999999" }),
                  new TextRun({ text: " / ", size: 14, color: "999999" }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, color: "999999" }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
}

// ═══ SOP name lookup ═══
const SOP_NAMES = {
  "WM-QMS-002": "Quality Manual",
  "WM-SOP-001": "Document Control",
  "WM-SOP-002": "Record Management",
  "WM-SOP-003": "AI-Agent Design & Development",
  "WM-SOP-004": "Algorithm Risk Management",
  "WM-SOP-005": "Trending & KPI Management",
  "WM-SOP-006": "Complaint & Adverse Event",
  "WM-SOP-007": "Post-Market Surveillance",
  "WM-SOP-008": "FDE Deployment & Release",
  "WM-SOP-009": "Regulatory Intelligence",
  "WM-SOP-010": "Supplier Management",
  "WM-SOP-011": "Software Validation Testing",
  "WM-SOP-012": "Internal Audit Program",
  "WM-SOP-013": "IT Security & Part 11",
  "WM-SOP-015": "CAPA Management",
  "WM-SOP-016": "Continuous AI Training",
  "WM-SOP-017": "Data Management & Hygiene",
  "WM-SOP-018": "Engineering Change Management",
  "WM-SOP-019": "PCCP Management",
};

// ═══ POST /api/sop-update — Update a specific SOP ═══
export async function POST(request) {
  try {
    const accessToken = request.headers.get("x-access-token");
    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { sopId, dryRun } = await request.json();
    if (!sopId || !SOP_NAMES[sopId]) {
      return Response.json({ error: `Unknown SOP: ${sopId}` }, { status: 400 });
    }

    if (!SOP_PATCHES[sopId]) {
      return Response.json({ error: `No patches defined for ${sopId}` }, { status: 400 });
    }

    const drive = getDriveClient(accessToken);
    const patch = SOP_PATCHES[sopId];
    const sopName = SOP_NAMES[sopId];
    const newVersion = patch.versionBump?.to || "V0.05";

    console.log(`[SOP-UPDATE] Starting update for ${sopId} → ${newVersion}`);

    // Step 1: Find current SOP (include SUPERSEDED — Shared Drive renames may not stick)
    const allFiles = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed = false and name contains '${sopId}'`,
      fields: "files(id,name,mimeType)",
      pageSize: 50,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: "allDrives",
    });

    // Find the SOP doc (not a formsheet F-XXX or template T-XXX, not a _LIVE_ doc)
    const sopFile = (allFiles.data.files || []).find(
      (f) =>
        f.name.includes(sopId) &&
        !f.name.match(/[-_](F-?\d{3}|T-?\d{3})/) &&
        !f.name.includes("_LIVE_") &&
        f.mimeType !== "application/vnd.google-apps.folder"
    );

    if (!sopFile) {
      return Response.json({ error: `SOP file not found in Drive: ${sopId}` }, { status: 404 });
    }

    console.log(`[SOP-UPDATE] Found: ${sopFile.name} (${sopFile.id})`);

    const originalText = await exportFileAsText(drive, sopFile);
    if (!originalText) {
      return Response.json({ error: `Could not read SOP content: ${sopId}` }, { status: 500 });
    }

    // Step 2: Apply patches
    const patchedText = applyPatches(originalText, sopId);

    // If dry run, return the patched text for review
    if (dryRun) {
      return Response.json({
        sopId,
        originalFile: sopFile.name,
        originalLength: originalText.length,
        patchedLength: patchedText.length,
        newVersion,
        preview: patchedText.substring(0, 3000),
        fullText: patchedText,
      });
    }

    // Step 3: Generate new .docx
    const docxElements = textToDocxElements(patchedText, sopId, sopName, newVersion);
    const doc = generateDocx(docxElements, sopId, newVersion);
    const buffer = await Packer.toBuffer(doc);

    // Step 4: Upload new version as Google Doc (directly openable in Drive)
    const newDocName = `${sopId}_${sopName.replace(/\s+/g, "_")}_${newVersion}`;

    const stream = Readable.from(buffer);
    const uploaded = await drive.files.create({
      requestBody: {
        name: newDocName,
        parents: [FOLDER_ID],
        mimeType: "application/vnd.google-apps.document",
      },
      media: {
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        body: stream,
      },
      fields: "id,name,webViewLink",
      supportsAllDrives: true,
    });

    // Step 5: Try to trash the old file (Shared Drive may restrict this)
    try {
      await drive.files.update({
        fileId: sopFile.id,
        requestBody: { trashed: true },
        supportsAllDrives: true,
      });
      console.log(`[SOP-UPDATE] Trashed old: ${sopFile.name}`);
    } catch (e) {
      console.warn(`[SOP-UPDATE] Could not trash old file (Shared Drive restriction): ${e.message}`);
    }

    console.log(`[SOP-UPDATE] Uploaded new: ${uploaded.data.name} (${uploaded.data.id})`);

    return Response.json({
      success: true,
      sopId,
      oldFile: { id: sopFile.id, name: sopFile.name },
      newFile: {
        id: uploaded.data.id,
        name: uploaded.data.name,
        webViewLink: uploaded.data.webViewLink,
      },
      newVersion,
      patchedLength: patchedText.length,
    });
  } catch (error) {
    console.error("[SOP-UPDATE] Error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// ═══ GET /api/sop-update?scan=paths — Scan all SOPs for folder path references ═══
export async function GET(request) {
  try {
    const accessToken = request.headers.get("x-access-token");
    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("scan") || "paths";

    if (mode !== "paths") {
      return Response.json({ error: "Use ?scan=paths" }, { status: 400 });
    }

    const drive = getDriveClient(accessToken);
    const sopIds = Object.keys(SOP_NAMES);
    const results = [];

    const pathPatterns = [
      /\/QMS\/[^\s\n]*/g,
      /Google\s*Drive\s*:\s*[^\n]*/gi,
      /\/\d{2}_[A-Za-z_]+\//g,
      /Design_Records/gi,
      /02_Records/gi,
    ];

    for (const sopId of sopIds) {
      try {
        const sopFile = await findSopFile(drive, sopId);
        if (!sopFile) {
          results.push({ sopId, status: "not_found" });
          continue;
        }

        const text = await exportFileAsText(drive, sopFile);
        if (!text) {
          results.push({ sopId, fileName: sopFile.name, status: "unreadable" });
          continue;
        }

        const foundPaths = [];
        for (const pattern of pathPatterns) {
          const matches = text.match(pattern);
          if (matches) {
            foundPaths.push(...matches.map((m) => m.trim()));
          }
        }

        results.push({
          sopId,
          fileName: sopFile.name,
          status: foundPaths.length > 0 ? "has_paths" : "clean",
          paths: [...new Set(foundPaths)],
        });
      } catch (e) {
        results.push({ sopId, status: "error", error: e.message });
      }
    }

    const withPaths = results.filter((r) => r.status === "has_paths");
    console.log(`[SOP-UPDATE] Path scan: ${withPaths.length} SOPs with folder paths found`);

    return Response.json({
      totalScanned: results.length,
      withPaths: withPaths.length,
      results,
    });
  } catch (error) {
    console.error("[SOP-UPDATE] Scan error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
