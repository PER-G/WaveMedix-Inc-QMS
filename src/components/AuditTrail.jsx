"use client";
import { Ic } from "./icons";
import { extractVersion, fileExt, cleanFormName, fmtDate } from "../lib/dashboardHelpers";

export default function AuditTrail({ files, lang, t, onPreview, onOpenInDrive }) {
  const currentFiles = files.filter(f => !f.isOld);
  const totalFileCount = currentFiles.length;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <Ic name="clock" size={20} color="#028090" />
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>{t.audit}</h2>
        <span style={{ fontSize: 12, color: "#64748b", background: "#f1f5f9", padding: "2px 8px", borderRadius: 4 }}>{totalFileCount} files</span>
      </div>
      <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 600, color: "#64748b" }}>Typ</th>
              <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 600, color: "#64748b" }}>Name</th>
              <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 600, color: "#64748b" }}>{t.version}</th>
              <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 600, color: "#64748b" }}>{lang === "de" ? "Ge\u00E4ndert von" : "Modified by"}</th>
              <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 600, color: "#64748b" }}>{lang === "de" ? "Datum" : "Date"}</th>
              <th style={{ textAlign: "right", padding: "10px 14px" }}></th>
            </tr>
          </thead>
          <tbody>
            {currentFiles.sort((a, b) => (b.modifiedTime || "").localeCompare(a.modifiedTime || "")).map((f, i) => {
              const ext = fileExt(f.name);
              const ver = extractVersion(f.name);
              return (
                <tr key={f.id || i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "8px 14px" }}>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: ext === "xlsx" ? "#ecfdf5" : "#eff6ff", color: ext === "xlsx" ? "#059669" : "#3b82f6" }}>.{ext}</span>
                  </td>
                  <td style={{ padding: "8px 14px", fontWeight: 500 }}>{cleanFormName(f.name)}</td>
                  <td style={{ padding: "8px 14px", color: "#64748b" }}>{ver || "\u2013"}</td>
                  <td style={{ padding: "8px 14px", color: "#64748b" }}>{f.lastModifiedBy}</td>
                  <td style={{ padding: "8px 14px", color: "#64748b" }}>{fmtDate(f.modifiedTime)}</td>
                  <td style={{ padding: "8px 14px", textAlign: "right" }}>
                    <button onClick={() => onPreview(f)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 4, padding: "3px 8px", fontSize: 10, cursor: "pointer", color: "#3b82f6", marginRight: 4 }}><Ic name="eye" size={10} color="#3b82f6" /></button>
                    <button onClick={() => onOpenInDrive(f)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 4, padding: "3px 10px", fontSize: 10, cursor: "pointer", color: "#028090" }}>{t.open}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
