"use client";
import { useState, useRef } from "react";
import { Ic } from "./icons";

const ADOBE_SEND_URL = "https://acrobat.adobe.com/link/acrobat/sendforsignature?locale=de-DE";

// Modal: external Adobe Sign workflow.
// The QMS app does NOT have an Adobe Sign API key, so the user opens Adobe
// in a new tab, picks the PDF from Google Drive, manually configures the
// 3 signers (info copyable from this modal), and clicks "Send" in Adobe.
// Adobe handles all signer emails. When everyone has signed in Adobe, the
// user comes back and uploads the final signed PDF here to close the loop.
export default function AdobeExternalModal({ session, lang, request, onClose, onCompleted }) {
  const [step, setStep] = useState("review");       // "review" | "uploading"
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const fileRef = useRef(null);

  const userEmail = session?.userEmail || session?.user?.email || "";
  const userName  = session?.user?.name || userEmail;

  // Compile the 3 signers from the request
  const signers = [
    { role: "Author",   email: request.signatoryAuthor,   name: request.signatoryAuthorName,   position: request.signatoryAuthorPosition },
    { role: "Reviewer", email: request.signatoryReviewer, name: request.signatoryReviewerName, position: request.signatoryReviewerPosition },
    { role: "Approver", email: request.signatoryApprover, name: request.signatoryApproverName, position: request.signatoryApproverPosition },
  ];

  const allEmails = signers.map((s) => s.email).filter(Boolean).join(", ");
  const signerBlock = signers.map((s, i) =>
    `${i+1}. ${s.role}: ${s.name || ""} <${s.email || ""}>${s.position ? ` — ${s.position}` : ""}`
  ).join("\n");

  const copy = (text, label) => {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
  };

  // Mark request as out-for-signature via Adobe (status → SIGNING, notes)
  const markSentToAdobe = async () => {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-access-token": session.accessToken },
        body: JSON.stringify({
          action: "start-adobe-external",
          requestId: request.requestId,
          actorEmail: userEmail,
          actorName: userName,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Error"); return; }
      setStep("uploading");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openAdobe = () => {
    window.open(ADOBE_SEND_URL, "_blank", "noopener,noreferrer");
  };

  const onFileChoose = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError(lang === "de" ? "Nur PDF erlaubt." : "PDF only.");
      return;
    }
    setBusy(true); setError("");
    try {
      // Step 1: upload to QMS Drive (root)
      const fd = new FormData();
      fd.append("file", file);
      fd.append("convert", "false");
      fd.append("uploaderEmail", userEmail);
      fd.append("uploaderName", userName);
      const up = await fetch("/api/drive/upload", {
        method: "POST",
        headers: { "x-access-token": session.accessToken },
        body: fd,
      });
      const upData = await up.json();
      if (!up.ok) { setError(upData.error || "Upload failed"); setBusy(false); return; }
      setUploadedFile(upData.file);

      // Step 2: link to the approval request + mark APPROVED
      const fin = await fetch("/api/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-access-token": session.accessToken },
        body: JSON.stringify({
          action: "finalize-external",
          requestId: request.requestId,
          signedFileId: upData.file.id,
          signedFileName: upData.file.name,
          actorEmail: userEmail,
          actorName: userName,
        }),
      });
      const finData = await fin.json();
      if (!fin.ok) { setError(finData.error || "Finalize failed"); return; }

      if (onCompleted) onCompleted(finData);
      // Auto-close after short success display
      setTimeout(() => onClose(), 1800);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000,
               display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: 560, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto",
                    background: "#fff", borderRadius: 12, boxShadow: "0 16px 48px rgba(0,0,0,0.2)",
                    padding: 24 }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0F2B3C", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-block", width: 28, height: 28, background: "linear-gradient(135deg,#EA4C2C,#D62D20)", borderRadius: 6, color: "#fff", textAlign: "center", lineHeight: "28px", fontSize: 13, fontWeight: 800 }}>A</span>
            Send via Adobe Sign
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <Ic name="x" size={16} color="#9CA3AF" />
          </button>
        </div>
        <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 14 }}>
          {request.fileName}
        </div>

        {step === "review" && (
          <>
            {/* Steps explanation */}
            <ol style={{ paddingLeft: 18, margin: "0 0 14px", fontSize: 12.5, color: "#334155", lineHeight: 1.7 }}>
              <li>{lang === "de"
                ? <>Klick <b>„Open Adobe Sign“</b>. Adobe öffnet sich in einem neuen Tab.</>
                : <>Click <b>“Open Adobe Sign”</b>. Adobe opens in a new tab.</>}</li>
              <li>{lang === "de"
                ? <>In Adobe: Datei <b>aus Google Drive</b> wählen → das PDF aus dem QMS-Ordner.</>
                : <>In Adobe: pick the file <b>from Google Drive</b> → the PDF from the QMS folder.</>}</li>
              <li>{lang === "de"
                ? <>Die 3 Signers eintragen (Reihenfolge: Author → Reviewer → Approver) — Daten unten zum Kopieren.</>
                : <>Enter the 3 signers (order: Author → Reviewer → Approver) — copy-able info below.</>}</li>
              <li>{lang === "de"
                ? <>In Adobe „Send“ klicken. Adobe verschickt die Emails sequentiell.</>
                : <>Click “Send” in Adobe. Adobe sends the emails sequentially.</>}</li>
              <li>{lang === "de"
                ? <>Zurück hier: <b>„Markiere als an Adobe gesendet“</b> klicken.</>
                : <>Back here: click <b>“Mark as sent to Adobe”</b>.</>}</li>
            </ol>

            {/* Open Adobe + copy emails */}
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <button onClick={openAdobe}
                      style={{ flex: 1, padding: "10px 14px", fontSize: 13, fontWeight: 600,
                               border: "none", borderRadius: 6, cursor: "pointer",
                               background: "linear-gradient(135deg,#EA4C2C,#D62D20)", color: "#fff",
                               display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Ic name="open" size={13} color="#fff" />
                Open Adobe Sign
              </button>
              <button onClick={() => copy(allEmails, "emails")}
                      style={{ padding: "10px 14px", fontSize: 12, borderRadius: 6, cursor: "pointer",
                               border: "1px solid #028090", background: "#F0FDFA", color: "#028090" }}>
                {copied === "emails"
                  ? (lang === "de" ? "✓ Kopiert" : "✓ Copied")
                  : (lang === "de" ? "Alle Emails kopieren" : "Copy all emails")}
              </button>
            </div>

            {/* Signer block */}
            <div style={{ marginBottom: 10, fontSize: 11, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: 0.4 }}>
              {lang === "de" ? "Signers (für Adobe)" : "Signers (for Adobe)"}
            </div>
            <div style={{ border: "1px solid #E5E7EB", borderRadius: 8 }}>
              {signers.map((s, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                  borderBottom: i < 2 ? "1px solid #F1F5F9" : "none",
                }}>
                  <span style={{ width: 22, height: 22, borderRadius: 11, background: "#0F2B3C", color: "#fff",
                                 fontSize: 11, fontWeight: 700, textAlign: "center", lineHeight: "22px", flexShrink: 0 }}>{i+1}</span>
                  <div style={{ flex: 1, fontSize: 12 }}>
                    <div style={{ fontWeight: 600, color: "#0F2B3C" }}>{s.name || s.email}</div>
                    <div style={{ color: "#475569" }}>{s.email}</div>
                    {s.position && <div style={{ color: "#94A3B8", fontSize: 11 }}>{s.position} · <i>{s.role}</i></div>}
                  </div>
                  <button onClick={() => copy(`${s.name} <${s.email}>`, `s${i}`)}
                          style={{ padding: "4px 10px", fontSize: 11, borderRadius: 5,
                                   border: "1px solid #CBD5E1", background: "#fff", color: "#475569", cursor: "pointer", whiteSpace: "nowrap" }}>
                    {copied === `s${i}`
                      ? (lang === "de" ? "✓ Kopiert" : "✓ Copied")
                      : (lang === "de" ? "Kopieren" : "Copy")}
                  </button>
                </div>
              ))}
            </div>

            {/* Whole block copy */}
            <button onClick={() => copy(signerBlock, "block")}
                    style={{ marginTop: 8, width: "100%", padding: "8px 12px", fontSize: 12, borderRadius: 6,
                             border: "1px dashed #94A3B8", background: "#F8FAFC", color: "#475569", cursor: "pointer" }}>
              {copied === "block"
                ? (lang === "de" ? "✓ Alles in Zwischenablage" : "✓ Block copied")
                : (lang === "de" ? "Gesamten Signer-Block kopieren" : "Copy whole signer block")}
            </button>

            {error && (
              <div style={{ marginTop: 10, padding: "6px 10px", background: "#FEF2F2", borderRadius: 6, fontSize: 12, color: "#DC2626" }}>
                {error}
              </div>
            )}

            {/* Final action: mark as sent to Adobe */}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={markSentToAdobe} disabled={busy}
                      style={{ flex: 1, padding: "10px 14px", fontSize: 13, fontWeight: 600,
                               border: "none", borderRadius: 6, cursor: busy ? "wait" : "pointer",
                               background: busy ? "#94A3B8" : "#028090", color: "#fff" }}>
                {busy
                  ? (lang === "de" ? "..." : "...")
                  : (lang === "de" ? "Markiere als an Adobe gesendet" : "Mark as sent to Adobe")}
              </button>
              <button onClick={onClose}
                      style={{ padding: "10px 14px", fontSize: 13, borderRadius: 6,
                               border: "1px solid #D1D5DB", background: "#fff", color: "#374151", cursor: "pointer" }}>
                {lang === "de" ? "Schließen" : "Close"}
              </button>
            </div>
          </>
        )}

        {step === "uploading" && (
          <>
            <div style={{ padding: "10px 14px", background: "#F0FDFA", border: "1px solid #99F6E4", borderRadius: 8, fontSize: 12.5, color: "#0F766E", marginBottom: 14 }}>
              {lang === "de"
                ? <>Der Antrag ist jetzt in Adobe-Bearbeitung (Status <b>SIGNING</b>). Sobald alle 3 in Adobe unterschrieben haben, lade hier das fertig-signierte PDF hoch — die App speichert es im <code>Signed Documents</code>-Ordner und schließt den Antrag als <b>APPROVED</b>.</>
                : <>The request is now in Adobe (status <b>SIGNING</b>). Once all 3 have signed in Adobe, upload the final signed PDF here — the app will store it in the <code>Signed Documents</code> folder and close the request as <b>APPROVED</b>.</>}
            </div>

            <input
              type="file"
              accept="application/pdf,.pdf"
              ref={fileRef}
              onChange={onFileChoose}
              style={{ display: "none" }}
            />
            <button onClick={() => fileRef.current?.click()} disabled={busy}
                    style={{ width: "100%", padding: "14px 16px", fontSize: 13, fontWeight: 600,
                             border: "2px dashed #028090", borderRadius: 8, cursor: busy ? "wait" : "pointer",
                             background: "#F0FDFA", color: "#028090",
                             display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Ic name="upload" size={16} color="#028090" />
              {busy
                ? (lang === "de" ? "Lade hoch..." : "Uploading...")
                : (uploadedFile
                    ? `✓ ${uploadedFile.name}`
                    : (lang === "de" ? "Signierte PDF aus Adobe hochladen" : "Upload signed PDF from Adobe"))}
            </button>

            {error && (
              <div style={{ marginTop: 10, padding: "6px 10px", background: "#FEF2F2", borderRadius: 6, fontSize: 12, color: "#DC2626" }}>
                {error}
              </div>
            )}

            {uploadedFile && !error && (
              <div style={{ marginTop: 14, padding: "10px 14px", background: "#ECFDF5", border: "1px solid #6EE7B7", borderRadius: 8, fontSize: 12.5, color: "#065F46" }}>
                <Ic name="check" size={14} color="#059669" />{" "}
                {lang === "de"
                  ? "Erfolg — der Antrag ist abgeschlossen. Schließt sich automatisch."
                  : "Done — request closed. This dialog will close automatically."}
              </div>
            )}

            <button onClick={onClose}
                    style={{ marginTop: 14, width: "100%", padding: "8px 12px", fontSize: 12, borderRadius: 6,
                             border: "1px solid #D1D5DB", background: "#fff", color: "#374151", cursor: "pointer" }}>
              {lang === "de" ? "Später hochladen (Schließen)" : "Upload later (Close)"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
