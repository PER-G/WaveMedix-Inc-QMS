"use client";
import { useState, useEffect } from "react";
import { Ic, Av } from "./icons";
import { TF, TL, TM, fmtDate } from "../lib/dashboardHelpers";

function OrgChart({ lang }) {
  const ceo = TF.find((p) => p.i === "PR");
  const president = TF.find((p) => p.i === "FS");
  const director = TL[0];
  const team = TM;

  const cardStyle = (accent) => ({
    background: "#fff",
    border: `2px solid ${accent}`,
    borderRadius: 10,
    padding: "10px 16px",
    textAlign: "center",
    minWidth: 140,
    position: "relative",
  });

  const nameStyle = { fontWeight: 700, fontSize: 13, color: "#0F2B3C" };
  const roleStyle = (c) => ({ fontSize: 11, color: c || "#64748b", fontWeight: 500 });

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 24, marginBottom: 16 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 20 }}>
        {lang === "de" ? "Organigramm" : "Organization Chart"}
      </h3>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
        {/* Founders row */}
        <div style={{ display: "flex", gap: 32, justifyContent: "center", marginBottom: 0 }}>
          {[president, ceo].map((p) => (
            <div key={p.i} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={cardStyle(p.c)}>
                <Av ini={p.i} col={p.c} sz={36} />
                <div style={{ ...nameStyle, marginTop: 6 }}>{p.name}</div>
                <div style={roleStyle(p.c)}>{lang === "de" ? p.roleDe : p.role}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Connector line */}
        <div style={{ width: 2, height: 20, background: "#cbd5e1" }} />

        {/* Director */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 0 }}>
          <div style={cardStyle(director.c)}>
            <Av ini={director.i} col={director.c} sz={36} />
            <div style={{ ...nameStyle, marginTop: 6 }}>{director.name}</div>
            <div style={roleStyle(director.c)}>{lang === "de" ? director.roleDe : director.role}</div>
          </div>
        </div>

        {/* Connector line */}
        <div style={{ width: 2, height: 20, background: "#cbd5e1" }} />

        {/* Horizontal line spanning team */}
        <div style={{ width: `${Math.min(team.length * 160, 640)}px`, height: 2, background: "#cbd5e1" }} />

        {/* Team row */}
        <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
          {team.map((p) => (
            <div key={p.i} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ width: 2, height: 16, background: "#cbd5e1" }} />
              <div style={cardStyle(p.c)}>
                <Av ini={p.i} col={p.c} sz={32} />
                <div style={{ ...nameStyle, marginTop: 4, fontSize: 12 }}>{p.name}</div>
                <div style={roleStyle(p.c)}>{lang === "de" ? p.roleDe : p.role}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FunctionMatrix({ session, lang }) {
  const [liveDoc, setLiveDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [iframeKey, setIframeKey] = useState(0);

  const formsheetId = "WM-QMS-002-F-001";
  const driveSearchName = "Function_Matrix";

  useEffect(() => {
    if (!session?.accessToken) return;
    setLoading(true);
    fetch(`/api/live-doc?formsheetId=${formsheetId}&driveSearchName=${driveSearchName}`, {
      headers: { "x-access-token": session.accessToken },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.notFound) setLiveDoc(null);
        else if (data.error) setError(data.error);
        else setLiveDoc(data);
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [session?.accessToken]);

  function refresh() {
    if (!session?.accessToken) return;
    fetch(`/api/live-doc?formsheetId=${formsheetId}&driveSearchName=${driveSearchName}`, {
      headers: { "x-access-token": session.accessToken },
    })
      .then((r) => r.json())
      .then((data) => { if (!data.error && !data.notFound) { setLiveDoc(data); setIframeKey((k) => k + 1); } })
      .catch(() => {});
  }

  const color = "#028090";

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg, ${color}, ${color}99)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Ic name="table" size={16} color="#fff" />
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#0F2B3C" }}>
            {lang === "de" ? "QMS Funktionsmatrix" : "QMS Function Matrix"}
          </h3>
          <p style={{ margin: 0, fontSize: 10, color: "#94a3b8" }}>
            {formsheetId} — {lang === "de" ? "Rollen- und Stellvertretungszuordnung" : "Role & Deputy Assignment"}
          </p>
        </div>
        {liveDoc && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#059669" }}>
              <div style={{ width: 6, height: 6, borderRadius: 3, background: "#10B981" }} />
              LIVE
            </div>
            <span style={{ fontSize: 10, color: "#94a3b8" }}>
              {fmtDate(liveDoc.lastModified)}
            </span>
            <button onClick={refresh} title="Refresh" style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 4, padding: "3px 6px", cursor: "pointer" }}>
              <Ic name="refresh" size={12} color="#64748b" />
            </button>
            <button
              onClick={() => window.open(liveDoc.webViewLink, "_blank")}
              style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11, color, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}
            >
              <Ic name="open" size={12} color={color} />
              {lang === "de" ? "In Drive öffnen" : "Open in Drive"}
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ height: 500 }}>
        {loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#94a3b8", fontSize: 13 }}>
            <Ic name="loader" size={20} color={color} />
            <span style={{ marginLeft: 8 }}>{lang === "de" ? "Lade Funktionsmatrix..." : "Loading function matrix..."}</span>
          </div>
        )}

        {error && (
          <div style={{ margin: 16, padding: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#dc2626", fontSize: 12 }}>
            {error}
          </div>
        )}

        {!loading && !liveDoc && !error && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#94a3b8" }}>
            <Ic name="table" size={40} color="#cbd5e1" />
            <p style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: "#64748b" }}>
              {lang === "de" ? "Funktionsmatrix nicht gefunden" : "Function Matrix not found"}
            </p>
            <p style={{ fontSize: 11, color: "#94a3b8" }}>
              {lang === "de"
                ? "Bitte WM-QMS-002-F-001_Function_Matrix in den QMH-Ordner hochladen."
                : "Please upload WM-QMS-002-F-001_Function_Matrix to the QMH folder."}
            </p>
          </div>
        )}

        {!loading && liveDoc && (
          <iframe
            key={iframeKey}
            src={`https://docs.google.com/spreadsheets/d/${liveDoc.id}/edit?usp=sharing&embedded=true`}
            style={{ width: "100%", height: "100%", border: "none" }}
            title="QMS Function Matrix"
          />
        )}
      </div>
    </div>
  );
}

export default function TeamTab({ session, lang, t }) {
  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
        <Ic name="users" size={20} color="#028090" />
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{t.team}</h1>
      </div>

      {/* Organization Chart */}
      <OrgChart lang={lang} />

      {/* Team Members List */}
      {[["Founders", TF], ["Leadership", TL], ["Team", TM]].map(([title, people]) => (
        <div key={title} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 20, marginBottom: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>{title}</h3>
          {people.map((p) => (
            <div key={p.i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid #f8fafc" }}>
              <Av ini={p.i} col={p.c} sz={40} />
              <div><div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div><div style={{ fontSize: 12, color: "#64748b" }}>{lang === "de" ? p.roleDe : p.role}</div></div>
            </div>
          ))}
        </div>
      ))}

      {/* Function Matrix Live Document */}
      <FunctionMatrix session={session} lang={lang} />
    </div>
  );
}
