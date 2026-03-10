"use client";
import { AREA_CONFIG } from "../lib/folderStructure";
import DocumentExplorer from "./DocumentExplorer";

export default function OperationsTab({ session, files, loading, folderId, lang, t, onPreview, onOpenInDrive, onRefresh, onSetupFolders, settingUp }) {
  return (
    <DocumentExplorer
      session={session}
      areaConfig={AREA_CONFIG.operations}
      files={files}
      loading={loading}
      areaFolderId={folderId}
      lang={lang}
      t={t}
      onPreview={onPreview}
      onOpenInDrive={onOpenInDrive}
      onRefresh={onRefresh}
      onSetupFolders={onSetupFolders}
      settingUp={settingUp}
    />
  );
}
