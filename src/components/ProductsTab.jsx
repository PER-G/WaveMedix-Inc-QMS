"use client";
import { Ic } from "./icons";
import { PRODS } from "../lib/dashboardHelpers";

export default function ProductsTab({ lang, t }) {
  return (
    <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}><Ic name="box" size={20} color="#028090" /><h1 style={{ fontSize: 20, fontWeight: 700 }}>{t.prod}</h1></div>
      {PRODS.map((p) => (
        <div key={p.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 20, marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#0F2B3C", marginBottom: 4 }}>{p.name}</h3>
          <p style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>{lang === "de" ? p.desc : p.descEn}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ fontSize: 11, background: "#eff6ff", color: "#3b82f6", padding: "3px 10px", borderRadius: 4 }}>{p.cls}</span>
            <span style={{ fontSize: 11, background: "#fef3c7", color: "#d97706", padding: "3px 10px", borderRadius: 4 }}>{p.reg}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
