"use client";
import { useState } from "react";
import { Ic } from "./icons";
import { extractVersion, fileExt, cleanFormName, fmtSize, fmtDate, SOPS } from "../lib/dashboardHelpers";

export default function SopExplorer({ files, fileMap, loading, lang, t, onPreview, onOpenInDrive }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [oldExpanded, setOldExpanded] = useState({});

  const filteredSops = SOPS.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.id.toLowerCase().includes(q) || s.de.toLowerCase().includes(q) || s.en.toLowerCase().includes(q) || (s.alt && s.alt.toLowerCase().includes(q));
  });

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* Left tree */}
      <div style={{ width: 440, borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", background: "#fff", flexShrink: 0 }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #f1f5f9" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 10px" }}>
            <Ic name="search" size={14} color="#94a3b8" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.search} style={{ border: "none", background: "none", outline: "none", fontSize: 12, flex: 1, color: "#334155" }} />
            {search && <button onClick={() => setSearch("")} style={{ border: "none", background: "none", cursor: "pointer", padding: 0 }}><Ic name="x" size={12} color="#94a3b8" /></button>}
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
          {loading && <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>{t.loading}</div>}

          {filteredSops.map((sop) => {
            const fm = fileMap[sop.id] || { sop: null, forms: [], oldForms: [] };
            const hasFiles = fm.sop || fm.forms.length > 0;
            const isExp = expanded[sop.id];
            const isOldExp = oldExpanded[sop.id];
            const sopVersion = fm.sop ? extractVersion(fm.sop.name) : null;

            return (
              <div key={sop.id} style={{ padding: "0 8px", marginBottom: 2 }}>
                <div
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 8px", borderRadius: 6, cursor: "pointer", background: selected?.id === fm.sop?.id ? "#ecfdf5" : "transparent", transition: "background .15s" }}
                  onClick={() => {
                    setExpanded((p) => ({ ...p, [sop.id]: !p[sop.id] }));
                    if (fm.sop) setSelected(fm.sop);
                  }}
                >
                  <span style={{ transform: isExp ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform .2s", display: "inline-flex" }}><Ic name="chev" size={12} color="#94a3b8" /></span>
                  <Ic name={isExp ? "folderOpen" : "folder"} size={14} color={hasFiles ? "#028090" : "#cbd5e1"} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: hasFiles ? "#1e293b" : "#94a3b8", minWidth: 100 }}>{sop.id}</span>
                  <span style={{ fontSize: 10, color: "#64748b", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lang === "de" ? sop.de : sop.en}</span>
                  {sopVersion && <span style={{ fontSize: 9, background: "#ecfdf5", color: "#059669", padding: "1px 6px", borderRadius: 3, fontWeight: 600, flexShrink: 0 }}>{sopVersion}</span>}
                  {fm.sop && (
                    <button onClick={(e) => { e.stopPropagation(); onOpenInDrive(fm.sop); }} style={{ border: "none", background: "#028090", color: "#fff", borderRadius: 4, padding: "2px 6px", fontSize: 10, cursor: "pointer", flexShrink: 0 }}>
                      <Ic name="open" size={10} color="#fff" />
                    </button>
                  )}
                </div>

                {isExp && (
                  <div style={{ marginLeft: 24, borderLeft: "1px solid #e2e8f0", paddingLeft: 8 }}>
                    {fm.sop && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", fontSize: 11, borderRadius: 4, cursor: "pointer", background: selected?.id === fm.sop.id ? "#f0fdf4" : "transparent", marginBottom: 2 }} onClick={() => setSelected(fm.sop)}>
                        <Ic name="file" size={12} color="#3b82f6" />
                        <span style={{ flex: 1, fontWeight: 600, color: "#1e293b" }}>{cleanFormName(fm.sop.name)}</span>
                        {sopVersion && <span style={{ fontSize: 9, color: "#059669", fontWeight: 600 }}>{sopVersion}</span>}
                        <button onClick={(e) => { e.stopPropagation(); onPreview(fm.sop); }} style={{ border: "none", background: "#eff6ff", borderRadius: 3, padding: "1px 6px", fontSize: 10, cursor: "pointer", color: "#3b82f6" }}><Ic name="eye" size={10} color="#3b82f6" /></button>
                        <button onClick={(e) => { e.stopPropagation(); onOpenInDrive(fm.sop); }} style={{ border: "none", background: "#f1f5f9", borderRadius: 3, padding: "1px 6px", fontSize: 10, cursor: "pointer", color: "#028090" }}>{t.open}</button>
                      </div>
                    )}

                    {fm.forms.length > 0 && (
                      <div style={{ padding: "4px 0 2px 0", fontSize: 10, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, display: "flex" }}>
                        <span>{t.forms} ({fm.forms.length})</span>
                        <span style={{ marginLeft: "auto", marginRight: 80, fontWeight: 400, textTransform: "none" }}>{t.version}</span>
                      </div>
                    )}
                    {fm.forms.map((f) => {
                      const ver = extractVersion(f.name);
                      const ext = fileExt(f.name);
                      return (
                        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", fontSize: 11, borderRadius: 4, cursor: "pointer", background: selected?.id === f.id ? "#f0fdf4" : "transparent" }} onClick={() => setSelected(f)}>
                          <Ic name={ext === "xlsx" ? "table" : "file"} size={12} color={ext === "xlsx" ? "#059669" : "#3b82f6"} />
                          <span style={{ flex: 1, color: "#334155" }}>{cleanFormName(f.name)}</span>
                          {ver && <span style={{ fontSize: 9, color: "#94a3b8", minWidth: 28, textAlign: "right" }}>{ver}</span>}
                          <button onClick={(e) => { e.stopPropagation(); onPreview(f); }} style={{ border: "none", background: "#eff6ff", borderRadius: 3, padding: "1px 6px", fontSize: 10, cursor: "pointer", color: "#3b82f6" }}><Ic name="eye" size={10} color="#3b82f6" /></button>
                          <button onClick={(e) => { e.stopPropagation(); onOpenInDrive(f); }} style={{ border: "none", background: "#f1f5f9", borderRadius: 3, padding: "1px 6px", fontSize: 10, cursor: "pointer", color: "#028090" }}>{t.open}</button>
                        </div>
                      );
                    })}

                    {fm.oldForms.length > 0 && (
                      <>
                        <div onClick={() => setOldExpanded((p) => ({ ...p, [sop.id]: !p[sop.id] }))} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 8px", marginTop: 4, cursor: "pointer", fontSize: 10, color: "#94a3b8", borderTop: "1px solid #f1f5f9" }}>
                          <span style={{ transform: isOldExp ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform .2s", display: "inline-flex" }}><Ic name="chev" size={10} color="#cbd5e1" /></span>
                          <Ic name="archive" size={11} color="#cbd5e1" />
                          <span style={{ fontWeight: 500 }}>{t.oldForms} ({fm.oldForms.length})</span>
                        </div>
                        {isOldExp && fm.oldForms.map((f) => {
                          const ver = extractVersion(f.name);
                          const ext = fileExt(f.name);
                          return (
                            <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 8px 3px 24px", fontSize: 10, borderRadius: 4, cursor: "pointer", opacity: 0.6, background: selected?.id === f.id ? "#f8fafc" : "transparent" }} onClick={() => setSelected(f)}>
                              <Ic name={ext === "xlsx" ? "table" : "file"} size={11} color="#94a3b8" />
                              <span style={{ flex: 1, color: "#94a3b8" }}>{cleanFormName(f.name)}</span>
                              {ver && <span style={{ fontSize: 9, color: "#cbd5e1" }}>{ver}</span>}
                              <button onClick={(e) => { e.stopPropagation(); onPreview(f); }} style={{ border: "none", background: "#f8fafc", borderRadius: 3, padding: "1px 6px", fontSize: 9, cursor: "pointer", color: "#94a3b8" }}><Ic name="eye" size={9} color="#94a3b8" /></button>
                              <button onClick={(e) => { e.stopPropagation(); onOpenInDrive(f); }} style={{ border: "none", background: "#f8fafc", borderRadius: 3, padding: "1px 6px", fontSize: 9, cursor: "pointer", color: "#94a3b8" }}>{t.open}</button>
                            </div>
                          );
                        })}
                      </>
                    )}
                    {fm.forms.length === 0 && !fm.sop && <div style={{ padding: "6px 8px", fontSize: 11, color: "#cbd5e1", fontStyle: "italic" }}>{t.noForms}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Right detail panel */}
      <div style={{ flex: 1, overflow: "auto", padding: 24, background: "#f8fafc" }}>
        {!selected && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#94a3b8" }}>
            <Ic name="eye" size={48} color="#cbd5e1" />
            <p style={{ marginTop: 12, fontSize: 14 }}>{lang === "de" ? "Dokument ausw\u00E4hlen" : "Select a document"}</p>
          </div>
        )}
        {selected && (
          <div className="fade-in">
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 24, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 48, height: 48, borderRadius: 10, background: fileExt(selected.name) === "xlsx" ? "linear-gradient(135deg,#059669,#10B981)" : "linear-gradient(135deg,#3b82f6,#6366f1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Ic name={fileExt(selected.name) === "xlsx" ? "table" : "file"} size={24} color="#fff" />
                </div>
                <div style={{ flex: 1 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#0F2B3C" }}>{cleanFormName(selected.name)}</h2>
                  <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0" }}>{selected.name}</p>
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, background: "#f1f5f9", padding: "3px 8px", borderRadius: 4, color: "#64748b" }}>.{fileExt(selected.name)}</span>
                    <span style={{ fontSize: 11, background: "#f1f5f9", padding: "3px 8px", borderRadius: 4, color: "#64748b" }}>{fmtSize(selected.size)}</span>
                    <span style={{ fontSize: 11, background: "#f1f5f9", padding: "3px 8px", borderRadius: 4, color: "#64748b" }}>{fmtDate(selected.modifiedTime)}</span>
                    {extractVersion(selected.name) && <span style={{ fontSize: 11, background: "#ecfdf5", padding: "3px 8px", borderRadius: 4, color: "#059669", fontWeight: 600 }}>V{extractVersion(selected.name)}</span>}
                    {selected.lastModifiedBy && selected.lastModifiedBy !== "Unknown" && <span style={{ fontSize: 11, background: "#eff6ff", padding: "3px 8px", borderRadius: 4, color: "#3b82f6" }}>{selected.lastModifiedBy}</span>}
                    {selected.isOld && <span style={{ fontSize: 11, background: "#fef3c7", padding: "3px 8px", borderRadius: 4, color: "#d97706", fontWeight: 600 }}>Archiviert</span>}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button onClick={() => onOpenInDrive(selected)} style={{ flex: 1, padding: "10px 16px", background: "linear-gradient(135deg, #028090, #0F2B3C)", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Ic name="open" size={16} color="#fff" />
                  {lang === "de" ? "In Google Drive \u00F6ffnen" : "Open in Google Drive"}
                </button>
                <button onClick={() => onPreview(selected)} style={{ flex: 1, padding: "10px 16px", background: "#fff", color: "#028090", border: "2px solid #028090", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Ic name="eye" size={16} color="#028090" />
                  {lang === "de" ? "Vorschau (Read-Only)" : "Preview (Read-Only)"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
