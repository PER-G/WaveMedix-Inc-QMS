"use client";
import { useState, useEffect, useCallback } from "react";
import { Ic } from "./icons";
import { fmtDate } from "../lib/dashboardHelpers";

// Two-section Document Control: QMS Master List + Operational Document Register
const DOC_SECTIONS = [
  {
    key: "master",
    formsheetId: "WM-SOP-001-F-002",
    formsheetName: "Document Master List",
    titleDe: "Document Master List (QMS)",
    titleEn: "Document Master List (QMS)",
    subtitleDe: "SOPs, Formbl\u00E4tter & QMS-Dokumente",
    subtitleEn: "SOPs, Formsheets & QMS Documents",
    color: "#0369A1",
    icon: "clipDoc",
    canPopulate: true,
  },
  {
    key: "ops",
    formsheetId: "WM-OPS-REGISTER",
    formsheetName: "Operational Document Register",
    titleDe: "Operative Dokumentenlenkungsliste",
    titleEn: "Operational Document Register",
    subtitleDe: "Development & Operations Dokumente mit DMS-Nummern",
    subtitleEn: "Development & Operations documents with DMS numbers",
    color: "#028090",
    icon: "table",
    createBlank: true,
    blankHeaders: [
      "DMS Nr.",
      "Referenz-SOP",
      "Dokumentenname",
      "Version",
      "Status",
      "Erstellt am",
      "Zuletzt ge\u00E4ndert",
      "Verantwortlich",
      "Bemerkungen",
    ],
  },
];

export default function DocumentControlTab({ session, lang, t }) {
  const [docs, setDocs] = useState({});
  const [loading, setLoading] = useState({});
  const [initializing, setInitializing] = useState({});
  const [errors, setErrors] = useState({});
  const [populating, setPopulating] = useState(false);

  // Fetch both live docs on mount
  useEffect(() => {
    if (!session?.accessToken) return;
    for (const sec of DOC_SECTIONS) {
      fetchDoc(sec);
    }
  }, [session?.accessToken]);

  function fetchDoc(sec) {
    if (!session?.accessToken) return;
    setLoading((p) => ({ ...p, [sec.key]: true }));
    fetch(`/api/live-doc?formsheetId=${sec.formsheetId}`, {
      headers: { "x-access-token": session.accessToken },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.notFound) {
          setDocs((p) => ({ ...p, [sec.key]: null }));
        } else if (data.error) {
          setErrors((p) => ({ ...p, [sec.key]: data.error }));
        } else {
          setDocs((p) => ({ ...p, [sec.key]: data }));
        }
        setLoading((p) => ({ ...p, [sec.key]: false }));
      })
      .catch((e) => {
        setErrors((p) => ({ ...p, [sec.key]: e.message }));
        setLoading((p) => ({ ...p, [sec.key]: false }));
      });
  }

  function initializeDoc(sec) {
    if (!session?.accessToken) return;
    setInitializing((p) => ({ ...p, [sec.key]: true }));
    const body = { formsheetId: sec.formsheetId, formsheetName: sec.formsheetName };
    if (sec.createBlank) {
      body.createBlank = true;
      body.headers = sec.blankHeaders;
    }
    fetch("/api/live-doc", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-access-token": session.accessToken },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setErrors((p) => ({ ...p, [sec.key]: data.error }));
        else setDocs((p) => ({ ...p, [sec.key]: data }));
        setInitializing((p) => ({ ...p, [sec.key]: false }));
      })
      .catch((e) => {
        setErrors((p) => ({ ...p, [sec.key]: e.message }));
        setInitializing((p) => ({ ...p, [sec.key]: false }));
      });
  }

  function refreshDoc(sec) {
    if (!docs[sec.key]?.id || !session?.accessToken) return;
    fetch(`/api/live-doc?formsheetId=${sec.formsheetId}`, {
      headers: { "x-access-token": session.accessToken },
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.error && !data.notFound) setDocs((p) => ({ ...p, [sec.key]: data }));
      })
      .catch(() => {});
  }

  async function populateMasterList() {
    const msg = lang === "de"
      ? "Alle bestehenden Eintr\u00E4ge werden \u00FCberschrieben. Fortfahren?"
      : "All existing entries will be overwritten. Continue?";
    if (!confirm(msg)) return;

    setPopulating(true);
    try {
      const res = await fetch("/api/populate-master-list", {
        method: "POST",
        headers: { "x-access-token": session.accessToken },
      });
      const data = await res.json();
      if (data.error) {
        alert(`Error: ${data.error}`);
      } else {
        alert(lang === "de"
          ? `${data.totalRows} Dokumente eingetragen (${data.sopCount} SOPs + ${data.formsheetCount} Formbl\u00E4tter)`
          : `${data.totalRows} documents populated (${data.sopCount} SOPs + ${data.formsheetCount} formsheets)`);
        // Force iframe reload
        refreshDoc(DOC_SECTIONS[0]);
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
    setPopulating(false);
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Main Header */}
      <div style={{ padding: "12px 24px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg, #0369A1, #0369A199)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Ic name="clipDoc" size={18} color="#fff" />
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0F2B3C" }}>
            {lang === "de" ? "Dokumentenlenkung" : "Document Control"}
          </h2>
          <p style={{ margin: 0, fontSize: 11, color: "#64748b" }}>
            {lang === "de" ? "QMS-Dokumente & Operative Dokumente" : "QMS Documents & Operational Documents"}
          </p>
        </div>
      </div>

      {/* Two sections */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {DOC_SECTIONS.map((sec, idx) => {
          const doc = docs[sec.key];
          const isLoading = loading[sec.key];
          const isInit = initializing[sec.key];
          const err = errors[sec.key];

          return (
            <div key={sec.key} style={{ flex: 1, display: "flex", flexDirection: "column", borderTop: idx > 0 ? "2px solid #e2e8f0" : "none", minHeight: 0 }}>
              {/* Section Header */}
              <div style={{ padding: "8px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 8, flexShrink: 0, background: "#fafbfc" }}>
                <div style={{ width: 24, height: 24, borderRadius: 6, background: `linear-gradient(135deg, ${sec.color}, ${sec.color}99)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Ic name={sec.icon} size={12} color="#fff" />
                </div>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#0F2B3C" }}>
                    {lang === "de" ? sec.titleDe : sec.titleEn}
                  </span>
                  <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 8 }}>
                    {sec.formsheetId}
                  </span>
                </div>
                {doc && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#059669" }}>
                      <div style={{ width: 6, height: 6, borderRadius: 3, background: "#10B981" }} />
                      LIVE
                    </div>
                    <span style={{ fontSize: 10, color: "#94a3b8" }}>
                      {fmtDate(doc.lastModified)}
                    </span>
                    {sec.canPopulate && (
                      <button
                        onClick={populateMasterList}
                        disabled={populating}
                        title={lang === "de" ? "Alle SOPs & Formbl\u00E4tter eintragen" : "Populate all SOPs & formsheets"}
                        style={{
                          border: "1px solid #e2e8f0", background: populating ? "#f1f5f9" : "#fff", borderRadius: 4,
                          padding: "3px 10px", cursor: populating ? "wait" : "pointer", fontSize: 10, fontWeight: 600,
                          color: sec.color, display: "flex", alignItems: "center", gap: 4,
                        }}
                      >
                        <Ic name="plus" size={10} color={sec.color} />
                        {populating
                          ? (lang === "de" ? "Wird eingetragen..." : "Populating...")
                          : (lang === "de" ? "Alle Dokumente eintragen" : "Populate All")}
                      </button>
                    )}
                    <button onClick={() => refreshDoc(sec)} title={t.refreshFiles} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 4, padding: "3px 6px", cursor: "pointer" }}>
                      <Ic name="refresh" size={12} color="#64748b" />
                    </button>
                    <button
                      onClick={() => window.open(doc.webViewLink, "_blank")}
                      style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 10, color: sec.color, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}
                    >
                      <Ic name="open" size={10} color={sec.color} />
                      Drive
                    </button>
                  </>
                )}
              </div>

              {/* Section Content */}
              <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
                {isLoading && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#94a3b8", fontSize: 12 }}>
                    <Ic name="loader" size={16} color={sec.color} />
                    <span style={{ marginLeft: 8 }}>{lang === "de" ? "Lade..." : "Loading..."}</span>
                  </div>
                )}

                {err && (
                  <div style={{ margin: 16, padding: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#dc2626", fontSize: 12 }}>
                    {err}
                  </div>
                )}

                {!isLoading && !doc && !err && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#94a3b8" }}>
                    <Ic name={sec.icon} size={36} color="#cbd5e1" />
                    <p style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: "#64748b" }}>
                      {lang === "de" ? sec.titleDe : sec.titleEn}
                    </p>
                    <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 12 }}>
                      {lang === "de" ? sec.subtitleDe : sec.subtitleEn}
                    </p>
                    <button
                      onClick={() => initializeDoc(sec)}
                      disabled={isInit}
                      style={{
                        padding: "8px 20px", background: `linear-gradient(135deg, ${sec.color}, #0F2B3C)`, color: "#fff",
                        border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: isInit ? "wait" : "pointer",
                        display: "flex", alignItems: "center", gap: 6, opacity: isInit ? 0.7 : 1,
                      }}
                    >
                      <Ic name="plus" size={14} color="#fff" />
                      {isInit
                        ? (lang === "de" ? "Wird erstellt..." : "Initializing...")
                        : (lang === "de" ? "Live-Dokument erstellen" : "Initialize Live Document")}
                    </button>
                  </div>
                )}

                {!isLoading && doc && (
                  <iframe
                    key={doc.id + doc.lastModified}
                    src={`https://docs.google.com/spreadsheets/d/${doc.id}/edit?usp=sharing&embedded=true`}
                    style={{ width: "100%", height: "100%", border: "none" }}
                    title={lang === "de" ? sec.titleDe : sec.titleEn}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
