"use client";
import { useState, useRef } from "react";
import { Ic } from "./icons";

const ALLOWED_EXTENSIONS = [".docx", ".xlsx", ".pdf"];

export default function DropZone({ session, lang, t, folderId, onUploaded }) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const userEmail = session?.userEmail || session?.user?.email || "";
  const userName = session?.user?.name || userEmail;

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer?.files;
    if (files?.length) {
      await uploadFile(files[0]);
    }
  };

  const handleFileSelect = async (e) => {
    const files = e.target.files;
    if (files?.length) {
      await uploadFile(files[0]);
    }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const uploadFile = async (file) => {
    setError("");
    setUploadResult(null);

    // Validate extension
    const ext = "." + file.name.split(".").pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setError(`File type not allowed. Supported: ${ALLOWED_EXTENSIONS.join(", ")}`);
      return;
    }

    // Validate size (25 MB)
    if (file.size > 25 * 1024 * 1024) {
      setError("File too large. Maximum size: 25 MB");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folderId", folderId || "");
      formData.append("convert", "true");
      formData.append("uploaderEmail", userEmail);
      formData.append("uploaderName", userName);

      const res = await fetch("/api/drive/upload", {
        method: "POST",
        headers: { "x-access-token": session.accessToken },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Upload failed");
        return;
      }

      setUploadResult(data.file);
      if (onUploaded) onUploaded(data.file);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${isDragging ? "#028090" : "#D1D5DB"}`,
          borderRadius: 8,
          padding: "16px 12px",
          textAlign: "center",
          cursor: "pointer",
          background: isDragging ? "#F0FDFA" : "#FAFAFA",
          transition: "all 0.2s",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,.xlsx,.pdf"
          onChange={handleFileSelect}
          style={{ display: "none" }}
        />

        {uploading ? (
          <div style={{ color: "#028090", fontSize: 13 }}>
            <Ic name="loader" size={20} color="#028090" />
            <div style={{ marginTop: 4 }}>{t.uploading}</div>
          </div>
        ) : uploadResult ? (
          <div style={{ color: "#059669", fontSize: 13 }}>
            <Ic name="check" size={20} color="#059669" />
            <div style={{ marginTop: 4, fontWeight: 500 }}>{t.uploaded}: {uploadResult.name}</div>
            <a
              href={uploadResult.webViewLink}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ fontSize: 11, color: "#028090", marginTop: 4, display: "inline-block" }}
            >
              {t.openDrive} →
            </a>
          </div>
        ) : (
          <div style={{ color: "#6B7280", fontSize: 12 }}>
            <Ic name="upload" size={20} color="#9CA3AF" />
            <div style={{ marginTop: 4 }}>{t.dropHere}</div>
            <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 2 }}>.docx, .xlsx, .pdf (max 25 MB)</div>
          </div>
        )}
      </div>

      {error && (
        <div style={{
          marginTop: 6, padding: "6px 10px", background: "#FEF2F2",
          borderRadius: 6, fontSize: 12, color: "#DC2626",
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
