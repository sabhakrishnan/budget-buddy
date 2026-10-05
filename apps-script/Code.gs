/**
 * Budget Buddy — Email Sync (Google Apps Script)
 * ------------------------------------------------
 * Runs INSIDE your own Google account (free, no server). Every 15 minutes it
 * reads your bank / UPI "you spent" emails, extracts amount + merchant + date,
 * and writes them to a private Google Sheet. Your phone app then reads that
 * sheet (published as CSV) and drops the spends into the right month + category.
 *
 * ============ ONE-TIME SETUP (~5 min) — use your PERSONAL Google account ============
 * 1.  Open https://script.google.com  →  New project.
 * 2.  Delete the sample code, paste THIS whole file, and Save (Ctrl/Cmd+S).
 * 3.  In the function dropdown pick `setup`, click Run ▶, and approve the Gmail
 *     permission prompt (it's your own account reading your own mail).
 *       • This creates a spreadsheet called "Budget Buddy Data" in your Drive
 *         and a timer that runs every 15 minutes.
 * 4.  Open that spreadsheet (its link is printed in the Run log, View → Logs).
 *     File → Share → Publish to web → pick the "Transactions" sheet,
 *     format = Comma-separated values (.csv) → Publish. Copy the URL.
 * 5.  In the phone app:  Data → Email sync → paste the URL → Save link → Sync now.
 *
 * New spends then appear in the app within ~15 min of the email arriving.
 * To add a bank/sender, add it to SENDERS below and Save.
 *
 * PRIVACY: only amount, merchant and date are stored — never account numbers,
 * card numbers or email contents. The published CSV link is secret; keep it private.
 */

const SPREADSHEET_NAME = 'Budget Buddy Data';
const SHEET_NAME = 'Transactions';
const LOOKBACK = 'newer_than:3d';   // how far back each run scans
const MAX_THREADS = 150;

// Senders that send you spend alerts. Add/remove to match your banks & cards.
const SENDERS = [
  'hdfcbank.net', 'hdfcbank.com',
  'sbi.co.in', 'onlinesbi.sbi', 'sbicard.com',
  'icicibank.com', 'axisbank.com', 'iob.in',
  'google.com',            // Google Pay receipts
  'phonepe.com', 'paytm.com'
];

/** Run this once from the editor to create the sheet + 15-min trigger. */
function setup() {
  const ss = getOrCreateSpreadsheet_();
  const exists = ScriptApp.getProjectTriggers()
    .some((t) => t.getHandlerFunction() === 'syncBankEmails');
  if (!exists) {
    ScriptApp.newTrigger('syncBankEmails').timeBased().everyMinutes(15).create();
  }
  syncBankEmails();
  Logger.log('✅ Spreadsheet created: ' + ss.getUrl());
  Logger.log('➡ Now: File > Share > Publish to web > "%s" sheet as CSV, then paste that URL into the app.', SHEET_NAME);
}

/** Time-triggered: scan Gmail and append new spends to the sheet. */
function syncBankEmails() {
  const ss = getOrCreateSpreadsheet_();
  const sh = ss.getSheetByName(SHEET_NAME);
  const seen = getSeenIds_(sh);

  const query = '(' + SENDERS.map((s) => 'from:' + s).join(' OR ') + ') ' +
    '(debited OR spent OR "you paid" OR "payment of" OR "has been debited" OR "spent on") ' +
    LOOKBACK;

  const threads = GmailApp.search(query, 0, MAX_THREADS);
  const rows = [];
  threads.forEach((th) => {
    th.getMessages().forEach((m) => {
      const id = m.getId();
      if (seen[id]) return;
      const parsed = parseEmail_(m.getPlainBody());
      if (!parsed || !parsed.amount) return;  // not a spend we understood
      rows.push([
        Utilities.formatDate(m.getDate(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
        parsed.amount, parsed.merchant, parsed.category, 'email', id
      ]);
      seen[id] = true;
    });
  });

  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  }
}

function getOrCreateSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  let ss = null;
  const id = props.getProperty('ssId');
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(SPREADSHEET_NAME);
    props.setProperty('ssId', ss.getId());
  }
  let sh = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  sh.setName(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['Date', 'Amount', 'Merchant', 'Category', 'Source', 'MsgId']);
  }
  return ss;
}

function getSeenIds_(sh) {
  const seen = {};
  const last = sh.getLastRow();
  if (last < 2) return seen;
  sh.getRange(2, 6, last - 1, 1).getValues().forEach((r) => { if (r[0]) seen[r[0]] = true; });
  return seen;
}

/** Extract { amount, merchant, category } from an email body (null if not a spend). */
function parseEmail_(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  // Skip credits / refunds / failures.
  if (/credited|refund|received|reversal|failed|declined/i.test(t) &&
    !/debited|spent|you paid|payment of/i.test(t)) return null;

  let amount = 0;
  const am = t.match(/(?:inr|rs|₹)\.?\s*([\d,]+(?:\.\d{1,2})?)/i) ||
    t.match(/\bdebited(?:\s+by|\s+with)?\s*(?:inr|rs|₹)?\.?\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (am) amount = Number(am[1].replace(/,/g, ''));

  let name = '';
  const m =
    t.match(/\b(?:to VPA|VPA)\s+([a-z0-9._-]+)@/i) ||
    t.match(/\bpaid\s+(?:inr|rs|₹)?\.?[\d,.]*\s+to\s+([A-Za-z0-9&.\- ]{2,40})/i) ||
    t.match(/\b(?:at|to|towards|for)\s+([A-Za-z0-9&.\- ]{2,40}?)\s+(?:on|dated|ref|via|using|for|a\/c|txn|upi|info|is\b)/i) ||
    t.match(/\b(?:at|to)\s+([A-Za-z0-9&.\- ]{2,40})/i);
  if (m) name = m[1].trim().replace(/[.\-]+$/, '');

  return { amount: amount, merchant: name, category: autoCategory_(t) };
}

function autoCategory_(text) {
  const s = ' ' + String(text || '').toLowerCase() + ' ';
  const rules = [
    ['Food', ['swiggy', 'zomato', 'restaurant', 'hotel', 'cafe', 'dominos', 'mcdonald', 'kfc', 'biryani', 'pizza', 'bakery']],
    ['Groceries', ['bigbasket', 'dmart', 'blinkit', 'zepto', 'grocery', 'supermarket', 'reliance fresh', 'jiomart', 'kirana']],
    ['Fuel', ['iocl', 'indian oil', 'hpcl', 'bpcl', 'bharat petroleum', 'shell', 'nayara', 'petrol', 'diesel', 'fuel', 'fastag']],
    ['Shopping', ['amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'nykaa', 'tatacliq', 'decathlon', 'ikea']],
    ['Transport', ['uber', 'ola', 'rapido', 'irctc', 'metro', 'redbus', 'cab', 'indigo', 'spicejet', 'railway', 'toll']],
    ['Bills', ['electricity', 'water bill', 'broadband', 'airtel', 'jio', 'vodafone', 'recharge', 'dth', 'postpaid', 'bill', 'emi', 'loan', 'nach', 'insurance', 'premium', 'sip']],
    ['Health', ['pharmacy', 'apollo', 'medplus', 'hospital', 'clinic', 'medicine', 'diagnostic', 'netmeds', 'pharmeasy']],
    ['Fun', ['netflix', 'spotify', 'hotstar', 'prime video', 'bookmyshow', 'pvr', 'inox', 'cinema', 'disney']]
  ];
  for (let i = 0; i < rules.length; i++) {
    if (rules[i][1].some((k) => s.indexOf(k) !== -1)) return rules[i][0];
  }
  return '';
}
