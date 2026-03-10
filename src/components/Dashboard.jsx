"use client";
import { useState, useEffect, useCallback } from "react";
import { Ic } from "./icons";
import { TX, matchFilesToSops } from "../lib/dashboardHelpers";
import PreviewModal from "./PreviewModal";
import SopExplorer from "./SopExplorer";
import ChatSidebar from "./ChatSidebar";
import AuditTrail from "./AuditTrail";
import QmsTab from "./QmsTab";
import ProductsTab from "./ProductsTab";
import TeamTab from "./TeamTab";
import DevelopmentTab from "./DevelopmentTab";
import OperationsTab from "./OperationsTab";
import ApprovalPanel from "./ApprovalPanel";
import DropZone from "./DropZone";
import DocumentControlTab from "./DocumentControlTab";
import ChangeManagementTab from "./ChangeManagementTab";
import AuditWizard from "./AuditWizard";

/* ═══════════════════════════════════════════ */
export default function Dashboard({ session, onSignOut }) {
  const [lang, setLang] = useState("de");
  const [tab, setTab] = useState("sops");

  // QMH (SOP Explorer) state
  const [files, setFiles] = useState([]);
  const [fileMap, setFileMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Folder IDs (discovered dynamically)
  const [folderIds, setFolderIds] = useState({ qmh: null, development: null, operations: null });

  // Development state (lazy-loaded)
  const [devFiles, setDevFiles] = useState([]);
  const [devLoading, setDevLoading] = useState(false);
  const [devLoaded, setDevLoaded] = useState(false);
  const [devSettingUp, setDevSettingUp] = useState(false);

  // Operations state (lazy-loaded)
  const [opsFiles, setOpsFiles] = useState([]);
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsLoaded, setOpsLoaded] = useState(false);
  const [opsSettingUp, setOpsSettingUp] = useState(false);

  // Preview modal
  const [previewFile, setPreviewFile] = useState(null);

  // Chat sidebar
  const [chatOpen, setChatOpen] = useState(false);
  const [sopRulesLoaded, setSopRulesLoaded] = useState(false);
  const [sopRulesLoading, setSopRulesLoading] = useState(false);

  // Brain / Audit
  const [auditTrigger, setAuditTrigger] = useState(false);
  const [showAuditWizard, setShowAuditWizard] = useState(false);

  // Approval badge count
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);

  const t = TX[lang];
  const totalFileCount = files.filter((f) => !f.isOld).length;

  // ── Poll approval count ──
  useEffect(() => {
    if (!session?.accessToken) return;
    const userEmail = session?.userEmail || session?.user?.email || "";
    const uName = session?.user?.name || "";
    const fetchCount = () => {
      fetch(`/api/approval?userEmail=${encodeURIComponent(userEmail)}&userName=${encodeURIComponent(uName)}`, {
        headers: { "x-access-token": session.accessToken },
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.userPendingCount !== undefined) setPendingApprovalCount(data.userPendingCount);
          else if (data.pending) setPendingApprovalCount(data.pending.length);
        })
        .catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60000);
    return () => clearInterval(interval);
  }, [session?.accessToken]);

  // ── Helper: open in Drive ──
  function openInDrive(file) {
    if (file.webViewLink) window.open(file.webViewLink, "_blank");
  }

  // ── Fetch QMH files (initial load) ──
  useEffect(() => {
    if (!session?.accessToken) return;
    setLoading(true);
    fetch("/api/drive", { headers: { "x-access-token": session.accessToken } })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); setLoading(false); return; }
        const f = data.files || [];
        setFiles(f);
        setFileMap(matchFilesToSops(f));
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });

    // Check SOP rules
    fetch("/api/sop-rules")
      .then((r) => r.json())
      .then((data) => { if (data.count > 0) setSopRulesLoaded(true); })
      .catch(() => {});

    // Discover folder IDs
    fetch("/api/drive/folders", { headers: { "x-access-token": session.accessToken } })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { console.warn("[FOLDERS]", data.error); return; }
        setFolderIds({
          qmh: data.qmh?.id || null,
          development: data.development?.id || null,
          operations: data.operations?.id || null,
        });
      })
      .catch((e) => console.warn("[FOLDERS] Discovery failed:", e.message));
  }, [session]);

  // ── Lazy load Development files ──
  const loadDevFiles = useCallback(() => {
    if (!session?.accessToken || !folderIds.development) return;
    setDevLoading(true);
    fetch(`/api/drive?folderId=${folderIds.development}`, { headers: { "x-access-token": session.accessToken } })
      .then((r) => r.json())
      .then((data) => {
        setDevFiles(data.files || []);
        setDevLoaded(true);
        setDevLoading(false);
      })
      .catch((e) => { console.error("[DEV]", e.message); setDevLoading(false); });
  }, [session, folderIds.development]);

  // ── Lazy load Operations files ──
  const loadOpsFiles = useCallback(() => {
    if (!session?.accessToken || !folderIds.operations) return;
    setOpsLoading(true);
    fetch(`/api/drive?folderId=${folderIds.operations}`, { headers: { "x-access-token": session.accessToken } })
      .then((r) => r.json())
      .then((data) => {
        setOpsFiles(data.files || []);
        setOpsLoaded(true);
        setOpsLoading(false);
      })
      .catch((e) => { console.error("[OPS]", e.message); setOpsLoading(false); });
  }, [session, folderIds.operations]);

  // ── Setup folders (create missing subfolders in Drive) then load files ──
  const setupAndLoad = useCallback((area) => {
    if (!session?.accessToken) return;
    const setter = area === "development" ? setDevSettingUp : setOpsSettingUp;
    setter(true);
    fetch("/api/drive/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-access-token": session.accessToken },
      body: JSON.stringify({ area }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { console.error("[SETUP]", data.error); setter(false); return; }
        console.log(`[SETUP] ${area}: ${data.created} folders created, ${data.total} total`);
        // Update folder ID — areaId is always returned
        if (data.areaId) {
          setFolderIds((prev) => ({ ...prev, [area]: data.areaId }));
        }
        setter(false);
        // Now load files from the newly created/confirmed area folder
        const areaFolderId = data.areaId;
        if (areaFolderId) {
          const setFiles = area === "development" ? setDevFiles : setOpsFiles;
          const setLoaded = area === "development" ? setDevLoaded : setOpsLoaded;
          const setAreaLoading = area === "development" ? setDevLoading : setOpsLoading;
          setAreaLoading(true);
          fetch(`/api/drive?folderId=${areaFolderId}`, { headers: { "x-access-token": session.accessToken } })
            .then((r) => r.json())
            .then((d) => { setFiles(d.files || []); setLoaded(true); setAreaLoading(false); })
            .catch(() => setAreaLoading(false));
        }
      })
      .catch((e) => { console.error("[SETUP]", e.message); setter(false); });
  }, [session]);

  // ── Trigger lazy load on tab switch ──
  // If folder ID exists → load files. If not → auto-setup folders first.
  useEffect(() => {
    if (tab === "dev" && !devLoaded && !devLoading && !devSettingUp) {
      if (folderIds.development) {
        loadDevFiles();
      } else if (session?.accessToken) {
        // No Development folder found → auto-create it
        setupAndLoad("development");
      }
    }
    if (tab === "ops" && !opsLoaded && !opsLoading && !opsSettingUp) {
      if (folderIds.operations) {
        loadOpsFiles();
      } else if (session?.accessToken) {
        // No Operations folder found → auto-create it
        setupAndLoad("operations");
      }
    }
  }, [tab, devLoaded, devLoading, devSettingUp, opsLoaded, opsLoading, opsSettingUp, folderIds, loadDevFiles, loadOpsFiles, setupAndLoad, session]);

  // ── Manual setup folders (from empty-state button) ──
  function setupFolders(area) {
    setupAndLoad(area);
  }

  // ── Compute targetFolderId for context-aware saving ──
  const currentAreaFolderId = tab === "dev" ? folderIds.development : tab === "ops" ? folderIds.operations : null;

  // ── Tab definitions ──
  const tabs = [
    { id: "sops", icon: "folder", label: t.sopT },
    { id: "doccontrol", icon: "clipDoc", label: t.docControl, color: "#0369A1" },
    { id: "ecm", icon: "edit", label: t.ecm, color: "#D97706" },
    { id: "dev", icon: "zap", label: t.dev, color: "#7C3AED" },
    { id: "ops", icon: "clock", label: t.ops, color: "#028090" },
    { id: "approvals", icon: "signature", label: t.approvals, badge: pendingApprovalCount },
    { id: "audit", icon: "clock", label: t.audit },
    { id: "qms", icon: "shield", label: t.qms },
    { id: "products", icon: "box", label: t.prod },
    { id: "team", icon: "users", label: t.team },
  ];

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>

      {/* Preview Modal */}
      <PreviewModal file={previewFile} lang={lang} onClose={() => setPreviewFile(null)} onOpenInDrive={openInDrive} />

      {/* Audit Wizard */}
      {showAuditWizard && (
        <AuditWizard
          session={session} lang={lang} t={t} folderIds={folderIds}
          onClose={() => setShowAuditWizard(false)}
        />
      )}

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #0F2B3C, #1a4a5e)", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg, #10B981, #028090)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Ic name="zap" size={20} color="#fff" />
          </div>
          <div>
            <div style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>WAVEMEDIX</div>
            <div style={{ color: "#86efac", fontSize: 10, fontWeight: 500 }}>Quality Management System</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#86efac", display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: 3, background: loading ? "#f59e0b" : "#10B981" }} />
            {loading ? "..." : `${totalFileCount} files \u2713`}
          </div>
          <button onClick={() => setShowAuditWizard(true)} title={lang === "de" ? "Dokumenten-Audit" : "Document Audit"} style={{ background: showAuditWizard ? "#f59e0b" : "rgba(255,255,255,0.1)", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, color: "#fff", fontSize: 11 }}>
            <Ic name="brain" size={14} color={showAuditWizard ? "#fff" : "#fbbf24"} />
          </button>
          <button onClick={() => setChatOpen(!chatOpen)} style={{ background: chatOpen ? "#10B981" : "rgba(255,255,255,0.1)", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, color: "#fff", fontSize: 11 }}>
            <Ic name="bot" size={14} color={chatOpen ? "#fff" : "#86efac"} /> Claude
            {sopRulesLoading && <div style={{ width: 6, height: 6, borderRadius: 3, background: "#f59e0b", animation: "pulse 1s infinite" }} title="SOP-Regeln werden extrahiert..." />}
            {sopRulesLoaded && <div style={{ width: 6, height: 6, borderRadius: 3, background: "#10B981" }} title="SOP-Regeln geladen" />}
          </button>
          <button onClick={() => setLang(lang === "de" ? "en" : "de")} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "5px 10px", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            {lang === "de" ? "EN" : "DE"}
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
            {session?.user?.image && <img src={session.user.image} alt="" style={{ width: 28, height: 28, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.2)" }} />}
            <span style={{ color: "#94a3b8", fontSize: 11 }}>{session?.user?.name?.split(" ")[0]}</span>
            <button onClick={onSignOut} title={t.signOut} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
              <Ic name="logout" size={14} color="#94a3b8" />
            </button>
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", gap: 0, padding: "0 16px", flexShrink: 0 }}>
        {tabs.map((tb) => (
          <button key={tb.id} onClick={() => setTab(tb.id)} style={{
            padding: "10px 16px", border: "none", background: "none", cursor: "pointer", fontSize: 12,
            fontWeight: tab === tb.id ? 600 : 400,
            color: tab === tb.id ? (tb.color || "#028090") : "#64748b",
            borderBottom: tab === tb.id ? `2px solid ${tb.color || "#028090"}` : "2px solid transparent",
            display: "flex", alignItems: "center", gap: 5, transition: "all .2s",
          }}>
            <Ic name={tb.icon} size={14} color={tab === tb.id ? (tb.color || "#028090") : "#94a3b8"} />{tb.label}
            {tb.badge > 0 && (
              <span style={{
                background: "#DC2626", color: "#fff", fontSize: 9, fontWeight: 700,
                borderRadius: 8, padding: "1px 5px", minWidth: 14, textAlign: "center",
              }}>
                {tb.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content + Chat */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, overflow: "auto" }}>

          {error && (
            <div style={{ margin: 24, padding: 16, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, color: "#dc2626", fontSize: 13 }}>
              <strong>Fehler:</strong> {error}
              {(error.includes("Invalid Credentials") || error.includes("401") || error.includes("token")) && (
                <div style={{ marginTop: 8 }}>
                  <p style={{ fontSize: 12, color: "#92400e", marginBottom: 8 }}>
                    {lang === "de" ? "Der Zugangstoken ist abgelaufen. Bitte melde dich erneut an." : "Access token has expired. Please sign in again."}
                  </p>
                  <button onClick={onSignOut} style={{ padding: "6px 16px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    {lang === "de" ? "Neu anmelden" : "Sign in again"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* SOP Explorer */}
          {tab === "sops" && (
            <SopExplorer files={files} fileMap={fileMap} loading={loading} lang={lang} t={t} onPreview={setPreviewFile} onOpenInDrive={openInDrive} />
          )}

          {/* Document Control */}
          {tab === "doccontrol" && (
            <DocumentControlTab session={session} lang={lang} t={t} />
          )}

          {/* Engineering Change Management */}
          {tab === "ecm" && (
            <ChangeManagementTab session={session} lang={lang} t={t} />
          )}

          {/* Development */}
          {tab === "dev" && (
            <DevelopmentTab
              session={session}
              files={devFiles} loading={devLoading} folderId={folderIds.development}
              lang={lang} t={t} onPreview={setPreviewFile} onOpenInDrive={openInDrive}
              onRefresh={() => { setDevLoaded(false); loadDevFiles(); }}
              onSetupFolders={() => setupFolders("development")}
              settingUp={devSettingUp}
            />
          )}

          {/* Operations */}
          {tab === "ops" && (
            <OperationsTab
              session={session}
              files={opsFiles} loading={opsLoading} folderId={folderIds.operations}
              lang={lang} t={t} onPreview={setPreviewFile} onOpenInDrive={openInDrive}
              onRefresh={() => { setOpsLoaded(false); loadOpsFiles(); }}
              onSetupFolders={() => setupFolders("operations")}
              settingUp={opsSettingUp}
            />
          )}

          {/* Approvals */}
          {tab === "approvals" && (
            <ApprovalPanel session={session} lang={lang} t={t} files={files} folderIds={folderIds} onFilesChanged={() => {
              // Refresh file lists after upload/approval
              fetch("/api/drive", { headers: { "x-access-token": session.accessToken } })
                .then((r) => r.json()).then((data) => { if (data.files) { setFiles(data.files); setFileMap(matchFilesToSops(data.files)); } }).catch(() => {});
            }} />
          )}

          {/* Audit Trail */}
          {tab === "audit" && (
            <AuditTrail files={files} lang={lang} t={t} onPreview={setPreviewFile} onOpenInDrive={openInDrive} />
          )}

          {/* QMS */}
          {tab === "qms" && <QmsTab lang={lang} t={t} />}

          {/* Products */}
          {tab === "products" && <ProductsTab lang={lang} t={t} />}

          {/* Team */}
          {tab === "team" && <TeamTab lang={lang} t={t} />}
        </div>

        {/* Chat Sidebar */}
        <ChatSidebar
          session={session} lang={lang} files={files} chatOpen={chatOpen} setChatOpen={setChatOpen}
          sopRulesLoaded={sopRulesLoaded} sopRulesLoading={sopRulesLoading}
          setSopRulesLoaded={setSopRulesLoaded} setSopRulesLoading={setSopRulesLoading}
          targetFolderId={currentAreaFolderId}
          activeArea={tab === "dev" ? "development" : tab === "ops" ? "operations" : "qmh"}
          folderIds={folderIds}
          auditTrigger={auditTrigger}
          onAuditHandled={() => setAuditTrigger(false)}
          onFilesChanged={() => {
            if (tab === "dev") { setDevLoaded(false); loadDevFiles(); }
            else if (tab === "ops") { setOpsLoaded(false); loadOpsFiles(); }
          }}
        />
      </div>
    </div>
  );
}
