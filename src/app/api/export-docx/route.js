import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Header,
  Footer,
  AlignmentType,
  BorderStyle,
  PageNumber,
  NumberFormat,
} from "docx";

// ═══ Parse filled content text into docx-compatible elements ═══
function parseContentToDocx(content, formsheetId) {
  const lines = content.split("\n");
  const children = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Empty line → empty paragraph (spacing)
    if (!trimmed) {
      children.push(new Paragraph({ text: "" }));
      continue;
    }

    // Markdown headings
    if (trimmed.startsWith("### ")) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [
            new TextRun({
              text: trimmed.replace(/^###\s*/, ""),
              bold: true,
              size: 24,
            }),
          ],
        })
      );
      continue;
    }
    if (trimmed.startsWith("## ")) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [
            new TextRun({
              text: trimmed.replace(/^##\s*/, ""),
              bold: true,
              size: 28,
            }),
          ],
        })
      );
      continue;
    }
    if (trimmed.startsWith("# ")) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [
            new TextRun({
              text: trimmed.replace(/^#\s*/, ""),
              bold: true,
              size: 32,
            }),
          ],
        })
      );
      continue;
    }

    // Horizontal rule
    if (trimmed === "---" || trimmed === "===") {
      children.push(
        new Paragraph({
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999" },
          },
          children: [new TextRun({ text: "" })],
        })
      );
      continue;
    }

    // Checkbox items: - [ ] or - [x]
    if (trimmed.match(/^[-*]\s*\[[ x]\]/)) {
      const checked = trimmed.includes("[x]") || trimmed.includes("[X]");
      const text = trimmed.replace(/^[-*]\s*\[[ xX]\]\s*/, "");
      children.push(
        new Paragraph({
          indent: { left: 360 },
          children: [
            new TextRun({
              text: checked ? "\u2611 " : "\u2610 ",
              font: "Segoe UI Symbol",
              size: 22,
            }),
            new TextRun({ text, size: 22 }),
          ],
        })
      );
      continue;
    }

    // Bullet points
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const text = trimmed.replace(/^[-*]\s*/, "");
      children.push(
        new Paragraph({
          indent: { left: 360 },
          children: [
            new TextRun({ text: "\u2022 ", size: 22 }),
            ...parseInlineFormatting(text),
          ],
        })
      );
      continue;
    }

    // Numbered items
    const numMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
    if (numMatch) {
      children.push(
        new Paragraph({
          indent: { left: 360 },
          children: [
            new TextRun({ text: `${numMatch[1]}. `, bold: true, size: 22 }),
            ...parseInlineFormatting(numMatch[2]),
          ],
        })
      );
      continue;
    }

    // Bold lines (all-caps or **wrapped**)
    if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: trimmed.replace(/\*\*/g, ""),
              bold: true,
              size: 22,
            }),
          ],
        })
      );
      continue;
    }

    // [TODO: ...] markers highlighted
    if (trimmed.includes("[TODO:")) {
      children.push(
        new Paragraph({
          children: parseInlineFormatting(trimmed),
        })
      );
      continue;
    }

    // Regular paragraph
    children.push(
      new Paragraph({
        children: parseInlineFormatting(trimmed),
      })
    );
  }

  return children;
}

// ═══ Parse inline formatting (**bold**, [TODO:...]) ═══
function parseInlineFormatting(text) {
  const runs = [];
  const regex = /(\*\*(.+?)\*\*|\[TODO:\s*([^\]]*)\])/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Text before the match
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index), size: 22 }));
    }

    if (match[2]) {
      // **bold** text
      runs.push(new TextRun({ text: match[2], bold: true, size: 22 }));
    } else if (match[3] !== undefined) {
      // [TODO: description] - highlighted in yellow
      runs.push(
        new TextRun({
          text: `[TODO: ${match[3]}]`,
          size: 22,
          color: "CC6600",
          bold: true,
          italics: true,
        })
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex), size: 22 }));
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text, size: 22 }));
  }

  return runs;
}

// ═══ POST: Generate .docx from filled content ═══
export async function POST(request) {
  try {
    const body = await request.json();
    const { content, formsheetId, formsheetName } = body;

    if (!content) {
      return Response.json({ error: "No content provided" }, { status: 400 });
    }

    const today = new Date().toLocaleDateString("de-DE");
    const docChildren = parseContentToDocx(content, formsheetId);

    const doc = new Document({
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
                    new TextRun({
                      text: "WAVEMEDIX Inc. | Quality Management System",
                      size: 16,
                      color: "028090",
                      font: "Calibri",
                    }),
                  ],
                }),
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({
                      text: `${formsheetId || "DRAFT"} | DRAFT | ${today}`,
                      size: 14,
                      color: "999999",
                      font: "Calibri",
                    }),
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
                    new TextRun({
                      text: `${formsheetId || "DRAFT"} — DRAFT — `,
                      size: 14,
                      color: "999999",
                    }),
                    new TextRun({
                      children: [PageNumber.CURRENT],
                      size: 14,
                      color: "999999",
                    }),
                    new TextRun({
                      text: " / ",
                      size: 14,
                      color: "999999",
                    }),
                    new TextRun({
                      children: [PageNumber.TOTAL_PAGES],
                      size: 14,
                      color: "999999",
                    }),
                  ],
                }),
              ],
            }),
          },
          children: docChildren,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `${formsheetId || "DRAFT"}_DRAFT_${new Date().toISOString().split("T")[0]}.docx`;

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": buffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("DOCX export error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
