// ============================================================
// Google Apps Script — paste this into Extensions → Apps Script
// in your "Tradeshow Leads" Google Sheet.
//
// Setup:
//   1. Create a Google Sheet named "Tradeshow Leads"
//   2. Add headers in Row 1: Timestamp | Name | Company | Notes | Scanned By
//   3. Extensions → Apps Script → paste this code
//   4. Deploy → New deployment → Web app
//      - Execute as: Me
//      - Who has access: Anyone
//   5. Copy the deployment URL into app.js (APPS_SCRIPT_URL)
// ============================================================

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);

    sheet.appendRow([
      new Date().toLocaleString(),
      data.name || "",
      data.company || "",
      data.notes || "",
      data.scannedBy || ""
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
