// ============================================================
// Google Apps Script — paste this into your existing project at
// https://script.google.com
//
// Setup:
//   1. Go to your existing Apps Script project
//   2. Replace all code with this file's contents
//   3. Deploy → Manage deployments → Edit → New version
//   4. In your Google Sheet, create a new tab called "Leads"
//   5. Add these headers in Row 1 of the "Leads" tab:
//      Timestamp | Name | Company | Email | Phone | Rating | Products | Notes | Captured By
// ============================================================

var SHEET_ID = "1d-x3AP0K0ZBI6BzjC7OSBcrShSdugHTTu_JAo7xsqo4";
var TAB_NAME = "Leads";

function doPost(e) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(TAB_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(TAB_NAME);
      sheet.appendRow([
        "Timestamp", "Name", "Company", "Email", "Phone",
        "Rating", "Products", "Notes", "Captured By"
      ]);
    }

    var data = JSON.parse(e.postData.contents);

    sheet.appendRow([
      new Date().toLocaleString(),
      data.name || "",
      data.company || "",
      data.email || "",
      data.phone || "",
      data.rating || "",
      data.products || "",
      data.notes || "",
      data.capturedBy || ""
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
