"use client";
import { useState } from "react";
import { Ic } from "./icons";
import { ALL_TEAM } from "../lib/dashboardHelpers";

const CUSTOM_VALUE = "__custom__";

// Each signatory now has 3 fields: email, name, position.
// For Wavemedix staff, name + position auto-fill from the team roster
// (and the Function Matrix role) but stay editable. For external signatories,
// all 3 fields are entered manually.
export default function SubmitForApprovalModal({ session, lang, t, fileId, fileName, formsheetId, onClose, onSubmitted }) {
  const userEmail = session?.userEmail || session?.user?.email || "";
  const userName = session?.user?.name || userEmail;

  // Build team list with email as primary identifier
  const team = ALL_TEAM.map((m) => ({
    ...m,
    uid: m.email || m.name,
    // Use English role as canonical position; German variant is shown in tooltip
    position: lang === "de" ? (m.roleDe || m.role) : m.role,
  }));

  const blank = () => ({
    select: "",      // dropdown value: uid of team member, "__custom__", or ""
    email: "",       // custom email (when select === CUSTOM_VALUE) or auto-filled
    name: "",        // display name (editable)
    position: "",    // Wavemedix position / external title (editable)
  });

  const [author,   setAuthor]   = useState(blank());
  const [reviewer, setReviewer] = useState(blank());
  const [approver, setApprover] = useState(blank());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const findMember = (uid) => team.find((m) => m.uid === uid);

  // Resolve when a dropdown value changes — auto-fill fields for team members
  const handleSelect = (slot, setSlot, value, peers) => {
    setError("");
    if (value === "" ) {
      setSlot(blank());
      return;
    }
    if (value === CUSTOM_VALUE) {
      setSlot({ select: CUSTOM_VALUE, email: "", name: "", position: "" });
      return;
    }
    const m = findMember(value);
    if (!m) return;
    setSlot({
      select: value,
      email: m.email || "",
      name: m.name || "",
      position: m.position || "",
    });
  };

  const updateField = (slot, setSlot, field, value) => {
    setSlot({ ...slot, [field]: value });
    setError("");
  };

  // Used email for uniqueness validation
  const slotEmail = (s) => (s.email || "").trim().toLowerCase();

  const validate = () => {
    const sa = slotEmail(author);
    const sr = slotEmail(reviewer);
    const sp = slotEmail(approver);
    if (!sa || !sr || !sp) return false;
    if (!isValidEmail(sa) || !isValidEmail(sr) || !isValidEmail(sp)) return false;
    if (new Set([sa, sr, sp]).size !== 3) return false;
    // Name + Position required for all three (auto-filled for team)
    for (const s of [author, reviewer, approver]) {
      if (!s.name.trim() || !s.position.trim()) return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      setError(lang === "de"
        ? "Bitte alle 3 Unterzeichner mit gültiger E-Mail, Name und Position auswählen (alle drei müssen verschieden sein)."
        : "Please select all 3 signatories with a valid email, name and position (all three must differ).");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/approval", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-access-token": session.accessToken,
        },
        body: JSON.stringify({
          action: "submit",
          fileId,
          fileName,
          formsheetId: formsheetId || "",
          authorEmail: userEmail,
          authorName: userName,
          signatoryAuthor:           author.email.trim(),
          signatoryAuthorName:       author.name.trim(),
          signatoryAuthorPosition:   author.position.trim(),
          signatoryReviewer:         reviewer.email.trim(),
          signatoryReviewerName:     reviewer.name.trim(),
          signatoryReviewerPosition: reviewer.position.trim(),
          signatoryApprover:         approver.email.trim(),
          signatoryApproverName:     approver.name.trim(),
          signatoryApproverPosition: approver.position.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Error submitting approval request");
        return;
      }

      setSuccess(true);
      if (onSubmitted) onSubmitted(data);
      setTimeout(() => onClose(), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Render one signatory section ──
  const renderSignatory = (slot, setSlot, index, label, peers) => {
    const isCustom = slot.select === CUSTOM_VALUE;
    const isTeamSelected = slot.select && slot.select !== CUSTOM_VALUE && slot.select !== "";
    const usedEmails = peers.map(slotEmail).filter(Boolean);
    const conflict = slotEmail(slot) && usedEmails.includes(slotEmail(slot));
    const options = team.filter((m) => !usedEmails.includes((m.email || "").toLowerCase()));

    const stepColor = ["#028090", "#0369A1", "#7C3AED"][index] || "#028090";
    const stepBg    = ["#F0FDFA", "#EFF6FF", "#FAF5FF"][index] || "#F0FDFA";

    return (
      <div style={{
        border: `1px solid ${slot.select ? stepColor + "55" : "#E5E7EB"}`,
        borderRadius: 8, padding: "10px 12px", marginBottom: 12, background: slot.select ? stepBg : "#FAFAFA",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 22, height: 22, borderRadius: 11, background: stepColor, color: "#fff",
            fontSize: 11, fontWeight: 700,
          }}>{index + 1}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1E293B" }}>{label}</span>
        </div>

        {/* Dropdown: pick from team or "custom" */}
        <select
          value={slot.select}
          onChange={(e) => handleSelect(slot, setSlot, e.target.value, peers)}
          style={{
            width: "100%", padding: "7px 8px", fontSize: 12, borderRadius: 5,
            border: `1px solid ${isTeamSelected ? stepColor : isCustom ? "#D97706" : "#D1D5DB"}`,
            background: "#fff", color: slot.select ? "#1E293B" : "#6B7280", cursor: "pointer",
            marginBottom: 8,
          }}
        >
          <option value="">{lang === "de" ? "— Person auswählen —" : "— Select person —"}</option>
          <optgroup label={lang === "de" ? "Wavemedix Team" : "Wavemedix Team"}>
            {options.map((m) => (
              <option key={m.uid} value={m.uid}>
                {m.name} · {m.position}
              </option>
            ))}
          </optgroup>
          <option value={CUSTOM_VALUE}>
            {lang === "de" ? "✉ Externe Person (manuell eingeben)" : "✉ External person (manual entry)"}
          </option>
        </select>

        {/* Email, Name, Position inputs */}
        {(isCustom || isTeamSelected) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Field label={lang === "de" ? "E-Mail" : "Email"} required
                   value={slot.email}
                   onChange={(v) => updateField(slot, setSlot, "email", v)}
                   placeholder="name@example.com"
                   type="email"
                   invalid={!!slot.email && !isValidEmail(slot.email.trim())}
                   conflict={conflict}
                   icon="mail" />
            <Field label={lang === "de" ? "Name" : "Name"} required
                   value={slot.name}
                   onChange={(v) => updateField(slot, setSlot, "name", v)}
                   placeholder={lang === "de" ? "Vorname Nachname" : "First Last"}
                   icon="user" />
            <Field label={lang === "de" ? "Position" : "Position"} required
                   value={slot.position}
                   onChange={(v) => updateField(slot, setSlot, "position", v)}
                   placeholder={lang === "de" ? "z.B. Director Quality & RA" : "e.g. Director Quality & RA"}
                   icon="badge"
                   hint={isTeamSelected ? (lang === "de" ? "Aus Function Matrix vorausgefüllt – editierbar" : "Pre-filled from Function Matrix – editable") : ""} />
          </div>
        )}

        {conflict && (
          <div style={{ marginTop: 6, fontSize: 11, color: "#DC2626" }}>
            {lang === "de"
              ? "⚠ Diese E-Mail wird bereits für einen anderen Unterzeichner verwendet."
              : "⚠ This email is already used for another signatory."}
          </div>
        )}
      </div>
    );
  };

  if (success) {
    return (
      <div style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex",
        alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}>
        <div style={{
          background: "#fff", borderRadius: 12, padding: 24, width: 380,
          textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
        }}>
          <Ic name="check" size={32} color="#059669" />
          <p style={{ fontSize: 14, fontWeight: 600, color: "#059669", marginTop: 8 }}>
            {lang === "de" ? "Genehmigungsantrag gesendet!" : "Submitted for Approval!"}
          </p>
          <p style={{ fontSize: 12, color: "#6B7280", marginTop: 4 }}>
            {lang === "de" ? "Die Unterzeichner werden benachrichtigt." : "Signatories will be notified."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}
    onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "#fff", borderRadius: 12, padding: 22, width: 480,
        boxShadow: "0 8px 32px rgba(0,0,0,0.15)", maxHeight: "92vh", overflowY: "auto",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "#1E293B", margin: 0 }}>
            <Ic name="signature" size={18} color="#028090" /> {t.submitApproval}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <Ic name="x" size={16} color="#9CA3AF" />
          </button>
        </div>

        {/* Document info */}
        <div style={{
          padding: "9px 12px", background: "#F0FDFA", borderRadius: 8, marginBottom: 14,
          fontSize: 12, color: "#028090", fontWeight: 500, display: "flex", alignItems: "center", gap: 6,
        }}>
          <Ic name="file" size={14} color="#028090" /> {fileName}
        </div>

        {/* Signing order info */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6, marginBottom: 14,
          padding: "7px 11px", background: "#F8FAFC", borderRadius: 6, border: "1px solid #E5E7EB",
        }}>
          <div style={{ fontSize: 11, color: "#6B7280" }}>
            <strong style={{ color: "#374151" }}>
              {lang === "de" ? "Reihenfolge:" : "Signing Order:"}
            </strong>{" "}
            {lang === "de"
              ? "Ersteller → Prüfer → Freigeber (sequenziell)"
              : "Author → Reviewer → Approver (sequential)"}
          </div>
        </div>

        {renderSignatory(author,   setAuthor,   0,
          lang === "de" ? "Ersteller (Author)" : "Author",
          [reviewer, approver])}
        {renderSignatory(reviewer, setReviewer, 1,
          lang === "de" ? "Prüfer (Reviewer)" : "Reviewer",
          [author, approver])}
        {renderSignatory(approver, setApprover, 2,
          lang === "de" ? "Freigeber (Approver)" : "Approver",
          [author, reviewer])}

        {error && (
          <div style={{ padding: "6px 10px", background: "#FEF2F2", borderRadius: 6, fontSize: 12, color: "#DC2626", marginBottom: 10 }}>
            {error}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            onClick={handleSubmit}
            disabled={loading || !validate()}
            style={{
              flex: 1, padding: "10px 16px", fontSize: 13, fontWeight: 600, borderRadius: 6,
              border: "none", background: validate() ? "#028090" : "#D1D5DB",
              color: "#fff", cursor: validate() ? "pointer" : "not-allowed",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "..." : (lang === "de" ? "Genehmigung einreichen" : t.submitApproval)}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: "10px 16px", fontSize: 13, borderRadius: 6,
              border: "1px solid #D1D5DB", background: "#fff", color: "#374151", cursor: "pointer",
            }}
          >
            {lang === "de" ? "Abbrechen" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Small labelled input
function Field({ label, value, onChange, placeholder, type = "text", required, invalid, conflict, hint, icon }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: "#374151", textTransform: "uppercase", letterSpacing: 0.3 }}>
          {label}{required && <span style={{ color: "#DC2626" }}> *</span>}
        </span>
        {hint && (
          <span style={{ fontSize: 10, color: "#94A3B8", fontStyle: "italic" }}>· {hint}</span>
        )}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%", padding: "6px 9px", fontSize: 12, borderRadius: 5,
          border: `1px solid ${invalid || conflict ? "#DC2626" : "#D1D5DB"}`,
          background: "#fff", boxSizing: "border-box", outline: "none",
        }}
      />
    </div>
  );
}
