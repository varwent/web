/**
 * Varwent — "Let's talk" leads → Google Sheets
 *
 * Paste this into the sheet's Apps Script editor (Extensions → Apps Script),
 * run `setup` once, then deploy as a web app. Full steps: docs/lets-talk-setup.md
 *
 * The website's /api/lets-talk function POSTs each lead here after saving it
 * to MongoDB. Rows are de-duplicated by Lead ID, so retries are safe.
 */

const SHEET_NAME = 'Leads';
const HEADERS = ['Received', 'Name', 'Email', 'Company', 'Services', 'Budget', 'Message', 'Page', 'Lead ID'];
const ID_COLUMN = HEADERS.indexOf('Lead ID') + 1;

/** Run once from the editor: creates the Leads tab and a shared secret. */
function setup() {
  getSheet_();
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SHARED_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('SHARED_SECRET', secret);
  }
  Logger.log('SHEETS_WEBHOOK_SECRET for Vercel:\n' + secret);
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
    if (!secret || body.secret !== secret) return json_({ ok: false, error: 'unauthorized' });

    const lead = body.lead || {};
    if (!lead.id) return json_({ ok: false, error: 'missing lead id' });

    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const sheet = getSheet_();
      if (hasLead_(sheet, lead.id)) return json_({ ok: true, duplicate: true });
      sheet.appendRow([
        lead.createdAt ? new Date(lead.createdAt) : new Date(),
        safe_(lead.name),
        safe_(lead.email),
        safe_(lead.company),
        safe_(lead.services),
        safe_(lead.budget),
        safe_(lead.message),
        safe_(lead.page),
        safe_(lead.id),
      ]);
    } finally {
      lock.releaseLock();
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** Lets you open the web app URL in a browser to check it's live. */
function doGet() {
  return json_({ ok: true, service: 'varwent-leads' });
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('A:A').setNumberFormat('dd mmm yyyy, hh:mm');
    sheet.setColumnWidth(7, 420);
  }
  return sheet;
}

function hasLead_(sheet, id) {
  const rows = sheet.getLastRow() - 1;
  if (rows < 1) return false;
  return Boolean(
    sheet.getRange(2, ID_COLUMN, rows, 1).createTextFinder(String(id)).matchEntireCell(true).findNext()
  );
}

// Stop text like "=IMPORTXML(...)" from being run as a formula.
function safe_(value) {
  const s = value == null ? '' : String(value);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
