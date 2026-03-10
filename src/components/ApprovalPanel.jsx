"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { Ic } from "./icons";
import SubmitForApprovalModal from "./SubmitForApprovalModal";

const ALLOWED_EXTENSIONS = [".pdf"];
const FOLDER_KEYS = ["qmh", "development", "operations"];
const FOLDER_LABELS = { qmh: "QMH", development: "Development", operations: "Operations" };

export default function ApprovalPanel({ session, lang, t, files, folderIds, onFilesChanged }) {
  const [pending, setPending] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adobeSignEnabled, setAdobeSignEnabled] = useState(false);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  // ── New Approval Request state ──
  const [showNew, setShowNew] = useState(false);
  const [sourceMode, setSourceMode] = useState(null); // "workspace" | "upload"
  const [search, setSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [targetFolder, setTargetFolder] = useState("qmh");
  const [approvalModal, setApprovalModal] = useState(null);

  // Workspace folder browsing
  const [browseFolder, setBrowseFolder] = useState("qmh");
  const [folderFilesCache, setFolderFilesCache] = useState({ qmh: null, development: null, operations: null });
  const [folderLoading, setFolderLoading] = useState(false);

  // Upload state
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef(null);

  const userEmail = session?.userEmail || session?.user?.email || "";
  const userName = session?.user?.name || userEmail;

  // ── Seed QMH files from parent prop ──
  useEffect(() => {
    if (files && files.length > 0 && !folderFilesCache.qmh) {
      setFolderFilesCache((prev) => ({ ...prev, qmh: files }));
    }
  }, [files]);

  // ── Fetch folder files on demand ──
  const loadFolderFiles = useCallback(async (folderKey) => {
    // QMH = root files already passed via props
    if (folderKey === "qmh") {
      if (!folderFilesCache.qmh && files) {
        setFolderFilesCache((prev) => ({ ...prev, qmh: files }));
      }
      return;
    }

    const fId = folderIds?.[folderKey];
    if (!fId) return;
    if (folderFilesCache[folderKey]) return; // already loaded

    setFolderLoading(true);
    try {
      const res = await fetch(`/api/drive?folderId=${fId}`, {
        headers: { "x-access-token": session.accessToken },
      });
      const data = await res.json();
      setFolderFilesCache((prev) => ({ ...prev, [folderKey]: data.files || [] }));
    } catch (err) {
      console.error(`[APPROVALS] Failed to load ${folderKey} files:`, err);
      setFolderFilesCache((prev) => ({ ...prev, [folderKey]: [] }));
    } finally {
      setFolderLoading(false);
    }
  }, [session?.accessToken, folderIds, files, folderFilesCache]);

  // ── Load files when folder tab changes ──
  useEffect(() => {
    if (sourceMode === "workspace" && browseFolder) {
      loadFolderFiles(browseFolder);
    }
  }, [sourceMode, browseFolder, loadFolderFiles]);

  const fetchApprovals = useCallback(async () => {
    try {
      const res = await fetch(`/api/approval?userEmail=${encodeURIComponent(userEmail)}&userName=${encodeURIComponent(userName)}`, {
        headers: { "x-access-token": session.accessToken },
      });
      const data = await res.json();
      if (data.pending) setPending(data.pending);
      if (data.history) setHistory(data.history);
      if (data.adobeSignEnabled !== undefined) setAdobeSignEnabled(data.adobeSignEnabled);
    } catch (err) {
      console.error("[APPROVALS] Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [session?.accessToken, userEmail]);

  useEffect(() => {
    fetchApprovals();
    const interval = setInterval(fetchApprovals, 60000);
    return () => clearInterval(interval);
  }, [fetchApprovals]);

  const postAction = async (action, body) => {
    setActionLoading(body.requestId || action);
    try {
      const res = await fetch("/api/approval", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-access-token": session.accessToken,
        },
        body: JSON.stringify({
          ...body,
          action,
          actorEmail: userEmail,
          actorName: userName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Error");
        return;
      }
      await fetchApprovals();
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const matchesUser = (signatory) => {
    if (!signatory) return false;
    if (signatory === userEmail) return true;
    if (signatory === userName) return true;
    return false;
  };

  const canSign = (req) => {
    if (adobeSignEnabled) return false;
    if (matchesUser(req.signatoryAuthor) && !req.signedAuthor) return true;
    if (matchesUser(req.signatoryReviewer) && !req.signedReviewer && req.signedAuthor) return true;
    if (matchesUser(req.signatoryApprover) && !req.signedApprover && req.signedAuthor && req.signedReviewer) return true;
    return false;
  };

  const isNextSigner = (req, role) => {
    if (role === "author") return !req.signedAuthor;
    if (role === "reviewer") return req.signedAuthor && !req.signedReviewer;
    if (role === "approver") return req.signedAuthor && req.signedReviewer && !req.signedApprover;
    return false;
  };

  const fmtDate = (iso) => {
    if (!iso) return "\u2014";
    return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const statusColor = (status) => {
    switch (status) {
      case "APPROVED": return "#059669";
      case "REJECTED": return "#DC2626";
      case "EXPIRED": case "OBSOLETE": return "#9CA3AF";
      case "SUPERSEDED": return "#D97706";
      case "WITHDRAWN": return "#6B7280";
      default: return "#028090";
    }
  };

  // ── Upload handling ──
  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const droppedFiles = e.dataTransfer?.files;
    if (droppedFiles?.length) await uploadFile(droppedFiles[0]);
  };

  const handleFileSelect = async (e) => {
    const selectedFiles = e.target.files;
    if (selectedFiles?.length) await uploadFile(selectedFiles[0]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const uploadFile = async (file) => {
    setUploadError("");
    const ext = "." + file.name.split(".").pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setUploadError(lang === "de" ? "Nur PDF-Dateien erlaubt." : "Only PDF files allowed.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setUploadError(lang === "de" ? "Datei zu groß. Maximal 25 MB." : "File too large. Maximum size: 25 MB");
      return;
    }

    const folderId = folderIds?.[targetFolder] || "";
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folderId", folderId);
      formData.append("convert", "false");
      formData.append("uploaderEmail", userEmail);
      formData.append("uploaderName", userName);

      const res = await fetch("/api/drive/upload", {
        method: "POST",
        headers: { "x-access-token": session.accessToken },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || "Upload failed");
        return;
      }
      setSelectedFile({ id: data.file.id, name: data.file.name, webViewLink: data.file.webViewLink });
      if (onFilesChanged) onFilesChanged();
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  };

  // ── Workspace file filtering (PDFs only) ──
  const currentFolderFiles = folderFilesCache[browseFolder] || [];
  const filteredFiles = currentFolderFiles.filter((f) => {
    if (f.isOld) return false;
    if (!f.name) return false;
    const isPdf = f.name.toLowerCase().endsWith(".pdf") || f.mimeType === "application/pdf";
    if (!isPdf) return false;
    if (search) return f.name.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  const resetNewApproval = () => {
    setShowNew(false);
    setSourceMode(null);
    setSearch("");
    setSelectedFile(null);
    setTargetFolder("qmh");
    setBrowseFolder("qmh");
    setUploadError("");
    setIsDragging(false);
  };

  if (loading) {
    return <div style={{ padding: 24, color: "#6B7280" }}>{t.loading || "Loading..."}</div>;
  }

  return (
    <div style={{ padding: "16px 20px" }}>

      {/* ═══ NEW APPROVAL REQUEST ═══ */}
      {!approvalModal && (
        <div style={{ marginBottom: 20 }}>
          {!showNew ? (
            <button
              onClick={() => setShowNew(true)}
              style={{
                width: "100%", padding: "12px 16px", fontSize: 14, fontWeight: 600, borderRadius: 8,
                border: "2px dashed #028090", background: "#F0FDFA", color: "#028090", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              <Ic name="signature" size={18} color="#028090" />
              {lang === "de" ? "Neuen Genehmigungsantrag starten" : "Start New Approval Request"}
            </button>
          ) : (
            <div style={{
              border: "1px solid #028090", borderRadius: 10, padding: 16, background: "#FAFFFE",
            }}>
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#1E293B" }}>
                  <Ic name="signature" size={15} color="#028090" />{" "}
                  {lang === "de" ? "Neuer Genehmigungsantrag" : "New Approval Request"}
                </h4>
                <button onClick={resetNewApproval} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                  <Ic name="x" size={14} color="#9CA3AF" />
                </button>
              </div>

              {/* Step: File already selected → show confirmation */}
              {selectedFile ? (
                <div>
                  <div style={{
                    padding: "10px 14px", background: "#ECFDF5", borderRadius: 8, marginBottom: 12,
                    display: "flex", alignItems: "center", gap: 8,
                  }}>
                    <Ic name="check" size={16} color="#059669" />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#065F46" }}>{selectedFile.name}</div>
                      <div style={{ fontSize: 11, color: "#6B7280" }}>
                        {lang === "de" ? "Bereit zur Genehmigung" : "Ready for approval"}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => setApprovalModal(selectedFile)}
                      style={{
                        flex: 1, padding: "8px 16px", fontSize: 13, fontWeight: 600, borderRadius: 6,
                        border: "none", background: "#028090", color: "#fff", cursor: "pointer",
                      }}
                    >
                      <Ic name="signature" size={14} color="#fff" />{" "}
                      {t.submitApproval}
                    </button>
                    <button
                      onClick={resetNewApproval}
                      style={{
                        padding: "8px 16px", fontSize: 13, borderRadius: 6,
                        border: "1px solid #D1D5DB", background: "#fff", color: "#374151", cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : !sourceMode ? (
                /* Step: Choose source */
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    onClick={() => setSourceMode("workspace")}
                    style={{
                      flex: 1, padding: "14px 12px", borderRadius: 8, cursor: "pointer",
                      border: "1px solid #E5E7EB", background: "#fff", textAlign: "center",
                    }}
                  >
                    <Ic name="file" size={22} color="#028090" />
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1E293B", marginTop: 6 }}>
                      {lang === "de" ? "Aus Workspace" : "From Workspace"}
                    </div>
                    <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>
                      {lang === "de" ? "PDF aus Ordner auswählen" : "Select PDF from folder"}
                    </div>
                  </button>
                  <button
                    onClick={() => setSourceMode("upload")}
                    style={{
                      flex: 1, padding: "14px 12px", borderRadius: 8, cursor: "pointer",
                      border: "1px solid #E5E7EB", background: "#fff", textAlign: "center",
                    }}
                  >
                    <Ic name="upload" size={22} color="#028090" />
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1E293B", marginTop: 6 }}>
                      {lang === "de" ? "PDF hochladen" : "Upload PDF"}
                    </div>
                    <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>
                      {lang === "de" ? "Lokal oder Drag & Drop" : "Local or Drag & Drop"}
                    </div>
                  </button>
                </div>
              ) : sourceMode === "workspace" ? (
                /* Step: Workspace folder browser */
                <div>
                  <button onClick={() => setSourceMode(null)} style={{
                    fontSize: 12, color: "#028090", background: "none", border: "none", cursor: "pointer", marginBottom: 10, padding: 0,
                  }}>
                    &larr; {lang === "de" ? "Zurück" : "Back"}
                  </button>

                  {/* Folder tabs */}
                  <div style={{ display: "flex", gap: 0, marginBottom: 10, borderBottom: "2px solid #E5E7EB" }}>
                    {FOLDER_KEYS.map((key) => (
                      <button
                        key={key}
                        onClick={() => { setBrowseFolder(key); setSearch(""); }}
                        style={{
                          flex: 1, padding: "8px 10px", fontSize: 12, fontWeight: browseFolder === key ? 600 : 400,
                          border: "none", cursor: "pointer",
                          borderBottom: browseFolder === key ? "2px solid #028090" : "2px solid transparent",
                          marginBottom: -2,
                          background: browseFolder === key ? "#F0FDFA" : "transparent",
                          color: browseFolder === key ? "#028090" : "#6B7280",
                          borderRadius: "6px 6px 0 0",
                        }}
                      >
                        {FOLDER_LABELS[key]}
                      </button>
                    ))}
                  </div>

                  {/* Search */}
                  <input
                    type="text"
                    placeholder={lang === "de" ? "PDF suchen..." : "Search PDFs..."}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{
                      width: "100%", padding: "7px 10px", fontSize: 13, borderRadius: 6,
                      border: "1px solid #D1D5DB", marginBottom: 8, boxSizing: "border-box",
                    }}
                  />

                  {/* File list */}
                  <div style={{
                    maxHeight: 240, overflowY: "auto", border: "1px solid #E5E7EB", borderRadius: 6,
                    background: "#fff",
                  }}>
                    {folderLoading ? (
                      <div style={{ padding: 16, textAlign: "center", color: "#028090", fontSize: 12 }}>
                        <Ic name="loader" size={16} color="#028090" />
                        <div style={{ marginTop: 4 }}>{lang === "de" ? "Lade Dateien..." : "Loading files..."}</div>
                      </div>
                    ) : !folderIds?.[browseFolder] && browseFolder !== "qmh" ? (
                      <div style={{ padding: 16, textAlign: "center", color: "#D97706", fontSize: 12 }}>
                        {lang === "de"
                          ? `${FOLDER_LABELS[browseFolder]}-Ordner ist noch nicht eingerichtet. Bitte zuerst den Tab "${FOLDER_LABELS[browseFolder]}" im Dashboard öffnen.`
                          : `${FOLDER_LABELS[browseFolder]} folder not set up yet. Please open the "${FOLDER_LABELS[browseFolder]}" tab in Dashboard first.`}
                      </div>
                    ) : filteredFiles.length === 0 ? (
                      <div style={{ padding: 16, textAlign: "center", color: "#9CA3AF", fontSize: 12 }}>
                        {lang === "de"
                          ? `Keine PDFs in ${FOLDER_LABELS[browseFolder]} gefunden`
                          : `No PDFs found in ${FOLDER_LABELS[browseFolder]}`}
                      </div>
                    ) : (
                      filteredFiles.slice(0, 50).map((f) => (
                        <div
                          key={f.id}
                          onClick={() => setSelectedFile({ id: f.id, name: f.name, webViewLink: f.webViewLink })}
                          style={{
                            padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid #F3F4F6",
                            display: "flex", alignItems: "center", gap: 8, fontSize: 12,
                            background: "#fff",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "#F0FDFA"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                        >
                          <div style={{ width: 28, height: 28, borderRadius: 6, background: "#FEE2E2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#DC2626" }}>PDF</span>
                          </div>
                          <div style={{ flex: 1, overflow: "hidden" }}>
                            <div style={{ fontWeight: 500, color: "#1E293B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {f.name}
                            </div>
                            <div style={{ fontSize: 10, color: "#9CA3AF" }}>
                              {fmtDate(f.modifiedTime)}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                /* Step: Upload mode */
                <div>
                  <button onClick={() => setSourceMode(null)} style={{
                    fontSize: 12, color: "#028090", background: "none", border: "none", cursor: "pointer", marginBottom: 10, padding: 0,
                  }}>
                    &larr; {lang === "de" ? "Zurück" : "Back"}
                  </button>

                  {/* Folder selector */}
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
                      {lang === "de" ? "Speichern in:" : "Save to:"}
                    </label>
                    <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #E5E7EB" }}>
                      {FOLDER_KEYS.map((key) => (
                        <button
                          key={key}
                          onClick={() => setTargetFolder(key)}
                          style={{
                            flex: 1, padding: "8px 10px", fontSize: 12, fontWeight: targetFolder === key ? 600 : 400,
                            border: "none", cursor: "pointer",
                            borderBottom: targetFolder === key ? "2px solid #028090" : "2px solid transparent",
                            marginBottom: -2,
                            background: targetFolder === key ? "#F0FDFA" : "transparent",
                            color: targetFolder === key ? "#028090" : "#6B7280",
                            borderRadius: "6px 6px 0 0",
                          }}
                        >
                          {FOLDER_LABELS[key]}
                        </button>
                      ))}
                    </div>
                    {!folderIds?.[targetFolder] && targetFolder !== "qmh" && (
                      <div style={{ fontSize: 11, color: "#D97706", marginTop: 6 }}>
                        {lang === "de" ? "Ordner noch nicht eingerichtet" : "Folder not set up yet"}
                      </div>
                    )}
                  </div>

                  {/* Drag & Drop zone */}
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      border: `2px dashed ${isDragging ? "#028090" : "#D1D5DB"}`,
                      borderRadius: 8, padding: "24px 12px", textAlign: "center", cursor: "pointer",
                      background: isDragging ? "#F0FDFA" : "#FAFAFA", transition: "all 0.2s",
                    }}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf"
                      onChange={handleFileSelect}
                      style={{ display: "none" }}
                    />
                    {uploading ? (
                      <div style={{ color: "#028090", fontSize: 13 }}>
                        <Ic name="loader" size={20} color="#028090" />
                        <div style={{ marginTop: 4 }}>{t.uploading}</div>
                      </div>
                    ) : (
                      <div style={{ color: "#6B7280", fontSize: 12 }}>
                        <Ic name="upload" size={24} color="#9CA3AF" />
                        <div style={{ marginTop: 6, fontWeight: 500 }}>{t.dropHere}</div>
                        <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 2 }}>
                          {lang === "de" ? "Nur PDF-Dateien (max 25 MB)" : "PDF files only (max 25 MB)"}
                        </div>
                      </div>
                    )}
                  </div>

                  {uploadError && (
                    <div style={{ marginTop: 6, padding: "6px 10px", background: "#FEF2F2", borderRadius: 6, fontSize: 12, color: "#DC2626" }}>
                      {uploadError}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ SUBMIT FOR APPROVAL MODAL ═══ */}
      {approvalModal && (
        <SubmitForApprovalModal
          session={session}
          lang={lang}
          t={t}
          fileId={approvalModal.id}
          fileName={approvalModal.name}
          formsheetId=""
          onClose={() => { setApprovalModal(null); resetNewApproval(); }}
          onSubmitted={() => { fetchApprovals(); if (onFilesChanged) onFilesChanged(); }}
        />
      )}

      {/* ═══ PENDING APPROVALS ═══ */}
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "#1E293B" }}>
        <Ic name="signature" size={16} color="#028090" />{" "}
        {t.approvals} ({pending.length})
      </h3>

      {pending.length === 0 && (
        <div style={{ padding: "24px 16px", textAlign: "center", color: "#9CA3AF", fontSize: 13, border: "1px dashed #E5E7EB", borderRadius: 8 }}>
          {t.noApprovals}
        </div>
      )}

      {pending.map((req) => (
        <div key={req.requestId} style={{
          border: "1px solid #E5E7EB", borderRadius: 8, padding: 14, marginBottom: 10,
          background: "#fff",
        }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: "#1E293B" }}>{req.fileName}</div>
              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                {t.submittedBy}: {req.authorName} | {fmtDate(req.submittedAt)}
                {req.version && ` | V${req.version}`}
              </div>
            </div>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 12,
              background: `${statusColor(req.status)}15`, color: statusColor(req.status),
            }}>
              {req.status}
            </span>
          </div>

          {/* Signature Slots */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            {[
              { role: "author", label: t.author, email: req.signatoryAuthor, signed: req.signedAuthor },
              { role: "reviewer", label: t.reviewer, email: req.signatoryReviewer, signed: req.signedReviewer },
              { role: "approver", label: t.approver, email: req.signatoryApprover, signed: req.signedApprover },
            ].map(({ role, label, email, signed }) => (
              <div key={role} style={{
                flex: 1, padding: "6px 8px", borderRadius: 6, fontSize: 11,
                border: `1px solid ${signed ? "#05966930" : isNextSigner(req, role) ? "#028090" : "#E5E7EB"}`,
                background: signed ? "#ECFDF5" : isNextSigner(req, role) ? "#F0FDFA" : "#F9FAFB",
              }}>
                <div style={{ fontWeight: 600, color: "#374151", marginBottom: 2 }}>{label}</div>
                <div style={{ color: "#6B7280", fontSize: 10 }}>{email?.split("@")[0] || "\u2014"}</div>
                <div style={{ marginTop: 4, color: signed ? "#059669" : "#9CA3AF" }}>
                  {signed ? `Signed ${fmtDate(signed)}` : "Pending"}
                </div>
              </div>
            ))}
          </div>

          {/* Hash */}
          <div style={{ fontSize: 10, color: "#9CA3AF", fontFamily: "monospace", marginBottom: 8 }}>
            SHA-256: {req.documentHash?.substring(0, 16)}...
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 6 }}>
            {canSign(req) && (
              <button
                onClick={() => postAction("sign", { requestId: req.requestId })}
                disabled={actionLoading === req.requestId}
                style={{
                  padding: "5px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6,
                  border: "none", background: "#028090", color: "#fff", cursor: "pointer",
                }}
              >
                <Ic name="check" size={12} color="#fff" /> {t.sign}
              </button>
            )}

            {adobeSignEnabled && req.adobeAgreementId && (
              <button
                onClick={() => postAction("check-status", { requestId: req.requestId })}
                style={{
                  padding: "5px 12px", fontSize: 12, borderRadius: 6,
                  border: "1px solid #028090", background: "#fff", color: "#028090", cursor: "pointer",
                }}
              >
                Adobe Sign Status
              </button>
            )}

            <button
              onClick={() => { setRejectModal(req.requestId); setRejectReason(""); }}
              style={{
                padding: "5px 12px", fontSize: 12, borderRadius: 6,
                border: "1px solid #DC2626", background: "#fff", color: "#DC2626", cursor: "pointer",
              }}
            >
              {t.reject}
            </button>

            {req.authorEmail === userEmail && (
              <button
                onClick={() => postAction("withdraw", { requestId: req.requestId })}
                disabled={actionLoading === req.requestId}
                style={{
                  padding: "5px 12px", fontSize: 12, borderRadius: 6,
                  border: "1px solid #6B7280", background: "#fff", color: "#6B7280", cursor: "pointer",
                }}
              >
                {t.withdraw}
              </button>
            )}
          </div>

          {/* Reject modal */}
          {rejectModal === req.requestId && (
            <div style={{ marginTop: 8, padding: 8, background: "#FEF2F2", borderRadius: 6 }}>
              <input
                type="text"
                placeholder="Reason for rejection..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                style={{
                  width: "100%", padding: "6px 8px", fontSize: 12, borderRadius: 4,
                  border: "1px solid #FCA5A5", marginBottom: 6,
                }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => { postAction("reject", { requestId: req.requestId, reason: rejectReason }); setRejectModal(null); }}
                  style={{ padding: "4px 10px", fontSize: 11, borderRadius: 4, border: "none", background: "#DC2626", color: "#fff", cursor: "pointer" }}
                >
                  Confirm Reject
                </button>
                <button
                  onClick={() => setRejectModal(null)}
                  style={{ padding: "4px 10px", fontSize: 11, borderRadius: 4, border: "1px solid #ccc", background: "#fff", cursor: "pointer" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* History toggle */}
      <button
        onClick={() => setShowHistory(!showHistory)}
        style={{
          marginTop: 16, padding: "6px 12px", fontSize: 12, borderRadius: 6,
          border: "1px solid #E5E7EB", background: "#F9FAFB", cursor: "pointer", color: "#374151",
        }}
      >
        {t.history} ({history.length}) {showHistory ? "\u25B2" : "\u25BC"}
      </button>

      {showHistory && history.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {history.map((req) => (
            <div key={req.requestId} style={{
              padding: "8px 12px", borderBottom: "1px solid #F3F4F6", fontSize: 12,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div>
                <span style={{ fontWeight: 500 }}>{req.fileName}</span>
                <span style={{ color: "#9CA3AF", marginLeft: 8 }}>{fmtDate(req.finalizedAt || req.submittedAt)}</span>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 10,
                background: `${statusColor(req.status)}15`, color: statusColor(req.status),
              }}>
                {req.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
