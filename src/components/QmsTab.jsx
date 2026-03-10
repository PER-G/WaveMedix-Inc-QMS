"use client";
import { useState, useEffect } from "react";
import { Ic } from "./icons";
import { REGS } from "../lib/dashboardHelpers";

export default function QmsTab({ lang, t }) {
  const [ctx, setCtx] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    fetch("/api/context").then(r => r.json()).then(d => {
      if (!d.error) { setCtx(d); setDraft(d); }
    }).catch(() => {});
  }, []);

  function saveContext() {
    setSaving(true);
    fetch("/api/context", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    })
      .then(r => r.json())
      .then(d => {
        if (d.success) { setCtx({ ...draft, updatedAt: d.updatedAt }); setEditing(false); }
        setSaving(false);
      })
      .catch(() => setSaving(false));
  }

  function addProduct() {
    setDraft(d => ({ ...d, products: [...(d.products || []), { name: "", type: "SaMD", class: "IIa", status: "Development", description: "" }] }));
  }

  function removeProduct(idx) {
    setDraft(d => ({ ...d, products: d.products.filter((_, i) => i !== idx) }));
  }

  function updateProduct(idx, field, value) {
    setDraft(d => ({ ...d, products: d.products.map((p, i) => i === idx ? { ...p, [field]: value } : p) }));
  }

  function addTeamMember() {
    setDraft(d => ({ ...d, team: [...(d.team || []), { name: "", role: "" }] }));
  }

  function removeTeamMember(idx) {
    setDraft(d => ({ ...d, team: d.team.filter((_, i) => i !== idx) }));
  }

  function updateTeamMember(idx, field, value) {
    setDraft(d => ({ ...d, team: d.team.map((m, i) => i === idx ? { ...m, [field]: value } : m) }));
  }

  const isDE = lang === "de";

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
      <div style={{ background: "linear-gradient(135deg, #0F2B3C, #1a4a5e)", borderRadius: 12, padding: 28, marginBottom: 20, color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <Ic name="shield" size={24} color="#86efac" />
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Wavemedix Quality Manual</h1>
        </div>
        <p style={{ fontSize: 13, color: "#94a3b8" }}>ISO 13485 | FDA 21 CFR 820 | EU MDR 2017/745</p>
      </div>

      {/* Project Context Editor */}
      {ctx && (
        <div style={{ background: "#fff", border: "2px solid #028090", borderRadius: 10, padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: "linear-gradient(135deg, #028090, #10B981)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic name="bot" size={14} color="#fff" />
              </div>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{isDE ? "Projektkontext (Claude Memory)" : "Project Context (Claude Memory)"}</h3>
                <p style={{ fontSize: 10, color: "#64748b", margin: 0 }}>{isDE ? "Claude kennt diese Infos in jeder Session" : "Claude knows this info in every session"}{ctx.updatedAt ? ` \u2022 ${isDE ? "Aktualisiert" : "Updated"}: ${ctx.updatedAt}` : ""}</p>
              </div>
            </div>
            <button onClick={() => { setEditing(!editing); setDraft(ctx); }} style={{ padding: "5px 12px", background: editing ? "#f1f5f9" : "#028090", color: editing ? "#64748b" : "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
              <Ic name={editing ? "x" : "edit"} size={12} color={editing ? "#64748b" : "#fff"} />
              {editing ? (isDE ? "Abbrechen" : "Cancel") : (isDE ? "Bearbeiten" : "Edit")}
            </button>
          </div>

          {!editing ? (
            /* Read-only view */
            <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "4px 12px" }}>
                <span style={{ color: "#64748b", fontWeight: 600 }}>{isDE ? "Firma:" : "Company:"}</span>
                <span>{ctx.company}</span>
                <span style={{ color: "#64748b", fontWeight: 600 }}>{isDE ? "Phase:" : "Phase:"}</span>
                <span>{ctx.currentPhase}</span>
                <span style={{ color: "#64748b", fontWeight: 600 }}>{isDE ? "Standards:" : "Standards:"}</span>
                <span style={{ fontSize: 11 }}>{(ctx.standards || []).join(", ")}</span>
              </div>
              <div style={{ marginTop: 8 }}>
                <span style={{ color: "#64748b", fontWeight: 600 }}>{isDE ? "Produkte:" : "Products:"}</span>
                {(ctx.products || []).map((p, i) => (
                  <div key={i} style={{ marginLeft: 12, padding: "3px 0", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ background: "#ecfdf5", color: "#059669", padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600 }}>{p.class}</span>
                    <span style={{ fontWeight: 600 }}>{p.name}</span>
                    <span style={{ color: "#94a3b8" }}> \u2014 {p.type}, {p.status}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 8 }}>
                <span style={{ color: "#64748b", fontWeight: 600 }}>Team:</span>
                {(ctx.team || []).map((m, i) => (
                  <div key={i} style={{ marginLeft: 12, padding: "2px 0" }}>{m.name} \u2014 {m.role}</div>
                ))}
              </div>
            </div>
          ) : (
            /* Edit mode */
            <div style={{ fontSize: 12 }}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontWeight: 600, color: "#64748b", marginBottom: 3 }}>{isDE ? "Firma" : "Company"}</label>
                <input value={draft?.company || ""} onChange={e => setDraft(d => ({ ...d, company: e.target.value }))} style={{ width: "100%", padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 12 }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontWeight: 600, color: "#64748b", marginBottom: 3 }}>{isDE ? "Aktuelle Phase" : "Current Phase"}</label>
                <input value={draft?.currentPhase || ""} onChange={e => setDraft(d => ({ ...d, currentPhase: e.target.value }))} style={{ width: "100%", padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 12 }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontWeight: 600, color: "#64748b", marginBottom: 3 }}>Standards ({isDE ? "kommagetrennt" : "comma-separated"})</label>
                <input value={(draft?.standards || []).join(", ")} onChange={e => setDraft(d => ({ ...d, standards: e.target.value.split(",").map(s => s.trim()).filter(Boolean) }))} style={{ width: "100%", padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 12 }} />
              </div>

              {/* Products */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <label style={{ fontWeight: 600, color: "#64748b" }}>{isDE ? "Produkte" : "Products"}</label>
                  <button onClick={addProduct} style={{ padding: "3px 8px", background: "#ecfdf5", color: "#059669", border: "1px solid #bbf7d0", borderRadius: 4, fontSize: 10, cursor: "pointer" }}>+ {isDE ? "Produkt" : "Product"}</button>
                </div>
                {(draft?.products || []).map((p, i) => (
                  <div key={i} style={{ display: "flex", gap: 4, marginBottom: 4, alignItems: "center" }}>
                    <input value={p.name} onChange={e => updateProduct(i, "name", e.target.value)} placeholder="Name" style={{ flex: 2, padding: "5px 8px", border: "1px solid #e2e8f0", borderRadius: 4, fontSize: 11 }} />
                    <select value={p.type} onChange={e => updateProduct(i, "type", e.target.value)} style={{ padding: "5px 4px", border: "1px solid #e2e8f0", borderRadius: 4, fontSize: 11 }}>
                      <option value="SaMD">SaMD</option>
                      <option value="IVD">IVD</option>
                      <option value="MDD">MDD</option>
                    </select>
                    <select value={p.class} onChange={e => updateProduct(i, "class", e.target.value)} style={{ padding: "5px 4px", border: "1px solid #e2e8f0", borderRadius: 4, fontSize: 11 }}>
                      <option value="I">I</option>
                      <option value="IIa">IIa</option>
                      <option value="IIb">IIb</option>
                      <option value="III">III</option>
                    </select>
                    <select value={p.status} onChange={e => updateProduct(i, "status", e.target.value)} style={{ padding: "5px 4px", border: "1px solid #e2e8f0", borderRadius: 4, fontSize: 11 }}>
                      <option value="Concept">Concept</option>
                      <option value="Development">Development</option>
                      <option value="Validation">Validation</option>
                      <option value="Released">Released</option>
                    </select>
                    <button onClick={() => removeProduct(i)} style={{ padding: "3px 6px", background: "#fef2f2", color: "#dc2626", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 10 }}><Ic name="x" size={10} color="#dc2626" /></button>
                  </div>
                ))}
              </div>

              {/* Team */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <label style={{ fontWeight: 600, color: "#64748b" }}>Team</label>
                  <button onClick={addTeamMember} style={{ padding: "3px 8px", background: "#ecfdf5", color: "#059669", border: "1px solid #bbf7d0", borderRadius: 4, fontSize: 10, cursor: "pointer" }}>+ {isDE ? "Mitglied" : "Member"}</button>
                </div>
                {(draft?.team || []).map((m, i) => (
                  <div key={i} style={{ display: "flex", gap: 4, marginBottom: 4, alignItems: "center" }}>
                    <input value={m.name} onChange={e => updateTeamMember(i, "name", e.target.value)} placeholder="Name" style={{ flex: 1, padding: "5px 8px", border: "1px solid #e2e8f0", borderRadius: 4, fontSize: 11 }} />
                    <input value={m.role} onChange={e => updateTeamMember(i, "role", e.target.value)} placeholder={isDE ? "Rolle" : "Role"} style={{ flex: 1, padding: "5px 8px", border: "1px solid #e2e8f0", borderRadius: 4, fontSize: 11 }} />
                    <button onClick={() => removeTeamMember(i)} style={{ padding: "3px 6px", background: "#fef2f2", color: "#dc2626", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 10 }}><Ic name="x" size={10} color="#dc2626" /></button>
                  </div>
                ))}
              </div>

              {/* Key Decisions */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontWeight: 600, color: "#64748b", marginBottom: 3 }}>{isDE ? "Wichtige Entscheidungen" : "Key Decisions"} ({isDE ? "eine pro Zeile" : "one per line"})</label>
                <textarea value={(draft?.keyDecisions || []).join("\n")} onChange={e => setDraft(d => ({ ...d, keyDecisions: e.target.value.split("\n").filter(Boolean) }))} rows={3} style={{ width: "100%", padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 11, resize: "vertical" }} placeholder={isDE ? "z.B. Google Vault als DMS gewählt" : "e.g. Chose Google Vault as DMS"} />
              </div>

              <button onClick={saveContext} disabled={saving} style={{ width: "100%", padding: "8px", background: saving ? "#94a3b8" : "#10B981", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
                {saving ? (isDE ? "Speichert..." : "Saving...") : (isDE ? "Projektkontext speichern" : "Save project context")}
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 20, marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{t.stds}</h3>
        {REGS.map((r, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 12 }}><Ic name="shield" size={12} color="#028090" />{r}</div>)}
      </div>
      <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: 20, marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{t.objT}</h3>
        {t.objs.map((o, i) => <div key={i} style={{ display: "flex", gap: 6, padding: "5px 0", fontSize: 12 }}><span style={{ color: "#10B981", fontWeight: 700 }}>{"\u2713"}</span>{o}</div>)}
      </div>
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{t.prT}</h3>
        <p style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7 }}>{t.prTx}</p>
      </div>
    </div>
  );
}
