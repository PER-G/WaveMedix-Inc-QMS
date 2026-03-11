"use client";
import { useState, useEffect } from "react";
import { Ic } from "./icons";
import { extractVersion, fileExt, cleanFormName, fmtSize, fmtDate, matchFilesToCategories, countCategoryFiles } from "../lib/dashboardHelpers";

/**
 * DocumentExplorer — Reusable two-panel file explorer for Development & Operations tabs.
 * Now supports live documents (registers) in categories via liveDocs config.
 */
export default function DocumentExplorer({
  session, areaConfig, files, loading, areaFolderId, lang, t,
  onPreview, onOpenInDrive, onRefresh, onSetupFolders, settingUp,
}) {
  const [selected, setSelected] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [liveDocs, setLiveDocs] = useState({});
  const [liveDocsLoading, setLiveDocsLoading] = useState({});

  // Fetch live doc status when a category with liveDocs is expanded
  useEffect(() => {
    if (!session?.accessToken) return;
    for (const cat of areaConfig.categories) {
      if (cat.liveDocs && expanded[cat.path]) {
        for (const ld of cat.liveDocs) {
          if (!liveDocs[ld.formsheetId] && !liveDocsLoading[ld.formsheetId]) {
            setLiveDocsLoading((p) => ({ ...p, [ld.formsheetId]: true }));
            const searchUrl = `/api/live-doc?formsheetId=${ld.formsheetId}${ld.driveSearchName ? `&driveSearchName=${ld.driveSearchName}` : ""}`;
            fetch(searchUrl, {
              headers: { "x-access-token": session.accessToken },
            })
              .then((r) => r.json())
              .then((data) => {
                if (!data.error && !data.notFound) {
                  setLiveDocs((p) => ({ ...p, [ld.formsheetId]: data }));
                }
                setLiveDocsLoading((p) => ({ ...p, [ld.formsheetId]: false }));
              })
              .catch(() => setLiveDocsLoading((p) => ({ ...p, [ld.formsheetId]: false })));
          }
        }
      }
    }
  }, [expanded, session?.accessToken, areaConfig.categories]);

  function initializeLiveDoc(formsheetId, formsheetName, driveSearchName) {
    if (!session?.accessToken) return;
    setLiveDocsLoading((p) => ({ ...p, [formsheetId]: true }));
    const body = { formsheetId, formsheetName };
    if (driveSearchName) body.driveSearchName = driveSearchName;
    fetch("/api/live-doc", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-access-token": session.accessToken },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) {
          setLiveDocs((p) => ({ ...p, [formsheetId]: data }));
        }
        setLiveDocsLoading((p) => ({ ...p, [formsheetId]: false }));
      })
      .catch(() => setLiveDocsLoading((p) => ({ ...p, [formsheetId]: false })));
  }

  const catMap = matchFilesToCategories(files, areaConfig);
  const totalFiles = files.length;

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* Left panel — Category tree */}
      <div style={{ width: 440, borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", background: "#fff", flexShrink: 0 }}>
        {/* Header with product name + actions */}
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 8 }}>
          {areaConfig.product && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
              <div style={{ width: 24, height: 24, borderRadius: 6, background: `linear-gradient(135deg, ${areaConfig.color}, ${areaConfig.color}99)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic name={areaConfig.icon} size={12} color="#fff" />
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#0F2B3C" }}>{areaConfig.product}</span>
              <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: "auto" }}>{totalFiles} {lang === "de" ? "Dateien" : "files"}</span>
            </div>
          )}
          {!areaConfig.product && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
              <Ic name={areaConfig.icon} size={16} color={areaConfig.color} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "#0F2B3C" }}>{lang === "de" ? areaConfig.label.de : areaConfig.label.en}</span>
              <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: "auto" }}>{totalFiles} {lang === "de" ? "Dateien" : "files"}</span>
            </div>
          )}
          <button onClick={onRefresh} title={t.refreshFiles} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 4, padding: "3px 6px", cursor: "pointer" }}>
            <Ic name="refresh" size={12} color="#64748b" />
          </button>
          {areaFolderId && (
            <button onClick={() => window.open(`https://drive.google.com/drive/folders/${areaFolderId}`, "_blank")} title={t.openDrive} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 4, padding: "3px 6px", cursor: "pointer" }}>
              <Ic name="open" size={12} color="#028090" />
            </button>
          )}
        </div>

        {/* Category tree */}
        <div style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
          {loading && <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>{t.loading}</div>}

          {!loading && totalFiles === 0 && !settingUp && (
            <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>
              <Ic name="folder" size={40} color="#e2e8f0" />
              <p style={{ marginTop: 12, fontSize: 13, fontWeight: 600 }}>{t.noDocs}</p>
              <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>
                {lang === "de"
                  ? "Nutze den Claude AI Assistenten, um Dokumente zu erstellen, oder lade Dateien direkt in Google Drive hoch."
                  : "Use the Claude AI Assistant to create documents, or upload files directly in Google Drive."}
              </p>
              <p style={{ fontSize: 10, color: "#cbd5e1" }}>
                {lang === "de" ? "Ordnerstruktur ist bereit \u2713" : "Folder structure is ready \u2713"}
              </p>
            </div>
          )}

          {settingUp && (
            <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>
              <Ic name="loader" size={24} color={areaConfig.color} />
              <p style={{ marginTop: 8, fontSize: 12 }}>{lang === "de" ? "Erstelle Ordner..." : "Creating folders..."}</p>
            </div>
          )}

          {!loading && areaConfig.categories.map((cat) => {
            const isExp = expanded[cat.path];
            const fileCount = countCategoryFiles(catMap, cat.path);
            const catData = catMap[cat.path];
            const hasLiveDocs = cat.liveDocs && cat.liveDocs.length > 0;

            return (
              <div key={cat.path} style={{ padding: "0 8px", marginBottom: 2 }}>
                <div
                  onClick={() => setExpanded((p) => ({ ...p, [cat.path]: !p[cat.path] }))}
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 8px", borderRadius: 6, cursor: "pointer", background: "transparent", transition: "background .15s" }}
                >
                  <span style={{ transform: isExp ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform .2s", display: "inline-flex" }}>
                    <Ic name="chev" size={12} color="#94a3b8" />
                  </span>
                  <Ic name={isExp ? "folderOpen" : "folder"} size={14} color={fileCount > 0 || hasLiveDocs ? areaConfig.color : "#cbd5e1"} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: fileCount > 0 || hasLiveDocs ? "#1e293b" : "#94a3b8", flex: 1 }}>
                    {lang === "de" ? cat.label.de : cat.label.en}
                  </span>
                  {hasLiveDocs && (
                    <span style={{ fontSize: 8, background: "#ecfdf5", color: "#059669", padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>LIVE</span>
                  )}
                  {fileCount > 0 && (
                    <span style={{ fontSize: 9, background: `${areaConfig.color}15`, color: areaConfig.color, padding: "1px 6px", borderRadius: 3, fontWeight: 600 }}>
                      {fileCount}
                    </span>
                  )}
                </div>

                {isExp && catData && (
                  <div style={{ marginLeft: 24, borderLeft: "1px solid #e2e8f0", paddingLeft: 8 }}>
                    {/* Live Documents (registers) */}
                    {hasLiveDocs && cat.liveDocs.map((ld) => {
                      const doc = liveDocs[ld.formsheetId];
                      const isLoading = liveDocsLoading[ld.formsheetId];
                      return (
                        <div key={ld.formsheetId} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", fontSize: 11, borderRadius: 4, background: "#f0fdf4", marginBottom: 2 }}>
                          <div style={{ width: 6, height: 6, borderRadius: 3, background: doc ? "#10B981" : "#94a3b8" }} />
                          <Ic name="table" size={12} color="#059669" />
                          <span style={{ flex: 1, fontWeight: 600, color: "#059669" }}>
                            {lang === "de" ? ld.name.de : ld.name.en}
                          </span>
                          <span style={{ fontSize: 8, color: "#059669", fontWeight: 700 }}>LIVE</span>
                          {isLoading && <Ic name="loader" size={10} color="#059669" />}
                          {doc && !isLoading && (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); onPreview({ id: doc.id, name: doc.name, mimeType: "application/vnd.google-apps.spreadsheet", webViewLink: doc.webViewLink }); }}
                                style={{ border: "none", background: "#dcfce7", borderRadius: 3, padding: "1px 6px", fontSize: 10, cursor: "pointer", color: "#059669" }}
                              >
                                <Ic name="eye" size={10} color="#059669" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); window.open(doc.webViewLink, "_blank"); }}
                                style={{ border: "none", background: "#dcfce7", borderRadius: 3, padding: "1px 6px", fontSize: 10, cursor: "pointer", color: "#059669" }}
                              >
                                {t.open}
                              </button>
                            </>
                          )}
                          {!doc && !isLoading && (
                            <button
                              onClick={(e) => { e.stopPropagation(); initializeLiveDoc(ld.formsheetId, lang === "en" ? ld.name.en : ld.name.de, ld.driveSearchName); }}
                              style={{ border: "none", background: "#dcfce7", borderRadius: 3, padding: "1px 6px", fontSize: 10, cursor: "pointer", color: "#059669", fontWeight: 600 }}
                            >
                              {lang === "de" ? "Erstellen" : "Initialize"}
                            </button>
                          )}
                        </div>
                      );
                    })}

                    {/* Sub-modules (e.g. Q-PSI Tokenizer, Ammonix ECG Agent) */}
                    {cat.subModules && cat.subModules.map((sub) => {
                      const subFiles = catData.subModules?.[sub.path] || [];
                      const isSubExp = expanded[`${cat.path}/${sub.path}`];
                      return (
                        <div key={sub.path}>
                          <div
                            onClick={() => setExpanded((p) => ({ ...p, [`${cat.path}/${sub.path}`]: !p[`${cat.path}/${sub.path}`] }))}
                            style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}
                          >
                            <span style={{ transform: isSubExp ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform .2s", display: "inline-flex" }}>
                              <Ic name="chev" size={10} color="#cbd5e1" />
                            </span>
                            <Ic name={isSubExp ? "folderOpen" : "folder"} size={12} color={subFiles.length > 0 ? areaConfig.color : "#e2e8f0"} />
                            <span style={{ flex: 1, color: subFiles.length > 0 ? "#334155" : "#94a3b8", fontWeight: 500 }}>
                              {lang === "de" ? sub.label.de : sub.label.en}
                            </span>
                            {subFiles.length > 0 && <span style={{ fontSize: 9, color: "#94a3b8" }}>{subFiles.length}</span>}
                          </div>
                          {isSubExp && subFiles.map((f) => (
                            <FileRow key={f.id} file={f} selected={selected} setSelected={setSelected} onPreview={onPreview} onOpenInDrive={onOpenInDrive} t={t} />
                          ))}
                          {isSubExp && subFiles.length === 0 && (
                            <div style={{ padding: "4px 8px 4px 28px", fontSize: 10, color: "#cbd5e1", fontStyle: "italic" }}>{t.noDocs}</div>
                          )}
                        </div>
                      );
                    })}

                    {/* Direct files in this category */}
                    {catData.files.map((f) => (
                      <FileRow key={f.id} file={f} selected={selected} setSelected={setSelected} onPreview={onPreview} onOpenInDrive={onOpenInDrive} t={t} />
                    ))}

                    {/* Empty state */}
                    {!cat.subModules && !hasLiveDocs && catData.files.length === 0 && (
                      <div style={{ padding: "6px 8px", fontSize: 11, color: "#cbd5e1", fontStyle: "italic" }}>{t.noDocs}</div>
                    )}
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
                <div style={{ width: 48, height: 48, borderRadius: 10, background: `linear-gradient(135deg, ${areaConfig.color}, ${areaConfig.color}99)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Ic name={fileExt(selected.name) === "xlsx" ? "table" : "file"} size={24} color="#fff" />
                </div>
                <div style={{ flex: 1 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#0F2B3C" }}>{cleanFormName(selected.name)}</h2>
                  <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0" }}>{selected.name}</p>
                  {selected.subfolderPath && (
                    <p style={{ fontSize: 11, color: areaConfig.color, margin: "2px 0" }}>
                      <Ic name="folder" size={10} color={areaConfig.color} /> {selected.subfolderPath}
                    </p>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, background: "#f1f5f9", padding: "3px 8px", borderRadius: 4, color: "#64748b" }}>.{fileExt(selected.name)}</span>
                    <span style={{ fontSize: 11, background: "#f1f5f9", padding: "3px 8px", borderRadius: 4, color: "#64748b" }}>{fmtSize(selected.size)}</span>
                    <span style={{ fontSize: 11, background: "#f1f5f9", padding: "3px 8px", borderRadius: 4, color: "#64748b" }}>{fmtDate(selected.modifiedTime)}</span>
                    {extractVersion(selected.name) && <span style={{ fontSize: 11, background: "#ecfdf5", padding: "3px 8px", borderRadius: 4, color: "#059669", fontWeight: 600 }}>V{extractVersion(selected.name)}</span>}
                    {selected.lastModifiedBy && selected.lastModifiedBy !== "Unknown" && <span style={{ fontSize: 11, background: "#eff6ff", padding: "3px 8px", borderRadius: 4, color: "#3b82f6" }}>{selected.lastModifiedBy}</span>}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button onClick={() => onOpenInDrive(selected)} style={{ flex: 1, padding: "10px 16px", background: `linear-gradient(135deg, ${areaConfig.color}, #0F2B3C)`, color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Ic name="open" size={16} color="#fff" />
                  {lang === "de" ? "In Google Drive \u00F6ffnen" : "Open in Google Drive"}
                </button>
                <button onClick={() => onPreview(selected)} style={{ flex: 1, padding: "10px 16px", background: "#fff", color: areaConfig.color, border: `2px solid ${areaConfig.color}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Ic name="eye" size={16} color={areaConfig.color} />
                  {lang === "de" ? "Vorschau" : "Preview"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reusable file row ──
function FileRow({ file, selected, setSelected, onPreview, onOpenInDrive, t }) {
  const ver = extractVersion(file.name);
  const ext = fileExt(file.name);
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", fontSize: 11, borderRadius: 4, cursor: "pointer", background: selected?.id === file.id ? "#f0fdf4" : "transparent" }}
      onClick={() => setSelected(file)}
    >
      <Ic name={ext === "xlsx" ? "table" : "file"} size={12} color={ext === "xlsx" ? "#059669" : "#3b82f6"} />
      <span style={{ flex: 1, color: "#334155" }}>{cleanFormName(file.name)}</span>
      {ver && <span style={{ fontSize: 9, color: "#94a3b8", minWidth: 28, textAlign: "right" }}>{ver}</span>}
      <button onClick={(e) => { e.stopPropagation(); onPreview(file); }} style={{ border: "none", background: "#eff6ff", borderRadius: 3, padding: "1px 6px", fontSize: 10, cursor: "pointer", color: "#3b82f6" }}>
        <Ic name="eye" size={10} color="#3b82f6" />
      </button>
      <button onClick={(e) => { e.stopPropagation(); onOpenInDrive(file); }} style={{ border: "none", background: "#f1f5f9", borderRadius: 3, padding: "1px 6px", fontSize: 10, cursor: "pointer", color: "#028090" }}>
        {t.open}
      </button>
    </div>
  );
}
