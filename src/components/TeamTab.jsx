"use client";
import { Ic, Av } from "./icons";
import { TF, TL, TM } from "../lib/dashboardHelpers";

export default function TeamTab({ lang, t }) {
  return (
    <div style={{ padding: 24, maxWidth: 700, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}><Ic name="users" size={20} color="#028090" /><h1 style={{ fontSize: 20, fontWeight: 700 }}>{t.team}</h1></div>
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
    </div>
  );
}
