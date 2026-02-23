// ============================================================
// Google Apps Script — paste this into a new project at
// https://script.google.com
//
// Setup:
//   1. Go to https://script.google.com → New project
//   2. Replace all code with this file's contents
//   3. Deploy → New deployment → Web app
//      - Execute as: Me
//      - Who has access: Anyone
//   4. Copy the deployment URL into app.js (APPS_SCRIPT_URL)
//   5. Make sure your sheet has headers in Row 1:
//      Timestamp | Name | Company | Notes | Scanned By
// ============================================================

var SHEET_ID = "1d-x3AP0K0ZBI6BzjC7OSBcrShSdugHTTu_JAo7xsqo4";

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
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
