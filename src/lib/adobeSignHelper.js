// ═══ Adobe Sign (Acrobat Sign) API Helper ═══
// Optional integration — all functions check if Adobe Sign is configured.
// When not configured, the approval workflow falls back to in-app approvals.

const ADOBE_SIGN_API_URL = process.env.ADOBE_SIGN_API_URL;
const ADOBE_SIGN_INTEGRATION_KEY = process.env.ADOBE_SIGN_INTEGRATION_KEY;

export function isEnabled() {
  return !!(ADOBE_SIGN_API_URL && ADOBE_SIGN_INTEGRATION_KEY);
}

function getHeaders() {
  return {
    Authorization: `Bearer ${ADOBE_SIGN_INTEGRATION_KEY}`,
    "Content-Type": "application/json",
  };
}

async function apiCall(method, path, body) {
  const url = `${ADOBE_SIGN_API_URL}${path}`;
  const options = {
    method,
    headers: getHeaders(),
  };
  if (body) {
    if (body instanceof FormData || body instanceof Buffer || ArrayBuffer.isView(body)) {
      options.body = body;
      // For multipart upload, remove content-type so fetch sets it with boundary
      if (body instanceof FormData) {
        delete options.headers["Content-Type"];
      } else {
        options.headers["Content-Type"] = "application/pdf";
      }
    } else {
      options.body = JSON.stringify(body);
    }
  }

  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    console.error(`[ADOBE_SIGN] API error ${res.status}: ${text}`);
    throw new Error(`Adobe Sign API error: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * Upload a PDF and create an agreement with 3 sequential signatories.
 * @param {Buffer} pdfBuffer - The PDF file content
 * @param {string} fileName - Display name for the document
 * @param {{ author: {email, name}, reviewer: {email, name}, approver: {email, name} }} signatories
 * @returns {{ agreementId: string, status: string }}
 */
export async function createAgreement(pdfBuffer, fileName, signatories) {
  if (!isEnabled()) return { enabled: false };

  // Step 1: Upload transient document
  const formData = new FormData();
  formData.append("File", new Blob([pdfBuffer], { type: "application/pdf" }), fileName);
  formData.append("File-Name", fileName);

  const uploadRes = await fetch(`${ADOBE_SIGN_API_URL}/transientDocuments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ADOBE_SIGN_INTEGRATION_KEY}` },
    body: formData,
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`Adobe Sign upload failed: ${uploadRes.status} ${text}`);
  }

  const { transientDocumentId } = await uploadRes.json();

  // Step 2: Create agreement with sequential signing
  const agreement = await apiCall("POST", "/agreements", {
    fileInfos: [{ transientDocumentId }],
    name: fileName,
    participantSetsInfo: [
      {
        memberInfos: [{ email: signatories.author.email, securityOption: { authenticationMethod: "NONE" } }],
        role: "SIGNER",
        order: 1,
        label: "Author",
      },
      {
        memberInfos: [{ email: signatories.reviewer.email, securityOption: { authenticationMethod: "NONE" } }],
        role: "SIGNER",
        order: 2,
        label: "Reviewer",
      },
      {
        memberInfos: [{ email: signatories.approver.email, securityOption: { authenticationMethod: "NONE" } }],
        role: "SIGNER",
        order: 3,
        label: "Approver",
      },
    ],
    signatureType: "ESIGN",
    state: "IN_PROCESS",
  });

  console.log("[ADOBE_SIGN] Agreement created:", agreement.id);
  return { agreementId: agreement.id, status: "IN_PROCESS" };
}

/**
 * Get the current status of an agreement.
 * @param {string} agreementId
 * @returns {{ status: string, signerStatuses: Array }}
 */
export async function getAgreementStatus(agreementId) {
  if (!isEnabled()) return { enabled: false };

  const agreement = await apiCall("GET", `/agreements/${agreementId}`);

  // Get member signing statuses
  const members = await apiCall("GET", `/agreements/${agreementId}/members`);

  const signerStatuses = (members.participantSets || [])
    .filter((ps) => ps.role === "SIGNER")
    .map((ps) => ({
      order: ps.order,
      label: ps.label || `Signer ${ps.order}`,
      email: ps.memberInfos?.[0]?.email || "",
      status: ps.status || "WAITING_FOR_MY_SIGNATURE",
    }));

  return {
    status: agreement.status,
    signerStatuses,
    name: agreement.name,
  };
}

/**
 * Download the signed PDF document.
 * @param {string} agreementId
 * @returns {Buffer}
 */
export async function getSignedDocument(agreementId) {
  if (!isEnabled()) return { enabled: false };

  const res = await fetch(
    `${ADOBE_SIGN_API_URL}/agreements/${agreementId}/combinedDocument`,
    { headers: { Authorization: `Bearer ${ADOBE_SIGN_INTEGRATION_KEY}` } }
  );

  if (!res.ok) {
    throw new Error(`Failed to download signed document: ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

/**
 * Cancel an agreement (e.g., on rejection or withdrawal).
 * @param {string} agreementId
 */
export async function cancelAgreement(agreementId) {
  if (!isEnabled()) return { enabled: false };

  try {
    await apiCall("PUT", `/agreements/${agreementId}/state`, {
      state: "CANCELLED",
    });
    console.log("[ADOBE_SIGN] Agreement cancelled:", agreementId);
  } catch (err) {
    // Agreement may already be completed or cancelled
    console.warn("[ADOBE_SIGN] Could not cancel agreement:", err.message);
  }
}
