"use client";
import { useSession, signIn, signOut } from "next-auth/react";
import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Dashboard from "../components/Dashboard";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const IDLE_WARNING_MS = 14 * 60 * 1000; // Show warning at 14 minutes

export default function Home() {
  // Refetch session every 4 minutes to keep access token fresh
  // Google tokens expire in ~1 hour, NextAuth JWT callback handles the refresh
  const { data: session, status } = useSession({
    required: false,
    refetchInterval: 4 * 60, // seconds — check every 4 minutes
    refetchOnWindowFocus: true,
  });

  // Inactivity timeout state
  const lastActivityRef = useRef(Date.now());
  const idleTimerRef = useRef(null);
  const [showIdleWarning, setShowIdleWarning] = useState(false);

  const updateActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (showIdleWarning) setShowIdleWarning(false);
  }, [showIdleWarning]);

  // Track user activity events
  useEffect(() => {
    if (status !== "authenticated") return;

    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((evt) => window.addEventListener(evt, updateActivity, { passive: true }));

    // Check idle state every 30 seconds
    idleTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= IDLE_TIMEOUT_MS) {
        clearInterval(idleTimerRef.current);
        signOut({ callbackUrl: "/" });
      } else if (elapsed >= IDLE_WARNING_MS) {
        setShowIdleWarning(true);
      }
    }, 30 * 1000);

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, updateActivity));
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
    };
  }, [status, updateActivity]);

  // If token refresh failed, force re-login
  useEffect(() => {
    if (session?.error === "RefreshAccessTokenError") {
      console.error("[AUTH] Refresh token failed — forcing re-login");
      signIn("google");
    }
  }, [session?.error]);

  if (status === "loading") {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          </div>
          <p className="text-slate-400 text-sm">Laden...</p>
        </div>
      </div>
    );
  }

  // Check for auth error (e.g., non-wavemedix.ai email)
  let authError = null;
  try {
    const searchParams = useSearchParams();
    authError = searchParams?.get("error");
  } catch { /* SSR fallback */ }

  if (!session) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="bg-white rounded-2xl shadow-2xl p-10 max-w-md w-full mx-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-6">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">WAVEMEDIX</h1>
          <p className="text-emerald-600 text-sm font-medium mb-6">Quality Management System</p>
          {authError && (
            <div style={{ margin: "0 0 16px", padding: "12px 16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, color: "#dc2626", fontSize: 13, textAlign: "center" }}>
              Access restricted to @wavemedix.ai accounts only.
              <br />
              <span style={{ fontSize: 11, color: "#92400e" }}>Zugriff nur f&uuml;r @wavemedix.ai E-Mail-Adressen.</span>
            </div>
          )}
          <p className="text-slate-500 text-sm mb-8">
            Melde dich mit deinem Wavemedix Google-Account an, um auf das QMS zuzugreifen.
          </p>
          <button
            onClick={() => signIn("google")}
            className="w-full flex items-center justify-center gap-3 bg-white border-2 border-slate-200 rounded-xl px-6 py-3 text-sm font-semibold text-slate-700 hover:border-teal-500 hover:text-teal-700 transition-all"
          >
            <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Mit Google anmelden
          </button>
          <p className="text-xs text-slate-400 mt-6">ISO 13485 | FDA 21 CFR 820 | EU MDR 2017/745</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Dashboard session={session} onSignOut={() => signOut()} />
      {showIdleWarning && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.5)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 9999,
        }}>
          <div style={{
            background: "#fff", borderRadius: 16, padding: 32,
            maxWidth: 400, width: "90%", textAlign: "center",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: "linear-gradient(135deg, #f59e0b, #d97706)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
              </svg>
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "#1e293b", marginBottom: 8 }}>
              Session Timeout
            </h3>
            <p style={{ fontSize: 14, color: "#64748b", marginBottom: 24, lineHeight: 1.5 }}>
              Your session will expire in about 1 minute due to inactivity.
              Click &quot;Stay Signed In&quot; to continue working.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button
                onClick={() => { lastActivityRef.current = Date.now(); setShowIdleWarning(false); }}
                style={{
                  flex: 1, padding: "10px 20px",
                  background: "linear-gradient(135deg, #10B981, #028090)",
                  color: "#fff", border: "none", borderRadius: 8,
                  fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}
              >
                Stay Signed In
              </button>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                style={{
                  padding: "10px 20px", background: "#f1f5f9",
                  color: "#64748b", border: "1px solid #e2e8f0",
                  borderRadius: 8, fontSize: 14, cursor: "pointer",
                }}
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
