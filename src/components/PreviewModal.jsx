"use client";
import { Ic } from "./icons";
import { cleanFormName, extractVersion, getPreviewUrl } from "../lib/dashboardHelpers";

export default function PreviewModal({ file, lang, onClose, onOpenInDrive }) {
  if (!file) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 12, width: "90%", maxWidth: 1100, height: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "12px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <Ic name="preview" size={18} color="#028090" />
          <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{cleanFormName(file.name)}</span>
          {extractVersion(file.name) && <span style={{ fontSize: 11, background: "#ecfdf5", padding: "2px 8px", borderRadius: 4, color: "#059669", fontWeight: 600 }}>V{extractVersion(file.name)}</span>}
          <span style={{ fontSize: 11, color: "#94a3b8" }}>{lang === "de" ? "Vorschau" : "Preview"} (Read-Only)</span>
          <button onClick={() => onOpenInDrive(file)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 6, padding: "5px 12px", fontSize: 11, cursor: "pointer", color: "#028090", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
            <Ic name="open" size={12} color="#028090" /> {lang === "de" ? "In Drive \u00F6ffnen" : "Open in Drive"}
          </button>
          <button onClick={onClose} style={{ border: "none", background: "#f1f5f9", borderRadius: 6, padding: "5px 8px", cursor: "pointer" }}>
            <Ic name="x" size={16} color="#64748b" />
          </button>
        </div>
        <iframe
          src={getPreviewUrl(file)}
          style={{ flex: 1, border: "none", width: "100%" }}
          title="Document Preview"
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
      </div>
    </div>
  );
}
