"use client";
import { useState } from "react";
import { Ic } from "./icons";
import { ALL_TEAM } from "../lib/dashboardHelpers";

const CUSTOM_VALUE = "__custom__";

export default function SubmitForApprovalModal({ session, lang, t, fileId, fileName, formsheetId, onClose, onSubmitted }) {
  const [author, setAuthor] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [approver, setApprover] = useState("");
  const [customAuthor, setCustomAuthor] = useState("");
  const [customReviewer, setCustomReviewer] = useState("");
  const [customApprover, setCustomApprover] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const userEmail = session?.userEmail || session?.user?.email || "";
  const userName = session?.user?.name || userEmail;

  // Team members with email as primary identifier
  const team = ALL_TEAM.map((m) => ({
    ...m,
    uid: m.email || m.name,
  }));

  // Resolve actual value (dropdown selection or custom email)
  const resolveValue = (selectVal, customVal) => {
    if (selectVal === CUSTOM_VALUE) return customVal.trim();
    return selectVal;
  };

  const resolvedAuthor = resolveValue(author, customAuthor);
  const resolvedReviewer = resolveValue(reviewer, customReviewer);
  const resolvedApprover = resolveValue(approver, customApprover);

  const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const validate = () => {
    if (!resolvedAuthor || !resolvedReviewer || !resolvedApprover) return false;
    if (new Set([resolvedAuthor, resolvedReviewer, resolvedApprover]).size !== 3) return false;
    // Custom emails must be valid
    if (author === CUSTOM_VALUE && !isValidEmail(customAuthor.trim())) return false;
    if (reviewer === CUSTOM_VALUE && !isValidEmail(customReviewer.trim())) return false;
    if (approver === CUSTOM_VALUE && !isValidEmail(customApprover.trim())) return false;
    return true;
  };

  const findMember = (uid) => team.find((m) => m.uid === uid);

  const handleSubmit = async () => {
    if (!validate()) {
      setError(lang === "de"
        ? "Bitte alle 3 verschiedenen Unterzeichner auswählen. Manuelle E-Mails müssen gültig sein."
        : "Please select 3 different signatories. Custom emails must be valid.");
      return;
    }

    setLoading(true);
    setError("");

    const authorMember = findMember(resolvedAuthor);
    const reviewerMember = findMember(resolvedReviewer);
    const approverMember = findMember(resolvedApprover);

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
          signatoryAuthor: resolvedAuthor,
          signatoryAuthorName: authorMember?.name || resolvedAuthor,
          signatoryReviewer: resolvedReviewer,
          signatoryReviewerName: reviewerMember?.name || resolvedReviewer,
          signatoryApprover: resolvedApprover,
          signatoryApproverName: approverMember?.name || resolvedApprover,
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

  const renderSelect = (label, icon, selectVal, onSelectChange, customVal, onCustomChange, excludeUids) => {
    const options = team.filter((m) => !excludeUids.includes(m.uid));
    const isCustom = selectVal === CUSTOM_VALUE;
    return (
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
          {icon} {label}
        </label>
        <select
          value={selectVal}
          onChange={(e) => { onSelectChange(e.target.value); setError(""); }}
          style={{
            width: "100%", padding: "9px 10px", fontSize: 13, borderRadius: isCustom ? "6px 6px 0 0" : 6,
            border: `1px solid ${selectVal && selectVal !== CUSTOM_VALUE ? "#028090" : isCustom ? "#D97706" : "#D1D5DB"}`,
            borderBottom: isCustom ? "none" : undefined,
            background: "#fff", color: selectVal ? "#1E293B" : "#6B7280", cursor: "pointer",
          }}
        >
          <option value="">{lang === "de" ? "— Bitte auswählen —" : "— Please select —"}</option>
          {options.map((m) => (
            <option key={m.uid} value={m.uid}>
              {m.name} — {m.email ? m.email : (lang === "de" ? "(keine E-Mail)" : "(no email)")}
            </option>
          ))}
          <option value={CUSTOM_VALUE}>
            {lang === "de" ? "✉ Manuelle E-Mail-Adresse eingeben..." : "✉ Enter email manually..."}
          </option>
        </select>
        {isCustom && (
          <input
            type="email"
            placeholder={lang === "de" ? "E-Mail-Adresse eingeben..." : "Enter email address..."}
            value={customVal}
            onChange={(e) => { onCustomChange(e.target.value); setError(""); }}
            autoFocus
            style={{
              width: "100%", padding: "9px 10px", fontSize: 13,
              borderRadius: "0 0 6px 6px",
              border: `1px solid ${customVal && isValidEmail(customVal.trim()) ? "#028090" : "#D97706"}`,
              background: "#FFFBEB", boxSizing: "border-box",
              outline: "none",
            }}
          />
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
        background: "#fff", borderRadius: 12, padding: 24, width: 440,
        boxShadow: "0 8px 32px rgba(0,0,0,0.15)", maxHeight: "90vh", overflowY: "auto",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "#1E293B", margin: 0 }}>
            <Ic name="signature" size={18} color="#028090" /> {t.submitApproval}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <Ic name="x" size={16} color="#9CA3AF" />
          </button>
        </div>

        {/* Document info */}
        <div style={{
          padding: "10px 14px", background: "#F0FDFA", borderRadius: 8, marginBottom: 16,
          fontSize: 13, color: "#028090", fontWeight: 500, display: "flex", alignItems: "center", gap: 6,
        }}>
          <Ic name="file" size={14} color="#028090" /> {fileName}
        </div>

        {/* Signing order info */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6, marginBottom: 16,
          padding: "8px 12px", background: "#F8FAFC", borderRadius: 6, border: "1px solid #E5E7EB",
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

        {/* Signatory selection dropdowns */}
        {renderSelect(
          lang === "de" ? "Ersteller (Author)" : "Author",
          "①",
          author, setAuthor,
          customAuthor, setCustomAuthor,
          [resolvedReviewer, resolvedApprover].filter(Boolean)
        )}
        {renderSelect(
          lang === "de" ? "Prüfer (Reviewer)" : "Reviewer",
          "②",
          reviewer, setReviewer,
          customReviewer, setCustomReviewer,
          [resolvedAuthor, resolvedApprover].filter(Boolean)
        )}
        {renderSelect(
          lang === "de" ? "Freigeber (Approver)" : "Approver",
          "③",
          approver, setApprover,
          customApprover, setCustomApprover,
          [resolvedAuthor, resolvedReviewer].filter(Boolean)
        )}

        {error && (
          <div style={{ padding: "6px 10px", background: "#FEF2F2", borderRadius: 6, fontSize: 12, color: "#DC2626", marginBottom: 10 }}>
            {error}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
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
