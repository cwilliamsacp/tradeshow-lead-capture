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

  // Crop to center region matching the guide overlay (85% width, 50% height)
  const cropW = Math.round(canvas.width * 0.85);
  const cropH = Math.round(canvas.height * 0.50);
  const cropX = Math.round((canvas.width - cropW) / 2);
  const cropY = Math.round((canvas.height - cropH) / 2);

  const cropped = document.createElement("canvas");
  cropped.width = cropW;
  cropped.height = cropH;
  const cCtx = cropped.getContext("2d");

  // Draw cropped region
  cCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  // Binarize: convert to high-contrast black text on white background
  const imageData = cCtx.getImageData(0, 0, cropW, cropH);
  const px = imageData.data;

  // First pass: compute grayscale values and average for adaptive threshold
  const grayValues = new Uint8Array(cropW * cropH);
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) {
    const gray = Math.round(px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
    grayValues[i / 4] = gray;
    sum += gray;
  }
  const avg = sum / grayValues.length;
  // Threshold biased toward keeping dark text
  const threshold = avg * 0.6;

  // Second pass: binarize to pure black/white
  for (let i = 0; i < px.length; i += 4) {
    const val = grayValues[i / 4] < threshold ? 0 : 255;
    px[i] = val;
    px[i + 1] = val;
    px[i + 2] = val;
  }
  cCtx.putImageData(imageData, 0, 0);

  // Scale up 2x for better OCR on small text
  const scaled = document.createElement("canvas");
  scaled.width = cropW * 2;
  scaled.height = cropH * 2;
  const sCtx = scaled.getContext("2d");
  sCtx.imageSmoothingEnabled = false;
  sCtx.drawImage(cropped, 0, 0, scaled.width, scaled.height);

  closeCamera();
  await runOCR(scaled);
}

// ============================================================
// OCR
// ============================================================
const linePicker    = $("#line-picker");
const ocrLinesDiv   = $("#ocr-lines");
const pickerTarget  = $("#picker-target");
const pickerSkipBtn = $("#picker-skip");

let pickerPhase = ""; // "name" or "company"

async function runOCR(canvas) {
  processingOverlay.classList.remove("hidden");

  let lines = [];
  try {
    if (!tesseractWorker) {
      await initTesseract();
    }

    await tesseractWorker.setParameters({
      tessedit_pageseg_mode: "6",
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,-'&@/",
    });
    const { data } = await tesseractWorker.recognize(canvas);

    lines = data.text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 1 && !/^\d+$/.test(l));
  } catch (err) {
    console.error("OCR error:", err);
  }

  processingOverlay.classList.add("hidden");

  // Reset form
  leadName.value = "";
  leadCompany.value = "";
  leadNotes.value = "";

  if (lines.length > 0) {
    showLinePicker(lines);
  } else {
    // No text found — go straight to manual form
    showManualForm();
    showToast("Could not read badge text. Please type manually.", "error");
  }
}

function showLinePicker(lines) {
  ocrLinesDiv.innerHTML = "";
  lines.forEach((line) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ocr-line-btn";
    btn.textContent = line;
    btn.addEventListener("click", () => onLinePicked(btn, line));
    ocrLinesDiv.appendChild(btn);
  });

  pickerPhase = "name";
  pickerTarget.textContent = "Name";
  linePicker.classList.remove("hidden");
  leadForm.classList.add("hidden");
  reviewModal.classList.remove("hidden");
}

function onLinePicked(btn, text) {
  btn.classList.add("used");

  if (pickerPhase === "name") {
    leadName.value = text;
    pickerPhase = "company";
    pickerTarget.textContent = "Company";
  } else {
    leadCompany.value = text;
    showManualForm();
  }
}

function showManualForm() {
  linePicker.classList.add("hidden");
  leadForm.classList.remove("hidden");
  reviewModal.classList.remove("hidden");
  leadName.focus();
}

pickerSkipBtn.addEventListener("click", showManualForm);

// ============================================================
// Review Form
// ============================================================
reviewCancelBtn.addEventListener("click", () => {
  reviewModal.classList.add("hidden");
  linePicker.classList.add("hidden");
  leadForm.classList.remove("hidden");
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
