// ============================================================
// Configuration — set your Google Apps Script deployment URL here
// ============================================================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzlGTUNCsagN0ucklS63INQlHU1Z5sq8SoaTuvBTxoPuPkL0YKHNUmQ5PmXoGE5nCBK/exec";

// ============================================================
// Products / Services — customize this list for your booth
// ============================================================
const PRODUCTS = [
  "Copiers",
  "Interactive Displays",
  "Phones",
  "Security Cameras",
  "Access Control",
  "Managed IT Services",
  "AI",
  "Custom Apparel",
  "Custom Merch",
];

// ============================================================
// DOM references
// ============================================================
const $ = (sel) => document.querySelector(sel);

const setupScreen    = $("#setup-screen");
const mainScreen     = $("#main-screen");
const staffInput     = $("#staff-name-input");
const staffSubmitBtn = $("#staff-name-submit");
const staffBadge     = $("#change-staff");
const offlineBanner  = $("#offline-banner");
const queueStatus    = $("#queue-status");
const queueCount     = $("#queue-count");
const retryQueueBtn  = $("#retry-queue-btn");

const leadForm       = $("#lead-form");
const leadName       = $("#lead-name");
const leadCompany    = $("#lead-company");
const leadEmail      = $("#lead-email");
const leadPhone      = $("#lead-phone");
const ratingGroup    = $("#rating-group");
const selectedProductsDiv = $("#selected-products");
const leadNotes      = $("#lead-notes");
const leadsList      = $("#leads-list");

// ============================================================
// State
// ============================================================
let staffName = localStorage.getItem("staffName") || "";
let recentLeads = JSON.parse(localStorage.getItem("recentLeads") || "[]");
let offlineQueue = JSON.parse(localStorage.getItem("offlineQueue") || "[]");
let selectedRating = "";
let selectedProducts = new Set();

// ============================================================
// Initialization
// ============================================================
function init() {
  if (staffName) {
    showMainScreen();
  } else {
    setupScreen.classList.remove("hidden");
  }

  buildProductTags();
  renderRecentLeads();
  updateQueueStatus();

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  if (!navigator.onLine) onOffline();
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

staffBadge.addEventListener("click", () => {
  const newName = prompt("Change staff name:", staffName);
  if (newName && newName.trim()) {
    staffName = newName.trim();
    localStorage.setItem("staffName", staffName);
    staffBadge.textContent = staffName;
  }
});

// ============================================================
// Rating Buttons
// ============================================================
ratingGroup.addEventListener("click", (e) => {
  const btn = e.target.closest(".rating-btn");
  if (!btn) return;

  const rating = btn.dataset.rating;

  // Toggle off if already selected
  if (selectedRating === rating) {
    selectedRating = "";
    btn.classList.remove("active");
    return;
  }

  selectedRating = rating;
  ratingGroup.querySelectorAll(".rating-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
});

// ============================================================
// Product Tags
// ============================================================
let otherInput = null;

function buildProductTags() {
  selectedProductsDiv.textContent = "";
  PRODUCTS.forEach((product) => {
    const tag = document.createElement("span");
    tag.className = "product-tag";
    tag.textContent = product;
    tag.addEventListener("click", () => toggleProduct(tag, product));
    selectedProductsDiv.appendChild(tag);
  });

  // "Other" tag with fillable field
  const otherTag = document.createElement("span");
  otherTag.className = "product-tag";
  otherTag.textContent = "Other";
  otherTag.addEventListener("click", () => {
    const isActive = otherTag.classList.toggle("active");
    if (isActive) {
      otherInput.classList.remove("hidden");
      otherInput.focus();
    } else {
      otherInput.classList.add("hidden");
      otherInput.value = "";
    }
  });
  selectedProductsDiv.appendChild(otherTag);

  otherInput = document.createElement("input");
  otherInput.type = "text";
  otherInput.className = "other-product-input hidden";
  otherInput.placeholder = "Specify other product/service";
  selectedProductsDiv.parentNode.insertBefore(otherInput, selectedProductsDiv.nextSibling);
}

function toggleProduct(tag, product) {
  if (selectedProducts.has(product)) {
    selectedProducts.delete(product);
    tag.classList.remove("active");
  } else {
    selectedProducts.add(product);
    tag.classList.add("active");
  }
}

function getSelectedProducts() {
  const products = [...selectedProducts];
  if (otherInput && otherInput.value.trim()) {
    products.push("Other: " + otherInput.value.trim());
  }
  return products.join(", ");
}

function resetProductTags() {
  selectedProducts.clear();
  selectedProductsDiv.querySelectorAll(".product-tag").forEach((t) => t.classList.remove("active"));
  if (otherInput) {
    otherInput.value = "";
    otherInput.classList.add("hidden");
  }
}

// ============================================================
// Form Submission
// ============================================================
leadForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const leadData = {
    name: leadName.value.trim(),
    company: leadCompany.value.trim(),
    email: leadEmail.value.trim(),
    phone: leadPhone.value.trim(),
    rating: selectedRating,
    products: getSelectedProducts(),
    notes: leadNotes.value.trim(),
    capturedBy: staffName,
    timestamp: new Date().toISOString(),
  };

  if (!leadData.name) {
    showToast("Name is required.", "error");
    leadName.focus();
    return;
  }

  // Save to recent leads immediately
  addRecentLead(leadData, false);

  // Reset form
  leadForm.reset();
  selectedRating = "";
  ratingGroup.querySelectorAll(".rating-btn").forEach((b) => b.classList.remove("active"));
  resetProductTags();
  leadName.focus();

  // Try to submit
  const sent = await submitLead(leadData);
  if (sent) {
    markLeadSent(leadData.timestamp);
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
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(data),
      mode: "no-cors",
    });
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
      markLeadSent(item.timestamp);
    } else {
      remaining.push(item);
    }
  }

  offlineQueue = remaining;
  localStorage.setItem("offlineQueue", JSON.stringify(offlineQueue));
  updateQueueStatus();

  if (remaining.length === 0) {
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
// Recent Leads List
// ============================================================
function addRecentLead(data, sent) {
  recentLeads.unshift({ ...data, sent });
  if (recentLeads.length > 50) recentLeads = recentLeads.slice(0, 50);
  localStorage.setItem("recentLeads", JSON.stringify(recentLeads));
  renderRecentLeads();
}

function markLeadSent(timestamp) {
  const lead = recentLeads.find((l) => l.timestamp === timestamp);
  if (lead) {
    lead.sent = true;
    localStorage.setItem("recentLeads", JSON.stringify(recentLeads));
    renderRecentLeads();
  }
}

function renderRecentLeads() {
  leadsList.textContent = "";

  if (recentLeads.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-state";
    li.textContent = "No leads captured yet.";
    leadsList.appendChild(li);
    return;
  }

  recentLeads.forEach((l) => {
    const li = document.createElement("li");

    const header = document.createElement("div");
    header.className = "lead-item-header";

    const nameSpan = document.createElement("span");
    nameSpan.className = "lead-item-name";
    nameSpan.textContent = l.name;
    header.appendChild(nameSpan);

    if (l.rating) {
      const ratingSpan = document.createElement("span");
      ratingSpan.className = "lead-item-rating " + l.rating.toLowerCase();
      ratingSpan.textContent = l.rating;
      header.appendChild(ratingSpan);
    }

    li.appendChild(header);

    if (l.company) {
      const companyDiv = document.createElement("div");
      companyDiv.className = "lead-item-company";
      companyDiv.textContent = l.company;
      li.appendChild(companyDiv);
    }

    const statusDiv = document.createElement("div");
    statusDiv.className = "lead-item-status " + (l.sent ? "sent" : "queued");
    statusDiv.textContent = l.sent ? "Sent to sheet" : "Queued";
    li.appendChild(statusDiv);

    leadsList.appendChild(li);
  });
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
  toast.className = "toast " + type;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

// ============================================================
// Boot
// ============================================================
init();
