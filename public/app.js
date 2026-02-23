// ============================================================
// Configuration — set your Google Apps Script deployment URL here
// ============================================================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwGH-V9K97Uu4aHRulaxkqlF-CSkbHYCUJDTj-_ZoB-XGvHtP4b37sH2uprP6hRzhCZ/exec";

// ============================================================
// DOM references
// ============================================================
const $ = (sel) => document.querySelector(sel);

const setupScreen    = $("#setup-screen");
const mainScreen     = $("#main-screen");
const staffInput     = $("#staff-name-input");
const staffSubmitBtn = $("#staff-name-submit");
const staffBadge     = $("#staff-badge");
const scanBtn        = $("#scan-btn");
const scansList      = $("#scans-list");
const offlineBanner  = $("#offline-banner");
const queueStatus    = $("#queue-status");
const queueCount     = $("#queue-count");
const retryQueueBtn  = $("#retry-queue-btn");

const cameraModal    = $("#camera-modal");
const cameraFeed     = $("#camera-feed");
const captureBtn     = $("#camera-capture");
const cameraCancelBtn = $("#camera-cancel");

const processingOverlay = $("#processing-overlay");

const reviewModal    = $("#review-modal");
const leadForm       = $("#lead-form");
const leadName       = $("#lead-name");
const leadCompany    = $("#lead-company");
const leadNotes      = $("#lead-notes");
const reviewCancelBtn = $("#review-cancel");

const captureCanvas  = $("#capture-canvas");

// ============================================================
// State
// ============================================================
let staffName = localStorage.getItem("staffName") || "";
let recentScans = JSON.parse(localStorage.getItem("recentScans") || "[]");
let offlineQueue = JSON.parse(localStorage.getItem("offlineQueue") || "[]");
let cameraStream = null;
let tesseractWorker = null;

// ============================================================
// Initialization
// ============================================================
function init() {
  if (staffName) {
    showMainScreen();
  } else {
    setupScreen.classList.remove("hidden");
  }

  renderRecentScans();
  updateQueueStatus();
  initTesseract();

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  if (!navigator.onLine) onOffline();
}

// ============================================================
// Tesseract — pre-initialize worker for faster scans
// ============================================================
async function initTesseract() {
  try {
    tesseractWorker = await Tesseract.createWorker("eng", 1, {
      logger: () => {},
    });
  } catch (err) {
    console.error("Tesseract init failed:", err);
  }
}

// ============================================================
// Staff Name Setup
// ============================================================
staffSubmitBtn.addEventListener("click", saveStaffName);
staffInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveStaffName();
});

function saveStaffName() {
  const name = staffInput.value.trim();
  if (!name) return;
  staffName = name;
  localStorage.setItem("staffName", staffName);
  showMainScreen();
}

function showMainScreen() {
  setupScreen.classList.add("hidden");
  mainScreen.classList.remove("hidden");
  staffBadge.textContent = staffName;
}

// ============================================================
// Camera
// ============================================================
scanBtn.addEventListener("click", openCamera);
cameraCancelBtn.addEventListener("click", closeCamera);
captureBtn.addEventListener("click", captureImage);

async function openCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    cameraFeed.srcObject = cameraStream;
    cameraModal.classList.remove("hidden");
  } catch (err) {
    showToast("Camera access denied. Check browser permissions.", "error");
  }
}

function closeCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  cameraFeed.srcObject = null;
  cameraModal.classList.add("hidden");
}

async function captureImage() {
  const video = cameraFeed;
  const canvas = captureCanvas;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0);

  // Crop to center region matching the guide overlay (85% width, 30% height)
  const cropW = Math.round(canvas.width * 0.85);
  const cropH = Math.round(canvas.height * 0.30);
  const cropX = Math.round((canvas.width - cropW) / 2);
  const cropY = Math.round((canvas.height - cropH) / 2);

  const cropped = document.createElement("canvas");
  cropped.width = cropW;
  cropped.height = cropH;
  const cCtx = cropped.getContext("2d");

  // Draw cropped region
  cCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  // Convert to grayscale for better OCR
  const imageData = cCtx.getImageData(0, 0, cropW, cropH);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }
  cCtx.putImageData(imageData, 0, 0);

  closeCamera();
  await runOCR(cropped);
}

// ============================================================
// OCR
// ============================================================
async function runOCR(canvas) {
  processingOverlay.classList.remove("hidden");

  try {
    if (!tesseractWorker) {
      await initTesseract();
    }

    const { data } = await tesseractWorker.recognize(canvas);
    const parsed = parseOCRText(data.text);

    leadName.value = parsed.name;
    leadCompany.value = parsed.company;
    leadNotes.value = "";
  } catch (err) {
    console.error("OCR error:", err);
    leadName.value = "";
    leadCompany.value = "";
    leadNotes.value = "";
    showToast("Could not read badge text. Please type manually.", "error");
  }

  processingOverlay.classList.add("hidden");
  reviewModal.classList.remove("hidden");
  leadName.focus();
}

function parseOCRText(raw) {
  // Split into non-empty lines and trim whitespace
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 1);

  let name = "";
  let company = "";

  // Common badge layout: Name on first prominent line, Company on second
  // Heuristic: skip very short tokens and lines that look like titles/roles
  const rolePrefixes = /^(mr|ms|mrs|dr|prof|director|manager|vp|ceo|cto|cfo|coo|evp|svp|sr|jr|eng)/i;

  for (const line of lines) {
    // Skip lines that are just numbers or very short
    if (/^\d+$/.test(line)) continue;

    if (!name) {
      // First meaningful line is likely the name
      if (!rolePrefixes.test(line) || line.split(/\s+/).length > 1) {
        name = line;
      }
    } else if (!company) {
      // Second meaningful line is likely the company
      company = line;
      break;
    }
  }

  return { name, company };
}

// ============================================================
// Review Form
// ============================================================
reviewCancelBtn.addEventListener("click", () => {
  reviewModal.classList.add("hidden");
});

leadForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const leadData = {
    name: leadName.value.trim(),
    company: leadCompany.value.trim(),
    notes: leadNotes.value.trim(),
    scannedBy: staffName,
    timestamp: new Date().toISOString(),
  };

  if (!leadData.name) {
    showToast("Name is required.", "error");
    return;
  }

  reviewModal.classList.add("hidden");

  // Save to recent scans immediately
  addRecentScan(leadData, false);

  // Try to submit
  const sent = await submitLead(leadData);
  if (sent) {
    markScanSent(leadData.timestamp);
    showToast("Lead saved!");
  } else {
    addToQueue(leadData);
    showToast("Saved offline. Will send when reconnected.", "error");
  }
});

// ============================================================
// Google Sheets Submission
// ============================================================
async function submitLead(data) {
  if (APPS_SCRIPT_URL === "YOUR_APPS_SCRIPT_URL_HERE") {
    console.warn("Apps Script URL not configured — saving locally only.");
    return false;
  }

  if (!navigator.onLine) return false;

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(data),
      mode: "no-cors",
    });
    // no-cors means we can't read the response, but the request was sent
    return true;
  } catch (err) {
    console.error("Submit failed:", err);
    return false;
  }
}

// ============================================================
// Offline Queue
// ============================================================
function addToQueue(data) {
  offlineQueue.push(data);
  localStorage.setItem("offlineQueue", JSON.stringify(offlineQueue));
  updateQueueStatus();
}

async function flushQueue() {
  if (offlineQueue.length === 0) return;
  if (!navigator.onLine) return;

  const remaining = [];
  for (const item of offlineQueue) {
    const sent = await submitLead(item);
    if (sent) {
      markScanSent(item.timestamp);
    } else {
      remaining.push(item);
    }
  }

  offlineQueue = remaining;
  localStorage.setItem("offlineQueue", JSON.stringify(offlineQueue));
  updateQueueStatus();

  if (remaining.length === 0 && offlineQueue.length === 0) {
    showToast("All queued leads submitted!");
  }
}

function updateQueueStatus() {
  if (offlineQueue.length > 0) {
    queueStatus.classList.remove("hidden");
    queueCount.textContent = offlineQueue.length;
  } else {
    queueStatus.classList.add("hidden");
  }
}

retryQueueBtn.addEventListener("click", flushQueue);

// ============================================================
// Recent Scans List
// ============================================================
function addRecentScan(data, sent) {
  recentScans.unshift({ ...data, sent });
  if (recentScans.length > 50) recentScans = recentScans.slice(0, 50);
  localStorage.setItem("recentScans", JSON.stringify(recentScans));
  renderRecentScans();
}

function markScanSent(timestamp) {
  const scan = recentScans.find((s) => s.timestamp === timestamp);
  if (scan) {
    scan.sent = true;
    localStorage.setItem("recentScans", JSON.stringify(recentScans));
    renderRecentScans();
  }
}

function renderRecentScans() {
  if (recentScans.length === 0) {
    scansList.innerHTML = '<li class="empty-state">No scans yet. Tap "Scan Badge" to start.</li>';
    return;
  }

  scansList.innerHTML = recentScans
    .map(
      (s) => `
    <li>
      <div class="scan-item-name">${escapeHTML(s.name)}</div>
      ${s.company ? `<div class="scan-item-company">${escapeHTML(s.company)}</div>` : ""}
      <div class="scan-item-status ${s.sent ? "sent" : "queued"}">
        ${s.sent ? "Sent to sheet" : "Queued"}
      </div>
    </li>`
    )
    .join("");
}

// ============================================================
// Online / Offline Handling
// ============================================================
function onOnline() {
  offlineBanner.classList.add("hidden");
  flushQueue();
}

function onOffline() {
  offlineBanner.classList.remove("hidden");
}

// ============================================================
// Toast Notifications
// ============================================================
function showToast(message, type = "success") {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

// ============================================================
// Utility
// ============================================================
function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// Boot
// ============================================================
init();
