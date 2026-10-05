# Budget Buddy

A simple, phone-friendly monthly budget & expense tracker. No server, no login, no cost.
Your data stays on your device (browser storage) and you can export/import it as Excel.

Built around these Excel columns:

- **Fixed items:** Detail, Amount, Cr/Db, Auto-Debit, Fixed/OM, Percentage of my Salary, From Bank, Budget
- **Expenses:** Expenses, Amount, Details

## What it does

- **Setup once:** salary, banks, fixed income/expenses, and savings goals.
- **Each month:** confirm fixed items (mark paid), add new expenses, and get a budget check.
- **Home:** see income vs spend, what's left, an **available balance + suggested daily spend limit**, a **"where it's going"** category breakdown, savings-goal progress, and a spending trend.
- **Capture:** paste a bank SMS (any phone), Android share-to-add, or **automatic email sync** via Google Apps Script.
- **Data:** email sync, a daily reminder, export/import Excel (`.xlsx`) or CSV, load **December starter data** (from your sheet), and a one-tap reset.

> Tip: On first run, tap **"Load my December data"** (or **Data → Load December starter data**) to pre-fill your salary, rent, loans, and EMIs so you don't type them in.

## Fast capture (log a spend in ~2 taps)

Instead of auto-reading your email (fragile + privacy-heavy), capture stays fast but private — nothing leaves your phone:

- **Paste a bank SMS:** on the **Month** tab, paste your bank/UPI alert into the "Paste a bank SMS" box. The amount, merchant, and category fill in automatically. Works on **any phone**.
- **Auto-category:** merchants are categorised locally by keyword (Swiggy/Zomato → Food, BigBasket → Groceries, IOCL/HP → Fuel, Amazon → Shopping, EMI/loan → Bills, …).
- **Android — Share-to-add:** after installing the app, open a bank SMS/notification → **Share** → **Budget Buddy**. It opens with the expense pre-filled; just tap **Add**.
- **iPhone — Shortcut:** iOS doesn't let web apps receive shares, so use the **Shortcuts** app → new shortcut → *Get Clipboard* → *Open URL* `https://<you>.github.io/budget-buddy/index.html?text=[Clipboard]`. Copy a bank SMS, run the shortcut (add it to your Home Screen / Back Tap), and the expense is pre-filled.
- **Quick add shortcut:** long-press the app icon (Android) → **Add expense** jumps straight to the entry form.

## Email sync (automatic capture, no server)

For spends that don't send an SMS, email sync reads your bank/UPI **emails** and drops them into the app automatically — all inside **your own Google account**, so you don't run a server.

**How it works:** a small Google Apps Script (in [apps-script/Code.gs](apps-script/Code.gs)) runs every 15 min, reads new bank emails, extracts amount + merchant + date into a private Google Sheet. The app reads that sheet (published as CSV) on open and whenever you tap **Sync now** — deduping so nothing is double-counted.

**Setup (one time, ~5 min — use your personal Google account):**
1. Open <https://script.google.com> → **New project**, paste all of [apps-script/Code.gs](apps-script/Code.gs), Save.
2. Run the `setup` function once and approve the Gmail permission. It creates a **"Budget Buddy Data"** sheet + a 15-min timer.
3. Open that sheet → **File → Share → Publish to web** → the **Transactions** sheet as **CSV** → **Publish**. Copy the URL.
4. In the app: **Data → Email sync** → paste the URL → **Save link** → **Sync now**.

Edit the `SENDERS` list in the script to match your banks/cards. Only amount, merchant and date are stored — never account numbers. Keep the CSV link private.

> **Daily reminder:** **Data → Daily reminder** downloads a recurring calendar event so your phone nudges you to log/review each day (works on any phone).

---

## Run it locally on your laptop (to try it)

Any static file server works. Easiest options:

```bash
cd budget-buddy

# Option A: Python (already on macOS)
python3 -m http.server 8080

# Option B: Node
npx serve .
```

Then open http://localhost:8080 in a browser.

> Note: the service worker (offline mode) needs `http://` or `https://`, not opening the file directly. The commands above handle that.

---

## Put it on your phone (free, via GitHub Pages)

1. **Create a GitHub repo** (e.g. `budget-buddy`) on github.com.
2. **Push this folder** to it:

   ```bash
   cd budget-buddy
   git init
   git add .
   git commit -m "Budget Buddy app"
   git branch -M main
   git remote add origin https://github.com/<your-username>/budget-buddy.git
   git push -u origin main
   ```

3. **Turn on GitHub Pages:** repo → **Settings** → **Pages** →
   - Source: **Deploy from a branch**
   - Branch: **main**, folder: **/ (root)** → **Save**.
4. Wait ~1 minute. Your app is live at:

   ```
   https://<your-username>.github.io/budget-buddy/
   ```

5. **On your phone**, open that link in the browser, then:
   - **iPhone (Safari):** Share → **Add to Home Screen**.
   - **Android (Chrome):** menu (⋮) → **Add to Home screen** / **Install app**.

It now opens like a normal app and works offline. Your data lives on the phone — use **Data → Export Excel** for backups.

---

## Privacy

Everything is stored locally in your browser (`localStorage`). Nothing is uploaded. Clearing your browser data or using "Delete all data" removes it, so export a backup first.
