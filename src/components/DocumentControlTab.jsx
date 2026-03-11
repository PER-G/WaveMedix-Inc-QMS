"use client";
import { useState, useEffect } from "react";
import { Ic } from "./icons";
import { fmtDate } from "../lib/dashboardHelpers";

export default function DocumentControlTab({ session, lang, t }) {
  const [liveDoc, setLiveDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState(null);
  const [populating, setPopulating] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  const formsheetId = "WM-SOP-001-F-002";
  const formsheetName = "Document Master List";

  useEffect(() => {
    if (!session?.accessToken) return;
    setLoading(true);
    fetch(`/api/live-doc?formsheetId=${formsheetId}`, {
      headers: { "x-access-token": session.accessToken },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.notFound) {
          setLiveDoc(null);
        } else if (data.error) {
          setError(data.error);
        } else {
          setLiveDoc(data);
        }
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [session?.accessToken]);

  function initializeLiveDoc() {
    if (!session?.accessToken) return;
    setInitializing(true);
    fetch("/api/live-doc", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-access-token": session.accessToken },
      body: JSON.stringify({ formsheetId, formsheetName }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); }
        else { setLiveDoc(data); }
        setInitializing(false);
      })
      .catch((e) => { setError(e.message); setInitializing(false); });
  }

  function refresh() {
    if (!liveDoc?.id || !session?.accessToken) return;
    fetch(`/api/live-doc?formsheetId=${formsheetId}`, {
      headers: { "x-access-token": session.accessToken },
    })
      .then((r) => r.json())
      .then((data) => { if (!data.error && !data.notFound) setLiveDoc(data); })
      .catch(() => {});
  }

  async function checkAndPopulate() {
    setPopulating(true);
    try {
      // Step 1: Check which documents are missing
      const checkRes = await fetch("/api/populate-master-list", {
        headers: { "x-access-token": session.accessToken },
      });
      const checkData = await checkRes.json();
      if (checkData.error) {
        alert(`Error: ${checkData.error}`);
        setPopulating(false);
        return;
      }

      if (checkData.missing.length === 0) {
        alert(lang === "de"
          ? `\u2713 Alle ${checkData.totalExpected} Dokumente sind vorhanden.`
          : `\u2713 All ${checkData.totalExpected} documents are present.`);
        setPopulating(false);
        return;
      }

      // Step 2: Show missing and ask for confirmation
      const missingList = checkData.missing.slice(0, 15).map((d) => `  \u2022 ${d.id}: ${d.name}`).join("\n");
      const moreText = checkData.missing.length > 15
        ? `\n  ... ${lang === "de" ? "und" : "and"} ${checkData.missing.length - 15} ${lang === "de" ? "weitere" : "more"}`
        : "";
      const msg = lang === "de"
        ? `${checkData.missing.length} von ${checkData.totalExpected} Dokumenten fehlen.\n\nFehlende Dokumente:\n${missingList}${moreText}\n\nFehlende erg\u00E4nzen?`
        : `${checkData.missing.length} of ${checkData.totalExpected} documents are missing.\n\nMissing documents:\n${missingList}${moreText}\n\nAdd missing documents?`;

      if (!confirm(msg)) {
        setPopulating(false);
        return;
      }

      // Step 3: Append only missing documents
      const addRes = await fetch("/api/populate-master-list", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-access-token": session.accessToken },
        body: JSON.stringify({ action: "append" }),
      });
      const addData = await addRes.json();
      if (addData.error) {
        alert(`Error: ${addData.error}`);
      } else {
        alert(lang === "de"
          ? `\u2713 ${addData.added} Dokumente erg\u00E4nzt.`
          : `\u2713 ${addData.added} documents added.`);
        setIframeKey((k) => k + 1);
        refresh();
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
    setPopulating(false);
  }

  const color = "#0369A1";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "16px 24px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: `linear-gradient(135deg, ${color}, ${color}99)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Ic name="clipDoc" size={18} color="#fff" />
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0F2B3C" }}>
            {lang === "de" ? "Dokumentenlenkung" : "Document Control"}
          </h2>
          <p style={{ margin: 0, fontSize: 11, color: "#64748b" }}>
            {formsheetId} — {lang === "de" ? "QMS-Dokumente & Operative Dokumente" : "QMS Documents & Operational Documents"}
          </p>
        </div>
        {liveDoc && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#059669" }}>
              <div style={{ width: 6, height: 6, borderRadius: 3, background: "#10B981" }} />
              LIVE
            </div>
            <span style={{ fontSize: 10, color: "#94a3b8" }}>
              {lang === "de" ? "Zuletzt ge\u00E4ndert" : "Last modified"}: {fmtDate(liveDoc.lastModified)}
            </span>
            {liveDoc.modifiedBy && liveDoc.modifiedBy !== "Unknown" && (
              <span style={{ fontSize: 10, color: "#94a3b8" }}>
                {lang === "de" ? "von" : "by"} {liveDoc.modifiedBy}
              </span>
            )}
            <button
              onClick={checkAndPopulate}
              disabled={populating}
              title={lang === "de" ? "Pr\u00FCft ob alle SOPs & Formbl\u00E4tter gelistet sind" : "Check if all SOPs & formsheets are listed"}
              style={{
                border: "1px solid #e2e8f0", background: populating ? "#f1f5f9" : "#fff", borderRadius: 4,
                padding: "3px 10px", cursor: populating ? "wait" : "pointer", fontSize: 10, fontWeight: 600,
                color: color, display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <Ic name="check" size={10} color={color} />
              {populating
                ? (lang === "de" ? "Pr\u00FCfe..." : "Checking...")
                : (lang === "de" ? "Dokumente pr\u00FCfen" : "Check Documents")}
            </button>
            <button onClick={refresh} title={t.refreshFiles} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 4, padding: "3px 6px", cursor: "pointer" }}>
              <Ic name="refresh" size={12} color="#64748b" />
            </button>
            <button onClick={() => window.open(liveDoc.webViewLink, "_blank")} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11, color: color, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
              <Ic name="open" size={12} color={color} />
              {lang === "de" ? "In Drive \u00F6ffnen" : "Open in Drive"}
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#94a3b8", fontSize: 13 }}>
            <Ic name="loader" size={20} color={color} />
            <span style={{ marginLeft: 8 }}>{lang === "de" ? "Lade Dokument..." : "Loading document..."}</span>
          </div>
        )}

        {error && (
          <div style={{ margin: 24, padding: 16, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, color: "#dc2626", fontSize: 13 }}>
            {error}
          </div>
        )}

        {!loading && !liveDoc && !error && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#94a3b8" }}>
            <Ic name="table" size={48} color="#cbd5e1" />
            <p style={{ marginTop: 12, fontSize: 14, fontWeight: 600, color: "#64748b" }}>
              {lang === "de" ? "Document Master List noch nicht erstellt" : "Document Master List not yet initialized"}
            </p>
            <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>
              {lang === "de"
                ? "Erstelle ein Live-Dokument aus dem Formblatt-Template WM-SOP-001-F-002."
                : "Create a live document from the formsheet template WM-SOP-001-F-002."}
            </p>
            <button
              onClick={initializeLiveDoc}
              disabled={initializing}
              style={{
                padding: "10px 24px", background: `linear-gradient(135deg, ${color}, #0F2B3C)`, color: "#fff",
                border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: initializing ? "wait" : "pointer",
                display: "flex", alignItems: "center", gap: 8, opacity: initializing ? 0.7 : 1,
              }}
            >
              <Ic name="plus" size={16} color="#fff" />
              {initializing
                ? (lang === "de" ? "Wird erstellt..." : "Initializing...")
                : (lang === "de" ? "Live-Dokument erstellen" : "Initialize Live Document")}
            </button>
          </div>
        )}

        {!loading && liveDoc && (
          <iframe
            key={iframeKey}
            src={`https://docs.google.com/spreadsheets/d/${liveDoc.id}/edit?usp=sharing&embedded=true`}
            style={{ width: "100%", height: "100%", border: "none" }}
            title="Document Master List"
          />
        )}
      </div>
    </div>
  );
}
