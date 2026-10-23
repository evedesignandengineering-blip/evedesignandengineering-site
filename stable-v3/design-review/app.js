const $ = (id) => document.getElementById(id);
const pdfInput = $("pdfInput");
const dropzone = $("dropzone");
const fileInfo = $("fileInfo");
const extractStatus = $("extractStatus");
const textPreview = $("textPreview");
const findingsBody = $("findingsBody");
const findingDialog = $("findingDialog");
let currentFile = null;
let extractedPages = [];
let findings = [];
let pdfObjectUrl = null;
let aiReview = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}
function setStatus(message) { extractStatus.textContent = message; }
function loadFile(file) {
  if (!file) return;
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    setStatus("Please choose a PDF file."); return;
  }
  if (file.size > 50 * 1024 * 1024) {
    setStatus("This prototype accepts files up to 50 MB. Choose a smaller PDF."); return;
  }
  currentFile = file;
  extractedPages = [];
  if (pdfObjectUrl) URL.revokeObjectURL(pdfObjectUrl);
  pdfObjectUrl = URL.createObjectURL(file);
  fileInfo.classList.remove("hidden");
  fileInfo.innerHTML = "<strong>" + escapeHtml(file.name) + "</strong> · " + formatBytes(file.size) + ' · <a href="' + pdfObjectUrl + '" target="_blank" rel="noopener">Open PDF preview</a>';
  textPreview.classList.add("hidden");
  setStatus("Reading PDF text locally…");
  readPdfText(file).catch((error) => {
    console.error(error);
    setStatus("The PDF preview is ready, but text extraction failed. It may be encrypted, malformed, or unsupported by the browser.");
  });
}
async function readPdfText(file) {
  let pdfjs;
  try {
    pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs");
  } catch (error) {
    setStatus("PDF selected. Text extraction library could not load; check internet access or CDN availability.");
    return;
  }
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str || "").join(" ").replace(/\s+/g, " ").trim();
    pages.push({ page: i, text });
  }
  extractedPages = pages;
  const totalChars = pages.reduce((sum, page) => sum + page.text.length, 0);
  setStatus("Extracted text from " + pdf.numPages + " page(s) locally · " + totalChars.toLocaleString() + " characters. This is extraction only, not a standards compliance review.");
  textPreview.classList.remove("hidden");
  textPreview.textContent = pages.map((p) => "PAGE " + p.page + "\n" + (p.text || "[No selectable text detected on this page.]")).join("\n\n").slice(0, 18000);
}
pdfInput.addEventListener("change", (event) => loadFile(event.target.files?.[0]));
$("loadSample").addEventListener("click", async () => {
  const button = $("loadSample");
  button.disabled = true;
  button.textContent = "Loading sample…";
  setStatus("Fetching TRAINING DRAWING.pdf from the main EVE website assets…");
  try {
    const response = await fetch("https://raw.githubusercontent.com/evedesignandengineering-blip/evedesignandengineering-site/main/assets/TRAINING%20DRAWING.pdf");
    if (!response.ok) throw new Error("HTTP " + response.status);
    const blob = await response.blob();
    loadFile(new File([blob], "TRAINING DRAWING.pdf", { type: "application/pdf" }));
  } catch (error) {
    console.error(error);
    setStatus("Could not load the sample from GitHub. Download TRAINING DRAWING.pdf from the main website repository and upload it manually.");
  } finally {
    button.disabled = false;
    button.textContent = "Load website sample";
  }
});
["dragenter", "dragover"].forEach((name) => dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.add("dragover"); }));
["dragleave", "drop"].forEach((name) => dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.remove("dragover"); }));
dropzone.addEventListener("drop", (event) => loadFile(event.dataTransfer?.files?.[0]));

function renderFindings() {
  if (!findings.length) {
    findingsBody.innerHTML = '<tr><td colspan="6" class="empty">No findings recorded yet.</td></tr>';
    return;
  }
  findingsBody.innerHTML = findings.map((f, index) => {
    const severityClass = f.severity.toLowerCase() === "high" ? "high" : f.severity.toLowerCase() === "low" ? "low" : f.severity.toLowerCase() === "unverified" ? "unverified" : "";
    return "<tr><td><span class=\"finding-pill " + severityClass + "\">" + escapeHtml(f.severity) + "</span></td><td>" + escapeHtml(f.location) + "</td><td>" + escapeHtml(f.description) + "</td><td>" + escapeHtml(f.source || "Not supplied") + "</td><td>" + escapeHtml(f.status) + "</td><td><button class=\"delete-button\" data-delete=\"" + index + "\" type=\"button\">Delete</button></td></tr>";
  }).join("");
  findingsBody.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => {
    findings.splice(Number(button.dataset.delete), 1); renderFindings();
  }));
}
$("addFinding").addEventListener("click", () => findingDialog.showModal());
$("closeDialog").addEventListener("click", () => findingDialog.close());
$("cancelFinding").addEventListener("click", () => findingDialog.close());
$("findingForm").addEventListener("submit", (event) => {
  event.preventDefault();
  findings.push({
    severity: $("findingSeverity").value,
    location: $("findingLocation").value.trim(),
    description: $("findingText").value.trim(),
    source: $("findingSource").value.trim(),
    status: $("findingStatus").value
  });
  renderFindings();
  event.target.reset();
  findingDialog.close();
});
function reviewRecord() {
  return {
    product: "EVE Design Review prototype",
    generatedAt: new Date().toISOString(),
    project: {
      name: $("projectName").value.trim(),
      drawingReference: $("drawingRef").value.trim(),
      revision: $("revision").value.trim(),
      scope: $("scope").value,
      notes: $("reviewNotes").value.trim()
    },
    sourcePdf: currentFile ? { name: currentFile.name, sizeBytes: currentFile.size, pageCount: extractedPages.length } : null,
    extractedPageText: extractedPages,
    aiReview,
    checklist: [...document.querySelectorAll("[data-check]")].map((item) => ({ check: item.dataset.check, markedReviewed: item.checked })),
    findings,
    disclaimer: "This prototype extracts selectable PDF text and records reviewer-entered findings. It does not perform automated Western Power / CU compliance checks and is not an engineering approval."
  };
}
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("exportJson").addEventListener("click", () => {
  download("eve-design-review-record.json", JSON.stringify(reviewRecord(), null, 2), "application/json");
});
$("exportCsv").addEventListener("click", () => {
  const rows = [["Severity", "Sheet / location", "Finding and evidence", "Source / clause", "Status"], ...findings.map((f) => [f.severity, f.location, f.description, f.source, f.status])];
  const csv = rows.map((row) => row.map((value) => '"' + String(value ?? "").replace(/"/g, '""') + '"').join(",")).join("\r\n");
  download("eve-design-review-findings.csv", "\ufeff" + csv, "text/csv;charset=utf-8");
});
window.addEventListener("beforeunload", () => { if (pdfObjectUrl) URL.revokeObjectURL(pdfObjectUrl); });


// Secure team authentication and server-side Gemini review.
const SUPABASE_URL = "https://hszkloepnewfkzdegfhl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Avjn-CGtbEdeLaxSWCwQDw_36mgImSu";
let supabaseClient = null;
let signedInSession = null;

function setReviewStatus(message, isError = false) {
  const node = $("reviewStatus");
  node.textContent = message;
  node.classList.toggle("error-text", isError);
}
function updateAuthUi(session) {
  signedInSession = session || null;
  const email = session?.user?.email || "";
  $("authStatus").textContent = email || "Team sign-in required";
  $("authIndicator").classList.toggle("signed-in", Boolean(email));
  $("signOutButton").classList.toggle("hidden", !email);
  $("signInForm").classList.toggle("hidden", Boolean(email));
  $("signInMessage").textContent = email ? "Signed in. If review access is denied, the account may need to be provisioned in the EVE team profiles table." : "";
  $("runReview").disabled = !(session && currentFile);
  if (!session) setReviewStatus("Sign in and load a drawing PDF to enable review.");
  else if (!currentFile) setReviewStatus("Signed in. Load a drawing PDF to enable review.");
  else setReviewStatus("Ready to analyse " + currentFile.name + ". Add applicable standards excerpts for more traceable checks.");
}
async function initSecureReview() {
  try {
    const sdk = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    supabaseClient = sdk.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const { data } = await supabaseClient.auth.getSession();
    updateAuthUi(data.session);
    supabaseClient.auth.onAuthStateChange((_event, session) => updateAuthUi(session));
  } catch (error) {
    console.error("Could not initialise team sign-in", error);
    $("authStatus").textContent = "Sign-in service unavailable";
    $("signInMessage").textContent = "Could not load the sign-in service. Check your internet connection and refresh.";
    setReviewStatus("Authentication service could not load.", true);
  }
}
$("signInForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient) return;
  const button = $("signInButton");
  const email = $("teamEmail").value.trim();
  button.disabled = true;
  button.textContent = "Sending link…";
  $("signInMessage").textContent = "Requesting secure sign-in link…";
  try {
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href.split("#")[0], shouldCreateUser: false }
    });
    if (error) throw error;
    $("signInMessage").textContent = "If this email belongs to a registered EVE team account, a sign-in link has been sent. Check your inbox and spam folder.";
  } catch (error) {
    $("signInMessage").textContent = error?.message || "Could not send sign-in link. Check the email and Supabase Auth settings.";
  } finally {
    button.disabled = false;
    button.textContent = "Send sign-in link";
  }
});
$("signOutButton").addEventListener("click", async () => {
  if (supabaseClient) await supabaseClient.auth.signOut();
});
const originalLoadFile = loadFile;
loadFile = function(file) {
  originalLoadFile(file);
  setTimeout(() => {
    $("runReview").disabled = !(signedInSession && currentFile);
    if (signedInSession && currentFile) setReviewStatus("PDF loaded. Ready to run Gemini design review.");
  }, 0);
};

async function makeReviewPageImages(file) {
  const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const count = pdf.numPages;
  const candidates = [...new Set([1, Math.ceil(count / 2), count, ...extractedPages.filter(p => p.text.length < 35).map(p => p.page)])]
    .filter(n => n >= 1 && n <= count).slice(0, 4);
  const result = [];
  for (const pageNo of candidates) {
    const page = await pdf.getPage(pageNo);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(1.15, 1400 / Math.max(baseViewport.width, baseViewport.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d", { alpha: false });
    await page.render({ canvasContext: ctx, viewport }).promise;
    result.push({ page: pageNo, dataUrl: canvas.toDataURL("image/jpeg", 0.48) });
    canvas.width = 1; canvas.height = 1;
  }
  return result;
}
function renderAiReview(review) {
  const root = $("reviewResults");
  root.classList.remove("hidden");
  const findingsList = Array.isArray(review.findings) ? review.findings : [];
  const statusLabel = review.overall_status || "REVIEW_REQUIRED";
  const cards = findingsList.map((f, index) => {
    const evidence = (f.evidence || []).map(e => '<div class="evidence-line"><strong>Page ' + escapeHtml(e.page ?? "unknown") + ':</strong> ' + escapeHtml(e.quote || "No quote supplied") + '</div>').join("");
    const ref = f.reference || {};
    const sev = String(f.severity || "").toLowerCase();
    const sevClass = sev === "high" || sev === "critical" ? "high" : sev === "low" ? "low" : "unverified";
    const redline = f.redline_suggestion ? '<p class="redline-suggestion"><strong>Proposed redline:</strong> ' + escapeHtml(f.redline_suggestion) + '</p>' : "";
    return '<article class="ai-finding"><div class="ai-finding-top"><span class="finding-pill ' + sevClass + '">' + escapeHtml(f.severity || "Unverified") + '</span><span class="ai-category">' + escapeHtml(f.category || "Review") + '</span><span class="ai-confidence">Confidence: ' + escapeHtml(f.confidence || "Low") + '</span></div><h3>' + escapeHtml(f.id || "F-" + String(index + 1).padStart(3, "0")) + ' · ' + escapeHtml(f.title || "Review finding") + '</h3><p>' + escapeHtml(f.description || "") + '</p>' + evidence + '<div class="ai-ref"><strong>Reference:</strong> ' + escapeHtml(ref.document || "Not provided") + ' · ' + escapeHtml(ref.clause || "Not verified") + '</div><p><strong>Recommended action:</strong> ' + escapeHtml(f.recommended_action || "Manual verification required") + '</p>' + redline + '</article>';
  }).join("");
  const limitations = (review.limitations || []).map(x => "<li>" + escapeHtml(x) + "</li>").join("");
  const notDone = (review.checks_not_performed || []).map(x => "<li>" + escapeHtml(x) + "</li>").join("");
  const sourceLinks = (review.sources_consulted || []).filter(s => s.url).map(s => '<li><a href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(s.title || s.url) + '</a></li>').join("");
  root.innerHTML = '<div class="review-report-head"><div><span class="report-kicker">PRELIMINARY AI REVIEW</span><h2>' + escapeHtml(statusLabel.replaceAll("_", " ")) + '</h2><p>' + escapeHtml(review.summary || "No summary returned.") + '</p></div><button id="printAiReview" class="secondary-button" type="button">Print / Save PDF</button></div><div class="review-report-note">' + escapeHtml(review.disclaimer || "Human verification required.") + '</div><h3>Findings (' + findingsList.length + ')</h3>' + (cards || '<p class="empty">No specific finding was confidently identified from the supplied evidence. This does not establish compliance.</p>') + '<div class="review-extra"><h3>Official sources consulted</h3><ul>' + (sourceLinks || "<li>No source links returned by grounding; verify official publications manually.</li>") + '</ul><h3>Limitations</h3><ul>' + (limitations || "<li>Review limitations were not returned.</li>") + '</ul><h3>Checks not performed / incomplete</h3><ul>' + (notDone || "<li>Verify applicable current standards.</li>") + '</ul></div>';
  $("printAiReview").addEventListener("click", () => window.print());
}
$("runReview").addEventListener("click", async () => {
  if (!supabaseClient || !signedInSession || !currentFile) {
    setReviewStatus("Sign in with an EVE team account and load a PDF first.", true);
    return;
  }
  const button = $("runReview");
  button.disabled = true;
  button.textContent = "Analysing drawing…";
  $("reviewResults").classList.add("hidden");
  setReviewStatus("Rendering selected pages and sending a secure request to Gemini. Larger drawings may take a minute.");
  try {
    const drawingText = extractedPages.map(p => "[Page " + p.page + "]\n" + p.text).join("\n\n").slice(0, 90000);
    let pageImages = [];
    try {
      pageImages = await makeReviewPageImages(currentFile);
    } catch (imageError) {
      console.warn("Page image rendering failed; continuing with extracted PDF text.", imageError);
      setReviewStatus("Page images could not be rendered in this browser. Trying the extracted drawing text instead…");
    }
    if (!drawingText.trim() && pageImages.length === 0) {
      throw new Error("Could not extract drawing text or render page images. Try re-saving the PDF as an unencrypted PDF, then upload it again.");
    }
    setReviewStatus("Sending " + (drawingText.trim() ? "extracted drawing text" : "page images") + (pageImages.length ? " and " + pageImages.length + " page image(s)" : "") + " to the review service…");
    const { data, error } = await supabaseClient.functions.invoke("western-power-design-review", {
      body: {
        projectName: $("projectName").value.trim(),
        drawingRef: $("drawingRef").value.trim(),
        revision: $("revision").value.trim(),
        scope: $("scope").value,
        notes: $("reviewNotes").value.trim(),
        drawingText,
        standardsText: $("standardsText").value.trim(),
        pages: pageImages
      }
    });
    if (error) {
      let details = error.message || "Review request failed.";
      try { if (error.context) { const body = await error.context.json(); details = body.error || details; } } catch {}
      throw new Error(details);
    }
    if (!data?.ok || !data.review) throw new Error(data?.error || "Review did not return a result.");
    aiReview = data.review;
    renderAiReview(aiReview);
    const autoFindings = (aiReview.findings || []).map(f => ({
      severity: f.severity || "Unverified",
      location: (f.evidence || []).map(e => "Page " + (e.page ?? "unknown")).join(", ") || "Page not identified",
      description: (f.title ? f.title + ": " : "") + (f.description || "") + ((f.evidence || []).length ? " Evidence: " + f.evidence.map(e => e.quote || "").join(" | ") : ""),
      source: [f.reference?.document, f.reference?.clause].filter(Boolean).join(" — ") || "AI reference not verified",
      status: "Needs verification",
      aiGenerated: true
    }));
    findings = findings.filter(f => !f.aiGenerated).concat(autoFindings);
    renderFindings();
    setReviewStatus("Review complete. " + autoFindings.length + " AI finding(s) added to the findings register. Verify all results before use.");
    $("reviewResults").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    console.error("Gemini design review failed", error);
    setReviewStatus(error?.message || "Review failed. Please retry.", true);
  } finally {
    button.disabled = !(signedInSession && currentFile);
    button.textContent = "Run Gemini design review";
  }
});
initSecureReview();
