"use client";
import { useState, useRef, useEffect } from "react";
import { Ic } from "./icons";
import { AREA_CONFIG } from "../lib/folderStructure";
import SubmitForApprovalModal from "./SubmitForApprovalModal";
import { TX } from "../lib/dashboardHelpers";

export default function ChatSidebar({
  session, lang, files, chatOpen, setChatOpen,
  sopRulesLoaded, sopRulesLoading, setSopRulesLoaded, setSopRulesLoading,
  targetFolderId,
  activeArea,
  folderIds,
  onFilesChanged,
  auditTrigger,      // kept for backward compat (unused with wizard)
  onAuditHandled,    // kept for backward compat (unused with wizard)
}) {
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [fsCard, setFsCard] = useState(null);
  const [fsFilling, setFsFilling] = useState(false);
  const [fsPreview, setFsPreview] = useState(null);
  const [fsSaving, setFsSaving] = useState(false);
  const [fsDownloading, setFsDownloading] = useState(false);

  // Smart clarification state
  const [fsQuestions, setFsQuestions] = useState(null);
  const [fsAnswers, setFsAnswers] = useState({});

  // Folder picker state
  const [selectedArea, setSelectedArea] = useState(null);
  const [selectedSubfolder, setSelectedSubfolder] = useState(null);

  // Approval modal state
  const [approvalModal, setApprovalModal] = useState(null);

  // Audit trigger guard — prevents double-fire
  const auditTriggeredRef = useRef(false);

  function getFolderOptions() {
    const options = [{ area: "qmh", subfolderPath: "", label: "QM-Handbuch" }];
    if (AREA_CONFIG.development) {
      for (const cat of AREA_CONFIG.development.categories) {
        options.push({ area: "development", subfolderPath: cat.path, label: `Development \u2192 ${cat.path}` });
        if (cat.subModules) {
          for (const sub of cat.subModules) {
            options.push({ area: "development", subfolderPath: `${cat.path}/${sub.path}`, label: `Dev \u2192 ${cat.path}/${sub.path}` });
          }
        }
      }
    }
    if (AREA_CONFIG.operations) {
      for (const cat of AREA_CONFIG.operations.categories) {
        options.push({ area: "operations", subfolderPath: cat.path, label: `Operations \u2192 ${cat.path}` });
        if (cat.subModules) {
          for (const sub of cat.subModules) {
            options.push({ area: "operations", subfolderPath: `${cat.path}/${sub.path}`, label: `Ops \u2192 ${cat.path}/${sub.path}` });
          }
        }
      }
    }
    return options;
  }

  // Detect audit requests like "audit WM-SOP-001", "mach ein audit vom WM-SOP-003"
  function detectAuditRequest(text) {
    const lower = text.toLowerCase();
    const auditKeywords = [
      "audit", "auditiere", "auditieren", "auditierung",
      "prüfe", "prüfen", "überprüfe", "überprüfen",
      "check", "review", "mach.*audit", "starte.*audit",
    ];
    const hasAuditKeyword = auditKeywords.some((kw) => lower.match(new RegExp(kw)));
    if (!hasAuditKeyword) return null;
    // Extract SOP IDs from the text (WM-SOP-003, WM-QMS-001, etc.)
    const sopMatches = text.match(/WM[- ]?(?:QMS|SOP)[- ]?\d{3}/gi);
    if (sopMatches && sopMatches.length > 0) {
      // Normalize: ensure format is WM-SOP-001 (with dashes)
      return sopMatches.map((s) => s.toUpperCase().replace(/\s+/g, "-").replace(/([A-Z])(\d)/g, "$1-$2")).join(",");
    }
    return null;
  }

  function sendChat() {
    if (!chatInput.trim()) return;
    const userMsg = { role: "user", content: chatInput };
    const newMsgs = [...chatMsgs, userMsg];
    setChatMsgs(newMsgs);
    const userText = chatInput;
    setChatInput("");
    setChatLoading(true);
    setFsCard(null);

    // Check for individual audit request first
    const auditScope = detectAuditRequest(userText);
    if (auditScope) {
      const loadingMsg = lang === "de"
        ? `\u23F3 Auditiere ${auditScope}... Dies kann etwas dauern.`
        : `\u23F3 Auditing ${auditScope}... This may take a moment.`;
      setChatMsgs([...newMsgs, { role: "assistant", content: loadingMsg }]);
      startAudit(auditScope);
      return;
    }

    fetch("/formsheet", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-access-token": session?.accessToken || "" },
      body: JSON.stringify({ action: "detect", message: userText, lang, activeArea }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.isFormsheet && d.formsheetId) {
          const card = {
            formsheetId: d.formsheetId, formsheetName: d.formsheetName, summary: d.summary, userMessage: userText,
            area: d.area || activeArea || "qmh",
            subfolderPath: d.subfolderPath || null,
          };
          setFsCard(card);
          const areaLabel = card.area === "development" ? "Development" : card.area === "operations" ? "Operations" : "QMH";
          const folderInfo = card.subfolderPath ? `\n\uD83D\uDCC1 ${areaLabel} \u2192 ${card.subfolderPath}` : "";
          const assistantMsg = lang === "de"
            ? `\u2705 Formblatt erkannt: **${d.formsheetName}** (${d.formsheetId})\n${d.summary || ""}${folderInfo}\n\nKlicke auf "Ausf\u00FCllen" um das Formblatt zu erstellen.`
            : `\u2705 Formsheet detected: **${d.formsheetName}** (${d.formsheetId})\n${d.summary || ""}${folderInfo}\n\nClick "Fill" to create the document.`;
          setChatMsgs([...newMsgs, { role: "assistant", content: assistantMsg, fsCard: card }]);
          setChatLoading(false);
        } else {
          regularChat(newMsgs);
        }
      })
      .catch(() => regularChat(newMsgs));
  }

  function regularChat(msgs) {
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-access-token": session?.accessToken || "" },
      body: JSON.stringify({ messages: msgs, lang }),
    })
      .then((r) => r.json())
      .then((d) => {
        const txt = d.content ? d.content.map((c) => c.text || "").join("") : d.error || "Error";
        setChatMsgs([...msgs, { role: "assistant", content: txt }]);
        setChatLoading(false);
      })
      .catch((e) => {
        setChatMsgs([...msgs, { role: "assistant", content: "Error: " + e.message }]);
        setChatLoading(false);
      });
  }

  // Smart fill: first clarify, then fill
  function fillFormsheet(card) {
    setFsFilling(true);
    setFsPreview(null);
    setFsQuestions(null);
    setFsAnswers({});

    const clarifyMsg = lang === "de" ? "Analysiere Anfrage..." : "Analyzing request...";
    setChatMsgs((prev) => [...prev, { role: "assistant", content: "\u23F3 " + clarifyMsg }]);

    fetch("/formsheet", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-access-token": session?.accessToken || "" },
      body: JSON.stringify({ action: "clarify", formsheetId: card.formsheetId, userRequest: card.userMessage, lang, driveFiles: files }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.needsClarification && d.questions?.length > 0) {
          const questionText = d.questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
          const askMsg = lang === "de"
            ? `\uD83D\uDCA1 Bevor ich das Formblatt ausf\u00FClle, habe ich ein paar Fragen:\n\n${questionText}`
            : `\uD83D\uDCA1 Before I fill the formsheet, I have a few questions:\n\n${questionText}`;
          setChatMsgs((prev) => [...prev, { role: "assistant", content: askMsg }]);
          setFsQuestions({ questions: d.questions, card });
          const answers = {};
          d.questions.forEach((_, i) => { answers[i] = ""; });
          setFsAnswers(answers);
          setFsFilling(false);
        } else {
          doFill(card, null);
        }
      })
      .catch(() => doFill(card, null));
  }

  function submitClarifications() {
    if (!fsQuestions) return;
    setFsFilling(true);
    const clarText = fsQuestions.questions.map((q, i) => `${q}: ${fsAnswers[i] || "[nicht beantwortet]"}`).join("\n");
    const answerMsg = Object.values(fsAnswers).filter(Boolean).join(", ");
    setChatMsgs((prev) => [...prev, { role: "user", content: answerMsg || "(Antworten eingereicht)" }]);
    const card = fsQuestions.card;
    setFsQuestions(null);
    setFsAnswers({});
    doFill(card, clarText);
  }

  function doFill(card, clarifications) {
    if (!fsFilling) setFsFilling(true);
    const fillingMsg = lang === "de" ? "Lese Template und f\u00FClle Formblatt aus..." : "Reading template and filling formsheet...";
    setChatMsgs((prev) => [...prev, { role: "assistant", content: "\u23F3 " + fillingMsg }]);

    const payload = { action: "fill", formsheetId: card.formsheetId, userRequest: card.userMessage, lang, driveFiles: files };
    if (clarifications) payload.clarifications = clarifications;

    fetch("/formsheet", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-access-token": session?.accessToken || "" },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setChatMsgs((prev) => [...prev, { role: "assistant", content: "\u274C Fehler: " + d.error }]);
        } else if (d.mode === "spreadsheet" && (d.rows?.length > 0 || d.cellReplacements)) {
          const rowCount = d.rows?.length || 0;
          const cellCount = d.cellReplacements ? Object.keys(d.cellReplacements).length : 0;
          const areaLabel = card.area === "development" ? "Development" : card.area === "operations" ? "Operations" : "QMH";
          const folderHint = card.subfolderPath ? ` \u2192 ${areaLabel}/${card.subfolderPath}` : "";
          const infoMsg = lang === "de"
            ? `\u2705 Spreadsheet: ${rowCount} Zeilen${cellCount > 0 ? `, ${cellCount} Zellen` : ""}. Design erhalten.${folderHint ? `\nSpeicherort: ${folderHint}` : ""}`
            : `\u2705 Spreadsheet: ${rowCount} rows${cellCount > 0 ? `, ${cellCount} cells` : ""}. Design preserved.${folderHint ? `\nSave location: ${folderHint}` : ""}`;
          setChatMsgs((prev) => [...prev, { role: "assistant", content: infoMsg }]);
          setFsPreview({ content: d.previewText || `${rowCount} rows`, formsheetId: card.formsheetId, formsheetName: card.formsheetName, mode: "spreadsheet", rows: d.rows, headers: d.headers, cellReplacements: d.cellReplacements, templateFileId: d.templateFileId, existingRowCount: d.existingRowCount, area: card.area, subfolderPath: card.subfolderPath });
          setSelectedArea(card.area || "qmh");
          setSelectedSubfolder(card.subfolderPath || "");
        } else if (d.mode === "copy-and-replace" && d.replacements) {
          const previewText = Object.entries(d.replacements).map(([k, v]) => `${k} \u2192 ${v}`).join("\n");
          const areaLabel = card.area === "development" ? "Development" : card.area === "operations" ? "Operations" : "QMH";
          const folderHint = card.subfolderPath ? ` \u2192 ${areaLabel}/${card.subfolderPath}` : "";
          const infoMsg = lang === "de"
            ? `\u2705 ${Object.keys(d.replacements).length} Platzhalter. Design 1:1 erhalten.${folderHint ? `\nSpeicherort: ${folderHint}` : ""}`
            : `\u2705 ${Object.keys(d.replacements).length} placeholders. Design preserved.${folderHint ? `\nSave location: ${folderHint}` : ""}`;
          setChatMsgs((prev) => [...prev, { role: "assistant", content: infoMsg }]);
          setFsPreview({ content: previewText, formsheetId: card.formsheetId, formsheetName: card.formsheetName, replacements: d.replacements, templateFileId: d.templateFileId, mode: "copy-and-replace", area: card.area, subfolderPath: card.subfolderPath });
          setSelectedArea(card.area || "qmh");
          setSelectedSubfolder(card.subfolderPath || "");
        } else {
          setChatMsgs((prev) => [...prev, { role: "assistant", content: lang === "de" ? "\u26A0\uFE0F Draft als Text (ohne Template-Design)." : "\u26A0\uFE0F Draft as plain text." }]);
          setFsPreview({ content: d.filledContent, formsheetId: card.formsheetId, formsheetName: card.formsheetName, mode: "text", area: card.area, subfolderPath: card.subfolderPath });
          setSelectedArea(card.area || "qmh");
          setSelectedSubfolder(card.subfolderPath || "");
        }
        setFsFilling(false);
      })
      .catch((e) => {
        const errMsg = e.message || String(e);
        const hint = errMsg.includes("401") ? (lang === "de" ? "\n\uD83D\uDCA1 Bitte erneut anmelden." : "\n\uD83D\uDCA1 Please sign in again.") : "";
        setChatMsgs((prev) => [...prev, { role: "assistant", content: "\u274C Error: " + errMsg + hint }]);
        setFsFilling(false);
      });
  }

  function resolveTargetFolder(area) {
    const a = area || selectedArea;
    if (a === "development" && folderIds?.development) return folderIds.development;
    if (a === "operations" && folderIds?.operations) return folderIds.operations;
    return targetFolderId || null;
  }

  function buildSavePayload() {
    const saveArea = selectedArea || fsPreview?.area;
    const saveSubfolder = selectedSubfolder || fsPreview?.subfolderPath;
    const resolvedTarget = resolveTargetFolder(saveArea);
    const p = { action: "save", formsheetId: fsPreview.formsheetId, formsheetName: fsPreview.formsheetName };
    if (resolvedTarget) p.targetFolderId = resolvedTarget;
    if (saveSubfolder) p.subfolderPath = saveSubfolder;
    if (fsPreview.mode === "spreadsheet") {
      p.mode = "spreadsheet"; p.rows = fsPreview.rows; p.headers = fsPreview.headers;
      p.cellReplacements = fsPreview.cellReplacements; p.templateFileId = fsPreview.templateFileId;
      p.existingRowCount = fsPreview.existingRowCount;
    } else if (fsPreview.mode === "copy-and-replace" && fsPreview.replacements) {
      p.replacements = fsPreview.replacements; p.templateFileId = fsPreview.templateFileId;
    } else {
      p.filledContent = fsPreview.content;
    }
    return { payload: p, saveArea };
  }

  function saveFormsheet() {
    if (!fsPreview) return;
    setFsSaving(true);
    const { payload, saveArea } = buildSavePayload();

    fetch("/formsheet", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-access-token": session?.accessToken || "" },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setChatMsgs((prev) => [...prev, { role: "assistant", content: "\u274C Fehler: " + d.error }]);
        } else {
          const fileName = d.file?.name || fsPreview.formsheetId;
          const replInfo = d.replacementCount ? ` (${d.replacementCount} ${lang === "de" ? "Felder" : "fields"})` : "";
          const rowInfo = d.rowsAdded ? ` + ${d.rowsAdded} ${lang === "de" ? "Zeilen" : "rows"}` : "";
          const folderInfo = d.folder || "Drafts";
          const areaLabel = saveArea === "development" ? "Development" : saveArea === "operations" ? "Operations" : "QMH";
          const msg = lang === "de"
            ? `\u2705 Gespeichert: ${fileName}${replInfo}${rowInfo}\nOrdner: ${areaLabel} \u2192 ${folderInfo}`
            : `\u2705 Saved: ${fileName}${replInfo}${rowInfo}\nFolder: ${areaLabel} \u2192 ${folderInfo}`;
          setChatMsgs((prev) => [...prev, { role: "assistant", content: msg, fsSaved: { fileId: d.file?.id, webViewLink: d.file?.webViewLink } }]);
          setFsPreview(null);
          if (onFilesChanged) onFilesChanged();
        }
        setFsSaving(false);
      })
      .catch((e) => {
        setChatMsgs((prev) => [...prev, { role: "assistant", content: "\u274C Error: " + e.message }]);
        setFsSaving(false);
      });
  }

  function downloadDocx() {
    if (!fsPreview) return;
    setFsDownloading(true);
    const { payload } = buildSavePayload();
    const fileExt = fsPreview.mode === "spreadsheet" ? "xlsx" : "docx";

    fetch("/formsheet", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-access-token": session?.accessToken || "" },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        if (!d.file?.id) throw new Error("No file ID");
        return fetch(`/api/drive/${d.file.id}?action=download`, { headers: { "x-access-token": session?.accessToken || "" } });
      })
      .then((res) => { if (!res.ok) throw new Error("Download failed"); return res.blob(); })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${fsPreview.formsheetId}_DRAFT_${new Date().toISOString().split("T")[0]}.${fileExt}`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setFsDownloading(false); setFsPreview(null);
        setChatMsgs((prev) => [...prev, { role: "assistant", content: lang === "de" ? "\u2705 Draft gespeichert & heruntergeladen." : "\u2705 Draft saved & downloaded." }]);
      })
      .catch((e) => {
        setChatMsgs((prev) => [...prev, { role: "assistant", content: "\u274C Download Error: " + e.message }]);
        setFsDownloading(false);
      });
  }

  // Handle audit trigger from Brain button — useEffect to prevent double-fire
  useEffect(() => {
    if (auditTrigger && chatOpen && !auditTriggeredRef.current) {
      auditTriggeredRef.current = true;
      const auditMsg = lang === "de"
        ? "\uD83E\uDDE0 Deep Regulatory Audit starten?\n\n\u2022 Alle SOPs & Formbl\u00E4tter im QMH pr\u00FCfen\n\u2022 Normen-Referenzen, Unterschriften, Vollst\u00E4ndigkeit\n\u2022 Inhaltliche Logik & Verbesserungsvorschl\u00E4ge\n\u2022 Bericht als Google Sheets (English)"
        : "\uD83E\uDDE0 Start Deep Regulatory Audit?\n\n\u2022 Audit all SOPs & Formsheets in QMH\n\u2022 Standards references, signatures, completeness\n\u2022 Content logic & improvement suggestions\n\u2022 Report saved as Google Sheets (English)";
      setChatMsgs((prev) => [...prev, { role: "assistant", content: auditMsg, isAuditPrompt: true }]);
      if (onAuditHandled) onAuditHandled();
    }
    if (!auditTrigger) {
      auditTriggeredRef.current = false;
    }
  }, [auditTrigger, chatOpen, lang, onAuditHandled]);

  function downloadAuditReport(fileId) {
    fetch(`/api/drive/${fileId}?action=download`, {
      headers: { "x-access-token": session?.accessToken || "" },
    })
      .then((res) => { if (!res.ok) throw new Error("Download failed"); return res.blob(); })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `QMS_Audit_Report_${new Date().toISOString().split("T")[0]}.xlsx`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch((e) => {
        setChatMsgs((prev) => [...prev, { role: "assistant", content: "\u274C Download Error: " + e.message }]);
      });
  }

  function startAudit(scope) {
    setChatLoading(true);
    const isFullAudit = !scope;

    if (isFullAudit) {
      setChatMsgs((prev) => [
        ...prev,
        { role: "user", content: lang === "de" ? "Ja, Audit starten" : "Yes, start audit" },
        { role: "assistant", content: lang === "de"
          ? "\u23F3 Deep Audit l\u00E4uft... Alle QMH-Dokumente werden gepr\u00FCft. Dies kann 2\u20133 Minuten dauern."
          : "\u23F3 Deep audit in progress... Checking all QMH documents. This may take 2\u20133 minutes." },
      ]);
    }

    fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-access-token": session?.accessToken || "" },
      body: JSON.stringify({ lang: "en", ...(scope ? { scope } : {}) }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setChatMsgs((prev) => [...prev, { role: "assistant", content: "\u274C " + d.error }]);
        } else {
          const msg = lang === "de"
            ? `\u2705 Audit abgeschlossen: ${d.stats.documentsAudited} Dokumente gepr\u00FCft (${d.stats.sopsAudited} SOPs, ${d.stats.formsheetsAudited} Formbl\u00E4tter).\nBericht als Google Sheet gespeichert.`
            : `\u2705 Audit complete: ${d.stats.documentsAudited} documents audited (${d.stats.sopsAudited} SOPs, ${d.stats.formsheetsAudited} formsheets).\nReport saved as Google Sheet.`;
          setChatMsgs((prev) => [...prev, {
            role: "assistant",
            content: msg,
            isAuditResult: true,
            auditFile: d.file,
          }]);
        }
        setChatLoading(false);
      })
      .catch((e) => {
        setChatMsgs((prev) => [...prev, { role: "assistant", content: "\u274C Audit Error: " + e.message }]);
        setChatLoading(false);
      });
  }

  if (!chatOpen) return null;

  const folderOptions = getFolderOptions();

  return (
    <div style={{ width: 360, borderLeft: "1px solid #e2e8f0", display: "flex", flexDirection: "column", background: "#fff", flexShrink: 0 }}>
      {/* Header */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 8 }}>
        <Ic name="bot" size={16} color="#028090" />
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Claude AI Assistant</span>
        <button onClick={() => setChatOpen(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><Ic name="x" size={14} color="#94a3b8" /></button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        {chatMsgs.length === 0 && (
          <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 12, padding: 20 }}>
            <Ic name="bot" size={32} color="#e2e8f0" />
            <p style={{ marginTop: 8 }}>{lang === "de" ? "Fragen zum QMS stellen oder Formbl\u00E4tter ausf\u00FCllen" : "Ask about QMS or fill formsheets"}</p>
            <div style={{ marginTop: 12, textAlign: "left", background: "#f8fafc", borderRadius: 8, padding: 10 }}>
              <p style={{ fontSize: 10, color: "#64748b", fontWeight: 600, marginBottom: 6 }}>{lang === "de" ? "Beispiele:" : "Examples:"}</p>
              {[
                lang === "de" ? "Erstelle einen Validation Plan f\u00FCr Google Vault" : "Create a Validation Plan for Google Vault",
                lang === "de" ? "F\u00FClle eine CAPA Form aus" : "Fill a CAPA Form",
                lang === "de" ? "Auditiere WM-SOP-001" : "Audit WM-SOP-001",
              ].map((ex, i) => (
                <button key={i} onClick={() => setChatInput(ex)} style={{ display: "block", width: "100%", textAlign: "left", padding: "4px 8px", fontSize: 10, color: "#028090", background: "none", border: "none", cursor: "pointer", borderRadius: 4, marginBottom: 2 }}>
                  {"\u2192"} {ex}
                </button>
              ))}
            </div>
            {!sopRulesLoaded && (
              <div style={{ marginTop: 10, background: "#fef3c7", borderRadius: 8, padding: 10 }}>
                <p style={{ fontSize: 10, color: "#92400e", fontWeight: 600, marginBottom: 6 }}>{lang === "de" ? "SOP-Regeln noch nicht geladen" : "SOP rules not loaded yet"}</p>
                <button
                  onClick={() => {
                    setSopRulesLoading(true);
                    fetch("/api/sop-rules", { method: "POST", headers: { "x-access-token": session?.accessToken || "" } })
                      .then((r) => r.json())
                      .then((d) => { setSopRulesLoaded(d.count > 0); setSopRulesLoading(false); })
                      .catch(() => setSopRulesLoading(false));
                  }}
                  disabled={sopRulesLoading}
                  style={{ width: "100%", padding: "6px 10px", background: sopRulesLoading ? "#94a3b8" : "#028090", color: "#fff", border: "none", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: sopRulesLoading ? "not-allowed" : "pointer" }}
                >
                  {sopRulesLoading ? (lang === "de" ? "Extrahiere SOPs..." : "Extracting SOPs...") : (lang === "de" ? "SOP-Regeln jetzt laden" : "Load SOP rules now")}
                </button>
              </div>
            )}
          </div>
        )}
        {chatMsgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
            <div style={{ padding: "8px 12px", borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px", background: m.role === "user" ? "#028090" : "#f1f5f9", color: m.role === "user" ? "#fff" : "#1e293b", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {m.content}
            </div>
            {m.fsCard && (
              <div style={{ marginTop: 6, background: "#fff", border: "2px solid #028090", borderRadius: 10, padding: 12, boxShadow: "0 2px 8px rgba(2,128,144,0.1)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #028090, #10B981)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Ic name="clipDoc" size={16} color="#fff" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#0F2B3C" }}>{m.fsCard.formsheetName}</div>
                    <div style={{ fontSize: 10, color: "#64748b" }}>{m.fsCard.formsheetId}</div>
                  </div>
                </div>
                {m.fsCard.summary && <p style={{ fontSize: 10, color: "#64748b", marginBottom: 8, lineHeight: 1.4 }}>{m.fsCard.summary}</p>}
                <button onClick={() => fillFormsheet(m.fsCard)} disabled={fsFilling}
                  style={{ width: "100%", padding: "8px 12px", background: fsFilling ? "#94a3b8" : "linear-gradient(135deg, #028090, #0F2B3C)", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: fsFilling ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  {fsFilling ? <><Ic name="loader" size={14} color="#fff" /> {lang === "de" ? "Analysiert..." : "Analyzing..."}</> : <><Ic name="clipDoc" size={14} color="#fff" /> {lang === "de" ? "Ausf\u00FCllen" : "Fill"}</>}
                </button>
              </div>
            )}
            {m.isAuditPrompt && (
              <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                <button onClick={() => startAudit()} style={{ flex: 1, padding: "8px", background: "linear-gradient(135deg, #028090, #0F2B3C)", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  {lang === "de" ? "Ja, Audit starten" : "Yes, start audit"}
                </button>
                <button onClick={() => setChatMsgs((prev) => [...prev, { role: "assistant", content: "OK." }])} style={{ padding: "8px 12px", background: "#f1f5f9", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>
                  {lang === "de" ? "Nein" : "No"}
                </button>
              </div>
            )}
            {m.fsSaved && (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                <button onClick={() => window.open(m.fsSaved.webViewLink, "_blank")} style={{ width: "100%", padding: "8px 12px", background: "#ecfdf5", color: "#059669", border: "1px solid #bbf7d0", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Ic name="open" size={12} color="#059669" /> {lang === "de" ? "In Google Drive \u00F6ffnen" : "Open in Google Drive"}
                </button>
                <button onClick={() => setApprovalModal({ fileId: m.fsSaved.id, fileName: m.fsSaved.name, formsheetId: m.fsFormsheetId || "" })} style={{ width: "100%", padding: "8px 12px", background: "#F0FDFA", color: "#028090", border: "1px solid #99F6E4", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Ic name="signature" size={12} color="#028090" /> {lang === "de" ? "Zur Genehmigung einreichen" : "Submit for Approval"}
                </button>
              </div>
            )}
            {m.auditFile && (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                <button onClick={() => window.open(m.auditFile.webViewLink, "_blank")}
                  style={{ width: "100%", padding: "8px 12px", background: "#ecfdf5", color: "#059669", border: "1px solid #bbf7d0", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Ic name="table" size={12} color="#059669" /> {lang === "de" ? "Audit-Bericht in Sheets \u00F6ffnen" : "Open Audit Report in Sheets"}
                </button>
                <button onClick={() => downloadAuditReport(m.auditFile.id)}
                  style={{ width: "100%", padding: "8px 12px", background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Ic name="file" size={12} color="#2563eb" /> Download .xlsx
                </button>
              </div>
            )}
          </div>
        ))}
        {chatLoading && <div style={{ padding: 8, fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6 }}><Ic name="loader" size={14} color="#94a3b8" /> {lang === "de" ? "Denke nach..." : "Thinking..."}</div>}
      </div>

      {/* Smart Clarification Questions */}
      {fsQuestions && (
        <div style={{ borderTop: "2px solid #f59e0b", background: "#fffbeb", padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#92400e", marginBottom: 8 }}>{lang === "de" ? "Bitte beantworte die Fragen:" : "Please answer:"}</div>
          {fsQuestions.questions.map((q, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <label style={{ display: "block", fontSize: 10, color: "#78716c", marginBottom: 2, fontWeight: 600 }}>{i + 1}. {q}</label>
              <input value={fsAnswers[i] || ""} onChange={(e) => setFsAnswers((prev) => ({ ...prev, [i]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter" && i === fsQuestions.questions.length - 1) submitClarifications(); }}
                style={{ width: "100%", padding: "5px 8px", border: "1px solid #fcd34d", borderRadius: 4, fontSize: 11, background: "#fff" }}
                placeholder={lang === "de" ? "Antwort..." : "Answer..."} />
            </div>
          ))}
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={submitClarifications} disabled={fsFilling} style={{ flex: 1, padding: "7px", background: fsFilling ? "#94a3b8" : "#f59e0b", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: fsFilling ? "not-allowed" : "pointer" }}>
              {fsFilling ? (lang === "de" ? "F\u00FCllt aus..." : "Filling...") : (lang === "de" ? "Absenden & Ausf\u00FCllen" : "Submit & Fill")}
            </button>
            <button onClick={() => { const card = fsQuestions.card; setFsQuestions(null); doFill(card, null); }} style={{ padding: "7px 12px", background: "#fff", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>
              {lang === "de" ? "\u00DCberspringen" : "Skip"}
            </button>
          </div>
        </div>
      )}

      {/* Preview + Folder Picker */}
      {fsPreview && (
        <div style={{ borderTop: "2px solid #028090", background: "#f8fafc", maxHeight: "45%", overflow: "auto" }}>
          <div style={{ padding: "8px 16px", background: "#028090", color: "#fff", display: "flex", alignItems: "center", gap: 8 }}>
            <Ic name="clipDoc" size={14} color="#fff" />
            <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>Draft: {fsPreview.formsheetName}</span>
            <button onClick={() => setFsPreview(null)} style={{ border: "none", background: "rgba(255,255,255,0.2)", borderRadius: 4, padding: "2px 6px", cursor: "pointer" }}><Ic name="x" size={12} color="#fff" /></button>
          </div>
          <div style={{ padding: 12, fontSize: 11, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "#334155", fontFamily: "monospace", maxHeight: 150, overflow: "auto" }}>
            {fsPreview.content}
          </div>
          {/* Folder Picker */}
          <div style={{ padding: "6px 12px", borderTop: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 6 }}>
            <Ic name="folder" size={12} color="#64748b" />
            <select value={`${selectedArea || "qmh"}|${selectedSubfolder || ""}`}
              onChange={(e) => { const [a, ...s] = e.target.value.split("|"); setSelectedArea(a); setSelectedSubfolder(s.join("|") || ""); }}
              style={{ flex: 1, padding: "4px 6px", border: "1px solid #e2e8f0", borderRadius: 4, fontSize: 10, color: "#334155", background: "#fff" }}>
              {folderOptions.map((opt, idx) => (
                <option key={idx} value={`${opt.area}|${opt.subfolderPath}`}>{opt.label}</option>
              ))}
            </select>
          </div>
          {/* Action Buttons */}
          <div style={{ padding: "8px 12px", display: "flex", gap: 6, borderTop: "1px solid #e2e8f0", flexWrap: "wrap" }}>
            <button onClick={saveFormsheet} disabled={fsSaving} style={{ flex: 1, padding: "8px", background: fsSaving ? "#94a3b8" : "#10B981", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: fsSaving ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
              {fsSaving ? <><Ic name="loader" size={12} color="#fff" /> {lang === "de" ? "Speichert..." : "Saving..."}</> : <><Ic name="save" size={12} color="#fff" /> {lang === "de" ? "In Drive speichern" : "Save to Drive"}</>}
            </button>
            <button onClick={downloadDocx} disabled={fsDownloading} style={{ flex: 1, padding: "8px", background: fsDownloading ? "#94a3b8" : "#3b82f6", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: fsDownloading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
              {fsDownloading ? <><Ic name="loader" size={12} color="#fff" /> ...</> : <><Ic name="file" size={12} color="#fff" /> {fsPreview?.mode === "spreadsheet" ? ".xlsx" : ".docx"}</>}
            </button>
            <button onClick={() => setFsPreview(null)} style={{ padding: "8px 12px", background: "#fff", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>
              {lang === "de" ? "Abbrechen" : "Cancel"}
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: "10px 16px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 6 }}>
        <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
          placeholder={lang === "de" ? "Frage zum QMS oder Formblatt ausf\u00FCllen..." : "Ask about QMS or fill a formsheet..."}
          style={{ flex: 1, padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, outline: "none" }} />
        <button onClick={sendChat} disabled={!chatInput.trim()} style={{ background: chatInput.trim() ? "#028090" : "#e2e8f0", border: "none", borderRadius: 8, padding: "8px 12px", cursor: chatInput.trim() ? "pointer" : "not-allowed" }}>
          <Ic name="send" size={14} color={chatInput.trim() ? "#fff" : "#94a3b8"} />
        </button>
      </div>

      {/* Approval Modal */}
      {approvalModal && (
        <SubmitForApprovalModal
          session={session}
          lang={lang}
          t={TX[lang] || TX.en}
          fileId={approvalModal.fileId}
          fileName={approvalModal.fileName}
          formsheetId={approvalModal.formsheetId}
          onClose={() => setApprovalModal(null)}
          onSubmitted={() => { setApprovalModal(null); }}
        />
      )}
    </div>
  );
}
