import { getServerSession } from "next-auth";
import { google } from "googleapis";
import {
  ensureSheets,
  computeDocumentHash,
  getApprovalQueue,
  getPendingForUser,
  addApprovalRequest,
  updateApprovalStatus,
  appendToLog,
  generateRequestId,
  getRequestById,
  getRecentHistory,
} from "../../../lib/sheetsHelper";
import {
  isEnabled as isAdobeSignEnabled,
  createAgreement,
  getAgreementStatus,
  getSignedDocument,
  cancelAgreement,
} from "../../../lib/adobeSignHelper";

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const EXPIRY_DAYS = 30;

function getAccessToken(req) {
  return req.headers.get("x-access-token");
}

function getDriveClient(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

// ═══ GET: List pending approvals + history ═══
export async function GET(req) {
  try {
    const accessToken = getAccessToken(req);
    if (!accessToken) return Response.json({ error: "Not authenticated" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const userEmail = searchParams.get("userEmail");

    await ensureSheets(accessToken);

    const queue = await getApprovalQueue(accessToken);
    const pending = userEmail
      ? queue.filter((r) => {
          if (r.status !== "SUBMITTED" && r.status !== "SIGNING") return false;
          return true;
        })
      : queue.filter((r) => r.status === "SUBMITTED" || r.status === "SIGNING");

    // Check for expired requests
    const now = Date.now();
    for (const req of pending) {
      if (req.submittedAt) {
        const submitted = new Date(req.submittedAt).getTime();
        if (now - submitted > EXPIRY_DAYS * 24 * 60 * 60 * 1000) {
          await updateApprovalStatus(accessToken, req.requestId, { status: "EXPIRED" });
          await appendToLog(accessToken, {
            requestId: req.requestId,
            action: "EXPIRED",
            actorEmail: "system",
            actorName: "System",
            documentHash: req.documentHash,
            fileId: req.fileId,
            details: `Request expired after ${EXPIRY_DAYS} days`,
          });
          if (isAdobeSignEnabled() && req.adobeAgreementId) {
            await cancelAgreement(req.adobeAgreementId).catch(() => {});
          }
          req.status = "EXPIRED";
        }
      }
    }

    // Check Adobe Sign status for active items
    if (isAdobeSignEnabled()) {
      for (const r of pending) {
        if (r.adobeAgreementId && r.status === "SIGNING") {
          try {
            const status = await getAgreementStatus(r.adobeAgreementId);
            if (status.status === "SIGNED") {
              // All signatures collected — trigger finalization
              await finalize(accessToken, r);
            }
            r._adobeSignStatus = status;
          } catch (err) {
            console.error("[APPROVAL] Adobe Sign status check failed:", err.message);
          }
        }
      }
    }

    const activePending = pending.filter((r) => r.status === "SUBMITTED" || r.status === "SIGNING");
    const history = await getRecentHistory(accessToken, 20);

    // Count pending for this user specifically (match by email or name)
    let userPendingCount = 0;
    if (userEmail) {
      const userName = searchParams.get("userName") || "";
      const matchUser = (signatory) =>
        signatory && (signatory === userEmail || (userName && signatory === userName));
      userPendingCount = activePending.filter((r) => {
        if (matchUser(r.signatoryAuthor) && !r.signedAuthor) return true;
        if (matchUser(r.signatoryReviewer) && !r.signedReviewer) return true;
        if (matchUser(r.signatoryApprover) && !r.signedApprover) return true;
        return false;
      }).length;
    }

    return Response.json({
      pending: activePending,
      history,
      userPendingCount,
      adobeSignEnabled: isAdobeSignEnabled(),
    });
  } catch (err) {
    console.error("[APPROVAL] GET error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// ═══ POST: Actions (submit, sign, reject, withdraw, new-version, obsolete) ═══
export async function POST(req) {
  try {
    const accessToken = getAccessToken(req);
    if (!accessToken) return Response.json({ error: "Not authenticated" }, { status: 401 });

    const body = await req.json();
    const { action } = body;

    await ensureSheets(accessToken);

    switch (action) {
      case "submit":
        return await handleSubmit(accessToken, body);
      case "sign":
        return await handleSign(accessToken, body);
      case "check-status":
        return await handleCheckStatus(accessToken, body);
      case "reject":
        return await handleReject(accessToken, body);
      case "withdraw":
        return await handleWithdraw(accessToken, body);
      case "new-version":
        return await handleNewVersion(accessToken, body);
      case "supersede":
        return await handleSupersede(accessToken, body);
      case "obsolete":
        return await handleObsolete(accessToken, body);
      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error("[APPROVAL] POST error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// ═══ Submit for approval ═══
async function handleSubmit(accessToken, body) {
  const {
    fileId, fileName, formsheetId, version,
    authorEmail, authorName,
    signatoryAuthor, signatoryReviewer, signatoryApprover,
    changeRequestId,
  } = body;

  if (!fileId || !fileName) {
    return Response.json({ error: "fileId and fileName are required" }, { status: 400 });
  }

  // Validate all 3 signatories are different
  const signatories = [signatoryAuthor, signatoryReviewer, signatoryApprover];
  if (new Set(signatories).size !== 3) {
    return Response.json({ error: "All 3 signatories must be different people" }, { status: 422 });
  }

  // Compute document hash
  const documentHash = await computeDocumentHash(accessToken, fileId);
  const requestId = generateRequestId();

  const request = {
    requestId,
    fileId,
    fileName,
    formsheetId: formsheetId || "",
    version: version || "1.0",
    previousVersionFileId: body.previousVersionFileId || "",
    status: "SUBMITTED",
    authorEmail,
    authorName,
    submittedAt: new Date().toISOString(),
    signatoryAuthor,
    signatoryReviewer,
    signatoryApprover,
    adobeAgreementId: "",
    documentHash,
    signedAuthor: "",
    signedReviewer: "",
    signedApprover: "",
    finalizedAt: "",
    finalFileId: "",
    changeRequestId: changeRequestId || "",
    notes: body.notes || "",
  };

  // If Adobe Sign is enabled, create agreement
  if (isAdobeSignEnabled()) {
    try {
      const drive = getDriveClient(accessToken);
      // Export as PDF
      const pdfRes = await drive.files.export(
        { fileId, mimeType: "application/pdf" },
        { responseType: "arraybuffer" }
      );
      const pdfBuffer = Buffer.from(pdfRes.data);

      const result = await createAgreement(pdfBuffer, fileName, {
        author: { email: signatoryAuthor, name: "" },
        reviewer: { email: signatoryReviewer, name: "" },
        approver: { email: signatoryApprover, name: "" },
      });

      if (result.agreementId) {
        request.adobeAgreementId = result.agreementId;
        request.status = "SIGNING";
      }
    } catch (err) {
      console.error("[APPROVAL] Adobe Sign agreement creation failed:", err.message);
      // Continue without Adobe Sign — fall back to in-app approval
    }
  }

  await addApprovalRequest(accessToken, request);

  console.log("[APPROVAL] Request submitted:", requestId, fileName);
  return Response.json({
    success: true,
    requestId,
    status: request.status,
    adobeSignEnabled: isAdobeSignEnabled(),
  });
}

// ═══ Sign (in-app, without Adobe Sign) ═══
async function handleSign(accessToken, body) {
  const { requestId, actorEmail, actorName } = body;

  if (isAdobeSignEnabled()) {
    return Response.json({
      error: "In-app signing is disabled when Adobe Sign is active. Please sign via Adobe Sign.",
    }, { status: 422 });
  }

  const request = await getRequestById(accessToken, requestId);
  if (!request) return Response.json({ error: "Request not found" }, { status: 404 });
  if (request.status !== "SUBMITTED") {
    return Response.json({ error: `Cannot sign request with status: ${request.status}` }, { status: 422 });
  }

  // Verify document hash hasn't changed
  const currentHash = await computeDocumentHash(accessToken, request.fileId);
  if (currentHash !== request.documentHash) {
    return Response.json({
      error: "Document has been modified since submission. Hash mismatch detected. Please withdraw and resubmit.",
      hashMismatch: true,
    }, { status: 422 });
  }

  // Determine which role the actor has and enforce sequential order
  // Match by email OR name (for teams without email configured yet)
  const matchesActor = (signatory) =>
    signatory && (signatory === actorEmail || signatory === actorName);

  let roleField = null;
  let signedField = null;

  if (matchesActor(request.signatoryAuthor) && !request.signedAuthor) {
    roleField = "signatoryAuthor";
    signedField = "signedAuthor";
  } else if (matchesActor(request.signatoryReviewer) && !request.signedReviewer) {
    // Reviewer can only sign after author
    if (!request.signedAuthor) {
      return Response.json({ error: "Author must sign first (sequential signing)" }, { status: 422 });
    }
    roleField = "signatoryReviewer";
    signedField = "signedReviewer";
  } else if (matchesActor(request.signatoryApprover) && !request.signedApprover) {
    // Approver can only sign after author and reviewer
    if (!request.signedAuthor || !request.signedReviewer) {
      return Response.json({ error: "Author and Reviewer must sign first (sequential signing)" }, { status: 422 });
    }
    roleField = "signatoryApprover";
    signedField = "signedApprover";
  }

  if (!signedField) {
    return Response.json({ error: "You are not a designated signatory or have already signed" }, { status: 422 });
  }

  const timestamp = new Date().toISOString();
  const updates = { [signedField]: timestamp };

  // Check if this was the last signature
  const signedCount =
    (request.signedAuthor ? 1 : 0) +
    (request.signedReviewer ? 1 : 0) +
    (request.signedApprover ? 1 : 0) +
    1; // +1 for current signature

  await updateApprovalStatus(accessToken, requestId, updates);
  await appendToLog(accessToken, {
    requestId,
    action: "SIGNED",
    actorEmail,
    actorName,
    documentHash: request.documentHash,
    fileId: request.fileId,
    details: `${signedField.replace("signed", "")} signed by ${actorName}`,
  });

  // If all 3 signed, finalize
  if (signedCount === 3) {
    // Re-fetch the updated request
    const updated = await getRequestById(accessToken, requestId);
    await finalize(accessToken, updated);
  }

  return Response.json({ success: true, signedField, signedCount, total: 3 });
}

// ═══ Check Adobe Sign status ═══
async function handleCheckStatus(accessToken, body) {
  const { requestId } = body;
  const request = await getRequestById(accessToken, requestId);
  if (!request) return Response.json({ error: "Request not found" }, { status: 404 });
  if (!request.adobeAgreementId) {
    return Response.json({ error: "No Adobe Sign agreement for this request" }, { status: 422 });
  }

  const status = await getAgreementStatus(request.adobeAgreementId);

  if (status.status === "SIGNED") {
    await finalize(accessToken, request);
  }

  return Response.json({ success: true, ...status });
}

// ═══ Reject ═══
async function handleReject(accessToken, body) {
  const { requestId, actorEmail, actorName, reason } = body;
  const request = await getRequestById(accessToken, requestId);
  if (!request) return Response.json({ error: "Request not found" }, { status: 404 });

  if (request.status !== "SUBMITTED" && request.status !== "SIGNING") {
    return Response.json({ error: `Cannot reject request with status: ${request.status}` }, { status: 422 });
  }

  await updateApprovalStatus(accessToken, requestId, {
    status: "REJECTED",
    notes: reason || "",
  });

  await appendToLog(accessToken, {
    requestId,
    action: "REJECTED",
    actorEmail,
    actorName,
    documentHash: request.documentHash,
    fileId: request.fileId,
    details: `Rejected: ${reason || "No reason provided"}`,
  });

  if (isAdobeSignEnabled() && request.adobeAgreementId) {
    await cancelAgreement(request.adobeAgreementId).catch(() => {});
  }

  return Response.json({ success: true });
}

// ═══ Withdraw ═══
async function handleWithdraw(accessToken, body) {
  const { requestId, actorEmail, actorName } = body;
  const request = await getRequestById(accessToken, requestId);
  if (!request) return Response.json({ error: "Request not found" }, { status: 404 });

  if (request.authorEmail !== actorEmail) {
    return Response.json({ error: "Only the submitter can withdraw a request" }, { status: 403 });
  }

  if (request.status !== "SUBMITTED" && request.status !== "SIGNING") {
    return Response.json({ error: `Cannot withdraw request with status: ${request.status}` }, { status: 422 });
  }

  await updateApprovalStatus(accessToken, requestId, { status: "WITHDRAWN" });
  await appendToLog(accessToken, {
    requestId,
    action: "WITHDRAWN",
    actorEmail,
    actorName,
    documentHash: request.documentHash,
    fileId: request.fileId,
    details: "Request withdrawn by submitter",
  });

  if (isAdobeSignEnabled() && request.adobeAgreementId) {
    await cancelAgreement(request.adobeAgreementId).catch(() => {});
  }

  return Response.json({ success: true });
}

// ═══ Create new version ═══
async function handleNewVersion(accessToken, body) {
  const { sourceFileId, sourceFileName, formsheetId, authorEmail, authorName, changeRequestId } = body;

  if (!sourceFileId || !changeRequestId) {
    return Response.json({ error: "sourceFileId and changeRequestId are required" }, { status: 400 });
  }

  const drive = getDriveClient(accessToken);

  // Determine new version number from existing approvals
  const queue = await getApprovalQueue(accessToken);
  const existingVersions = queue
    .filter((r) => r.fileId === sourceFileId || r.previousVersionFileId === sourceFileId)
    .map((r) => parseFloat(r.version) || 1.0);
  const maxVersion = Math.max(1.0, ...existingVersions);
  const newVersion = (maxVersion + 1.0).toFixed(1);

  // Copy the source document as a new draft
  const newFileName = sourceFileName.replace(/_V[\d.]+/, "") + `_V${newVersion}_DRAFT`;
  const copy = await drive.files.copy({
    fileId: sourceFileId,
    requestBody: {
      name: newFileName,
      parents: [FOLDER_ID],
    },
    supportsAllDrives: true,
  });

  await appendToLog(accessToken, {
    requestId: `NEW-VER-${Date.now()}`,
    action: "NEW_VERSION",
    actorEmail: authorEmail,
    actorName: authorName,
    documentHash: "",
    fileId: copy.data.id,
    details: `New version ${newVersion} created from ${sourceFileName} (Change Request: ${changeRequestId})`,
  });

  return Response.json({
    success: true,
    newFileId: copy.data.id,
    newFileName: copy.data.name,
    version: newVersion,
    previousVersionFileId: sourceFileId,
  });
}

// ═══ Supersede old version ═══
async function handleSupersede(accessToken, body) {
  const { requestId, actorEmail, actorName } = body;
  const request = await getRequestById(accessToken, requestId);
  if (!request) return Response.json({ error: "Request not found" }, { status: 404 });

  await updateApprovalStatus(accessToken, requestId, { status: "SUPERSEDED" });
  await appendToLog(accessToken, {
    requestId,
    action: "SUPERSEDED",
    actorEmail: actorEmail || "system",
    actorName: actorName || "System",
    documentHash: request.documentHash,
    fileId: request.fileId,
    details: "Superseded by newer version",
  });

  return Response.json({ success: true });
}

// ═══ Mark as obsolete ═══
async function handleObsolete(accessToken, body) {
  const { requestId, actorEmail, actorName, changeRequestId, reason } = body;
  const request = await getRequestById(accessToken, requestId);
  if (!request) return Response.json({ error: "Request not found" }, { status: 404 });

  if (!changeRequestId) {
    return Response.json({ error: "A Change Request ID is required to mark a document as obsolete" }, { status: 422 });
  }

  await updateApprovalStatus(accessToken, requestId, {
    status: "OBSOLETE",
    changeRequestId,
    notes: reason || "",
  });

  await appendToLog(accessToken, {
    requestId,
    action: "OBSOLETE",
    actorEmail,
    actorName,
    documentHash: request.documentHash,
    fileId: request.fileId,
    details: `Marked obsolete (Change Request: ${changeRequestId}). Reason: ${reason || "N/A"}`,
  });

  return Response.json({ success: true });
}

// ═══ Finalization ═══
async function finalize(accessToken, request) {
  const drive = getDriveClient(accessToken);

  try {
    // 1. If Adobe Sign, download signed PDF
    if (isAdobeSignEnabled() && request.adobeAgreementId) {
      const signedPdf = await getSignedDocument(request.adobeAgreementId);
      if (signedPdf && !(signedPdf.enabled === false)) {
        // Upload signed PDF to Drive
        const signedFileName = request.fileName.replace(/ENTWURF|DRAFT/i, "") + `_V${request.version || "1.0"}_SIGNED.pdf`;
        await drive.files.create({
          requestBody: {
            name: signedFileName,
            parents: [FOLDER_ID],
            mimeType: "application/pdf",
          },
          media: {
            mimeType: "application/pdf",
            body: require("stream").Readable.from(signedPdf),
          },
          supportsAllDrives: true,
        });
      }
    }

    // 2. Rename document: DRAFT/ENTWURF → _V1.0
    const version = request.version || "1.0";
    const newName = request.fileName
      .replace(/ENTWURF|DRAFT/gi, "")
      .replace(/_+$/, "")
      .replace(/\s+$/, "") + `_V${version}`;

    await drive.files.update({
      fileId: request.fileId,
      requestBody: { name: newName },
      supportsAllDrives: true,
    });

    // 3. Move old version to "Old" subfolder (if this is a version upgrade)
    if (request.previousVersionFileId) {
      // Find or create "Old" subfolder
      const oldFolderQuery = await drive.files.list({
        q: `'${FOLDER_ID}' in parents and name='Old' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: "files(id)",
        supportsAllDrives: true,
      });

      let oldFolderId;
      if (oldFolderQuery.data.files?.length) {
        oldFolderId = oldFolderQuery.data.files[0].id;
      } else {
        const created = await drive.files.create({
          requestBody: {
            name: "Old",
            mimeType: "application/vnd.google-apps.folder",
            parents: [FOLDER_ID],
          },
          supportsAllDrives: true,
        });
        oldFolderId = created.data.id;
      }

      await drive.files.update({
        fileId: request.previousVersionFileId,
        addParents: oldFolderId,
        removeParents: FOLDER_ID,
        supportsAllDrives: true,
      });

      // Supersede the old version's approval record
      const queue = await getApprovalQueue(accessToken);
      const oldApproval = queue.find((r) => r.fileId === request.previousVersionFileId && r.status === "APPROVED");
      if (oldApproval) {
        await updateApprovalStatus(accessToken, oldApproval.requestId, { status: "SUPERSEDED" });
      }
    }

    // 4. Update queue status
    await updateApprovalStatus(accessToken, request.requestId, {
      status: "APPROVED",
      finalizedAt: new Date().toISOString(),
      finalFileId: request.fileId,
    });

    // 5. Log finalization
    await appendToLog(accessToken, {
      requestId: request.requestId,
      action: "FINALIZED",
      actorEmail: "system",
      actorName: "System",
      documentHash: request.documentHash,
      fileId: request.fileId,
      details: `Document finalized as V${version}`,
    });

    console.log("[APPROVAL] Finalized:", request.requestId, request.fileName);
  } catch (err) {
    console.error("[APPROVAL] Finalization error:", err);
    await appendToLog(accessToken, {
      requestId: request.requestId,
      action: "FINALIZE_ERROR",
      actorEmail: "system",
      actorName: "System",
      documentHash: request.documentHash,
      fileId: request.fileId,
      details: `Finalization error: ${err.message}`,
    });
    throw err;
  }
}
