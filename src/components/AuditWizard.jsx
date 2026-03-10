"use client";
import { useState } from "react";
import { Ic } from "./icons";
import { SOPS } from "../lib/dashboardHelpers";
import { FORMSHEET_REGISTRY } from "../lib/formsheetRegistry";
import { AREA_CONFIG } from "../lib/folderStructure";

const CATEGORIES = [
  { id: "sops", icon: "folder", color: "#028090" },
  { id: "formsheets", icon: "table", color: "#7C3AED" },
  { id: "development", icon: "zap", color: "#7C3AED" },
  { id: "operations", icon: "clock", color: "#028090" },
];

const AUDIT_TYPES = ["regulatory", "content", "both"];

export default function AuditWizard({ session, lang, t, folderIds, onClose }) {
  const [step, setStep] = useState(1);
  const [category, setCategory] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [auditType, setAuditType] = useState("both");
  const [progress, setProgress] = useState({ current: 0, total: 0, status: "" });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);

  // Get subcategory items based on selected category
  function getSubItems() {
    switch (category) {
      case "sops":
        return SOPS.map((s) => ({ id: s.id, label: `${s.id} — ${lang === "de" ? s.de : s.en}` }));
      case "formsheets": {
        // Group by SOP
        const groups = {};
        FORMSHEET_REGISTRY.forEach((f) => {
          if (!groups[f.sop]) groups[f.sop] = [];
          groups[f.sop].push(f);
        });
        const items = [];
        Object.entries(groups).forEach(([sop, forms]) => {
          forms.forEach((f) => {
            items.push({ id: f.id, label: `${f.id} — ${f.name} (.${f.type})` });
          });
        });
        return items;
      }
      case "development":
        return AREA_CONFIG.development.categories.map((c) => ({
          id: c.path, label: lang === "de" ? c.label.de : c.label.en,
        }));
      case "operations":
        return AREA_CONFIG.operations.categories.map((c) => ({
          id: c.path, label: lang === "de" ? c.label.de : c.label.en,
        }));
      default:
        return [];
    }
  }

  function toggleItem(id) {
    setSelectedItems((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  function selectAll() {
    setSelectedItems(getSubItems().map((i) => i.id));
  }

  function deselectAll() {
    setSelectedItems([]);
  }

  async function runAudit() {
    if (!session?.accessToken) return;
    setRunning(true);
    setError(null);
    setProgress({ current: 0, total: selectedItems.length, status: t.auditProgress });
    setStep(4);

    try {
      const body = {
        category,
        selectedItems,
        auditType,
        lang: "en",
      };

      // Pass folder IDs for dev/ops audits
      if (category === "development" && folderIds.development) {
        body.developmentFolderId = folderIds.development;
      }
      if (category === "operations" && folderIds.operations) {
        body.operationsFolderId = folderIds.operations;
      }

      const res = await fetch("/api/audit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-access-token": session.accessToken,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
        setRunning(false);
        return;
      }

      setResult(data);
      setStep(5);
    } catch (err) {
      setError(err.message);
    }
    setRunning(false);
  }

  function downloadReport() {
    if (!result?.file?.id || !session?.accessToken) return;
    fetch(`/api/drive/${result.file.id}?action=download`, {
      headers: { "x-access-token": session.accessToken },
    })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${result.file.name || "Audit_Report"}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => {});
  }

  const subItems = category ? getSubItems() : [];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {/* Backdrop */}
      <div onClick={!running ? onClose : undefined} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} />

      {/* Modal */}
      <div style={{ position: "relative", width: 600, maxHeight: "85vh", background: "#fff", borderRadius: 16, boxShadow: "0 25px 50px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg, #f59e0b, #d97706)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Ic name="brain" size={18} color="#fff" />
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0F2B3C" }}>{t.auditWizard}</h2>
            <p style={{ margin: 0, fontSize: 11, color: "#94a3b8" }}>
              {step <= 3 && `${t.next} ${step}/3`}
              {step === 4 && t.auditProgress}
              {step === 5 && t.auditComplete}
            </p>
          </div>
          {!running && (
            <button onClick={onClose} style={{ border: "none", background: "#f1f5f9", borderRadius: 6, padding: 6, cursor: "pointer" }}>
              <Ic name="x" size={16} color="#64748b" />
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div style={{ height: 3, background: "#e2e8f0" }}>
          <div style={{ height: 3, background: step === 5 ? "#10B981" : "#f59e0b", width: `${(step / 5) * 100}%`, transition: "width 0.5s" }} />
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>

          {/* Step 1: Category Selection */}
          {step === 1 && (
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "#0F2B3C", marginBottom: 16 }}>{t.auditCategory}</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => { setCategory(cat.id); setSelectedItems([]); setStep(2); }}
                    style={{
                      padding: "20px 16px", border: `2px solid ${category === cat.id ? cat.color : "#e2e8f0"}`,
                      borderRadius: 12, background: category === cat.id ? `${cat.color}10` : "#fff",
                      cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 12,
                      transition: "all 0.2s",
                    }}
                  >
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: `linear-gradient(135deg, ${cat.color}, ${cat.color}99)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Ic name={cat.icon} size={20} color="#fff" />
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#0F2B3C" }}>{t[`${cat.id}Label`]}</div>
                      <div style={{ fontSize: 10, color: "#94a3b8" }}>
                        {cat.id === "sops" && `${SOPS.length} SOPs`}
                        {cat.id === "formsheets" && `${FORMSHEET_REGISTRY.length} Formsheets`}
                        {cat.id === "development" && `${AREA_CONFIG.development.categories.length} ${lang === "de" ? "Kategorien" : "categories"}`}
                        {cat.id === "operations" && `${AREA_CONFIG.operations.categories.length} ${lang === "de" ? "Kategorien" : "categories"}`}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Subcategory Selection */}
          {step === 2 && (
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "#0F2B3C", marginBottom: 8 }}>{t.auditSubcategory}</h3>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button onClick={selectAll} style={{ fontSize: 11, padding: "4px 12px", border: "1px solid #e2e8f0", borderRadius: 4, background: "#f8fafc", cursor: "pointer", color: "#028090", fontWeight: 600 }}>
                  {t.selectAll}
                </button>
                <button onClick={deselectAll} style={{ fontSize: 11, padding: "4px 12px", border: "1px solid #e2e8f0", borderRadius: 4, background: "#f8fafc", cursor: "pointer", color: "#94a3b8" }}>
                  {t.deselectAll}
                </button>
                <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: "auto", paddingTop: 4 }}>
                  {selectedItems.length}/{subItems.length} {lang === "de" ? "ausgew\u00E4hlt" : "selected"}
                </span>
              </div>
              <div style={{ maxHeight: 350, overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                {subItems.map((item) => (
                  <label key={item.id} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
                    borderBottom: "1px solid #f1f5f9", cursor: "pointer", fontSize: 12,
                    background: selectedItems.includes(item.id) ? "#f0fdf4" : "transparent",
                  }}>
                    <input
                      type="checkbox"
                      checked={selectedItems.includes(item.id)}
                      onChange={() => toggleItem(item.id)}
                      style={{ accentColor: "#028090" }}
                    />
                    <span style={{ color: "#334155" }}>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Audit Type */}
          {step === 3 && (
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "#0F2B3C", marginBottom: 16 }}>{t.auditTypeLabel}</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {AUDIT_TYPES.map((type) => (
                  <button
                    key={type}
                    onClick={() => setAuditType(type)}
                    style={{
                      padding: "16px 20px", border: `2px solid ${auditType === type ? "#028090" : "#e2e8f0"}`,
                      borderRadius: 10, background: auditType === type ? "#f0fdfa" : "#fff",
                      cursor: "pointer", textAlign: "left", transition: "all 0.2s",
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: auditType === type ? "#028090" : "#334155" }}>
                      {t[type === "both" ? "bothAudit" : type === "content" ? "contentAudit" : "regulatory"]}
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                      {type === "regulatory" && (lang === "de"
                        ? "Standards, Signaturen, regulatorische Compliance"
                        : "Standards references, signatures, regulatory compliance")}
                      {type === "content" && (lang === "de"
                        ? "Inhaltliche Vollst\u00E4ndigkeit, Logik, Konsistenz"
                        : "Content completeness, logic, consistency")}
                      {type === "both" && (lang === "de"
                        ? "Vollst\u00E4ndiges Audit: Regulatorisch + Inhaltlich"
                        : "Full audit: Regulatory + Content analysis")}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 4: Running */}
          {step === 4 && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ width: 64, height: 64, margin: "0 auto 20px", borderRadius: 16, background: "linear-gradient(135deg, #f59e0b, #d97706)", display: "flex", alignItems: "center", justifyContent: "center", animation: "pulse 2s infinite" }}>
                <Ic name="brain" size={32} color="#fff" />
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0F2B3C", marginBottom: 8 }}>{t.auditProgress}</h3>
              <p style={{ fontSize: 12, color: "#94a3b8" }}>
                {lang === "de"
                  ? `Claude analysiert ${selectedItems.length} Elemente...`
                  : `Claude is analyzing ${selectedItems.length} items...`}
              </p>
              {error && (
                <div style={{ margin: "16px auto", maxWidth: 400, padding: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#dc2626", fontSize: 12 }}>
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Step 5: Results */}
          {step === 5 && result && (
            <div>
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{ width: 64, height: 64, margin: "0 auto 16px", borderRadius: 16, background: "linear-gradient(135deg, #10B981, #059669)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Ic name="check" size={32} color="#fff" />
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0F2B3C", marginBottom: 4 }}>{t.auditComplete}</h3>
                <p style={{ fontSize: 12, color: "#94a3b8" }}>{t.auditReportReady}</p>
              </div>

              {/* Stats */}
              <div style={{ display: "flex", gap: 12, marginBottom: 20, justifyContent: "center" }}>
                <div style={{ padding: "12px 20px", background: "#f0fdf4", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#059669" }}>{result.stats?.documentsAudited || 0}</div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>{t.docsAudited}</div>
                </div>
                <div style={{ padding: "12px 20px", background: "#eff6ff", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#3b82f6" }}>{result.stats?.sopsAudited || 0}</div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>{t.sopsCounted}</div>
                </div>
                <div style={{ padding: "12px 20px", background: "#faf5ff", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#7C3AED" }}>{result.stats?.formsheetsAudited || 0}</div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>{t.formsCounted}</div>
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => window.open(result.file?.webViewLink, "_blank")}
                  style={{ flex: 1, padding: "12px 16px", background: "linear-gradient(135deg, #028090, #0F2B3C)", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                >
                  <Ic name="open" size={16} color="#fff" />
                  {t.openReport}
                </button>
                <button
                  onClick={downloadReport}
                  style={{ flex: 1, padding: "12px 16px", background: "#fff", color: "#028090", border: "2px solid #028090", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                >
                  <Ic name="save" size={16} color="#028090" />
                  {t.downloadXlsx}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer with navigation */}
        {step >= 1 && step <= 3 && (
          <div style={{ padding: "12px 24px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 8, justifyContent: "space-between" }}>
            <button
              onClick={() => { if (step > 1) setStep(step - 1); else onClose(); }}
              style={{ padding: "8px 20px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#64748b" }}
            >
              {step === 1 ? (lang === "de" ? "Abbrechen" : "Cancel") : t.back}
            </button>
            {step < 3 && (
              <button
                onClick={() => setStep(step + 1)}
                disabled={step === 1 && !category || step === 2 && selectedItems.length === 0}
                style={{
                  padding: "8px 20px", border: "none", borderRadius: 6, background: "#028090", color: "#fff",
                  cursor: (step === 1 && !category) || (step === 2 && selectedItems.length === 0) ? "not-allowed" : "pointer",
                  fontSize: 12, fontWeight: 600, opacity: (step === 1 && !category) || (step === 2 && selectedItems.length === 0) ? 0.5 : 1,
                }}
              >
                {t.next}
              </button>
            )}
            {step === 3 && (
              <button
                onClick={runAudit}
                style={{ padding: "8px 24px", border: "none", borderRadius: 6, background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}
              >
                <Ic name="brain" size={14} color="#fff" />
                {t.startAudit}
              </button>
            )}
          </div>
        )}

        {/* Footer for results */}
        {step === 5 && (
          <div style={{ padding: "12px 24px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ padding: "8px 20px", border: "none", borderRadius: 6, background: "#028090", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
              {lang === "de" ? "Schlie\u00DFen" : "Close"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
