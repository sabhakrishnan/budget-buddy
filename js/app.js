/* Budget Buddy — a simple, offline, phone-friendly budget tracker.
   All data is stored on your device (localStorage). Nothing is uploaded anywhere. */

(() => {
  'use strict';

  // ---------- Storage ----------
  const STORE_KEY = 'budget-buddy-v1';

  const defaultState = () => ({
    salary: 0,
    currency: '₹',
    banks: [],
    // Fixed/recurring items mirror the Excel columns:
    // Detail, Amount, Cr/Db, Auto-Debit, Fixed/OM, From Bank, Budget
    fixedItems: [],
    // Per-month data: { 'YYYY-MM': { fixedStatus: {id:{status,amount}}, expenses: [] } }
    months: {},
    // Future plans / savings goals
    goals: [],
    // Email sync (Google Apps Script published CSV): { url, lastAt }
    sync: { url: '', lastAt: 0 },
    // Gmail message ids already imported, to avoid duplicates
    syncedIds: {}
  });

  // Starter data imported from the "Dec 25" tab of the Aerocity sheet.
  // Budget defaults to each item's amount; adjust any time in Setup.
  function seedDecember() {
    const items = [
      ['Rent', 18000, 'Fixed', 'Paid'],
      ['Home Loan', 16431, 'Fixed', 'Pending'],
      ['Seetu', 22500, 'Fixed', 'Paid'],
      ['PL', 11500, 'Fixed', 'Pending'],
      ['Mortage Loan', 11000, 'Fixed', 'Paid'],
      ['Naina', 20000, 'OM', 'Pending'],
      ['Other exp', 10000, 'Fixed', 'Pending'],
      ['Personal exp', 9300, 'Fixed', 'Pending'],
      ['CC', 130000, 'OM', 'Paid'],
      ['LIC', 7500, 'Fixed', 'Pending'],
      ['Maintainence', 3170, 'Fixed', 'Pending'],
      ['Amma Medicine', 2500, 'Fixed', 'Pending'],
      ['Internet Blr', 883, 'Fixed', 'Pending'],
      ['Internet pgr', 600, 'Fixed', 'Pending'],
      ['Home/Ins Loan', 537, 'OM', 'Pending']
    ];
    const s = defaultState();
    s.salary = 197677;
    s.banks = ['HDFC', 'SBI', 'IOB'];
    const fixedStatus = {};
    items.forEach(([detail, amount, fixedOM, status], i) => {
      const id = 'dec' + (i + 1);
      s.fixedItems.push({ id, detail, amount, crdb: 'Db', fixedOM, fromBank: '', budget: amount, autoDebit: false });
      fixedStatus[id] = { status, amount };
    });
    s.months['2025-12'] = { fixedStatus, expenses: [] };
    return s;
  }

  function loadStarter() {
    const hasData = state.salary || state.fixedItems.length || Object.keys(state.months).length;
    if (hasData && !confirm('This replaces your current data with the December starter set. Continue?')) return;
    state = seedDecember();
    save();
    activeMonth = '2025-12';
    activeTab = 'dashboard';
    render();
    toast('December data loaded');
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultState();
      return Object.assign(defaultState(), JSON.parse(raw));
    } catch {
      return defaultState();
    }
  }

  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  let state = load();

  // Currently viewed month key, e.g. "2026-10"
  let activeMonth = monthKey(new Date());
  let activeTab = 'dashboard';
  // Expense values pre-filled from a shared/pasted bank SMS, awaiting user confirmation.
  let pendingShare = null;

  // ---------- Helpers ----------
  function monthKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  // How many days remain to spend across in the viewed month.
  // Current month -> days from today to month end; future month -> all its days; past month -> 0.
  function daysLeftInMonth(key) {
    const [y, m] = key.split('-').map(Number);
    const now = new Date();
    const nowKey = monthKey(now);
    const lastDay = new Date(y, m, 0).getDate();
    if (key > nowKey) return lastDay;
    if (key < nowKey) return 0;
    return Math.max(1, lastDay - now.getDate() + 1);
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function fmt(n) {
    const v = Number(n || 0);
    return state.currency + v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  function pctOfSalary(amount) {
    if (!state.salary) return null;
    return (Number(amount || 0) / state.salary) * 100;
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function getMonth(key) {
    if (!state.months[key]) state.months[key] = { fixedStatus: {}, expenses: [] };
    return state.months[key];
  }

  // ---------- Capture: auto-category + SMS parsing ----------
  // Keyword -> category, matched against a merchant/description string (local, private).
  const CATEGORY_RULES = [
    ['Food', ['swiggy', 'zomato', 'restaurant', 'hotel', 'cafe', 'dominos', 'domino', 'mcdonald', 'kfc', 'biryani', 'pizza', 'eatfit', 'eat ', 'bakery', 'barbeque', 'tea ', 'coffee']],
    ['Groceries', ['bigbasket', 'dmart', 'd-mart', 'grofers', 'blinkit', 'zepto', 'grocery', 'supermarket', 'reliance fresh', 'jiomart', 'kirana', 'provision']],
    ['Fuel', ['iocl', 'indian oil', 'hpcl', 'hp petrol', 'bpcl', 'bharat petroleum', 'shell', 'nayara', 'petrol', 'diesel', 'fuel', 'fastag']],
    ['Shopping', ['amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'nykaa', 'tatacliq', 'mall', 'lifestyle', 'store', 'decathlon', 'ikea']],
    ['Transport', ['uber', 'ola', 'rapido', 'irctc', 'metro', 'redbus', 'cab', 'auto ', 'namma yatri', 'railway', 'indigo', 'spicejet', 'flight', 'toll']],
    ['Bills', ['electricity', 'water bill', 'gas ', 'broadband', 'airtel', 'jio', ' vi ', 'vodafone', 'bescom', 'tneb', 'recharge', 'dth', 'wifi', 'postpaid', 'bill']],
    ['Health', ['pharmacy', 'apollo', 'medplus', 'hospital', 'clinic', 'medicine', 'diagnostic', 'lab ', 'netmeds', 'pharmeasy', 'practo']],
    ['Fun', ['netflix', 'spotify', 'hotstar', 'prime video', 'bookmyshow', 'pvr', 'inox', 'cinema', 'youtube', 'game', 'disney']],
    ['Bills', ['emi', 'loan', 'nach', ' ach ', 'insurance', 'premium', 'sip', 'mutual fund']],
    ['Rent', ['rent']]
  ];

  function autoCategory(text) {
    const s = ' ' + String(text || '').toLowerCase() + ' ';
    for (const [cat, keys] of CATEGORY_RULES) {
      if (keys.some((k) => s.includes(k))) return cat;
    }
    return '';
  }

  // Extract { amount, name, category } from a bank/UPI SMS or alert text.
  function parseSpendText(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    let amount = 0;
    const amt = t.match(/(?:rs|inr|₹)\.?\s*([\d,]+(?:\.\d{1,2})?)/i) ||
      t.match(/\bdebited(?:\s+by)?\s*(?:rs|inr|₹)?\.?\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (amt) amount = Number(amt[1].replace(/,/g, ''));
    let name = '';
    const m =
      t.match(/\b(?:to VPA|VPA)\s+([a-z0-9._-]+)@/i) ||
      t.match(/\b(?:at|to|towards|for)\s+([A-Za-z0-9&.\- ]{2,40}?)\s+(?:on|dated|ref|via|for|a\/c|txn|upi|info|nach)/i) ||
      t.match(/\bInfo[:\- ]+(?:UPI[\/-])?([A-Za-z0-9&.\- ]{2,40})/i) ||
      t.match(/\b(?:at|to|for)\s+([A-Za-z0-9&.\- ]{2,40})/i);
    if (m) name = m[1].trim().replace(/[.\-]+$/, '');
    return { amount, name, category: autoCategory(t) };
  }

  // Read Web Share Target (?title=&text=) or shortcut (?action=add) launch params.
  function handleLaunchParams() {
    const q = new URLSearchParams(location.search);
    const shared = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join(' ');
    if (shared) pendingShare = parseSpendText(shared) || { amount: 0, name: '', category: '' };
    if (shared || q.get('action') === 'add') activeTab = 'month';
    if (location.search) history.replaceState(null, '', location.pathname);
  }

  // ---------- Email sync (reads the Apps Script published CSV) ----------
  // Minimal CSV parser that handles quoted fields and commas inside quotes.
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.length && r.some((x) => x !== ''));
  }

  function sameMerchant(a, b) {
    const n = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const x = n(a), y = n(b);
    return !!x && !!y && (x.includes(y) || y.includes(x));
  }

  async function syncEmails(manual) {
    const url = state.sync && state.sync.url;
    if (!url) { if (manual) toast('Add your sync link first'); return; }
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const rows = parseCSV(await res.text());
      if (rows.length < 2) { if (manual) toast('Nothing to sync yet'); return; }
      const head = rows[0].map((h) => h.trim().toLowerCase());
      const col = (name) => head.indexOf(name);
      const di = col('date'), ai = col('amount'), mi = col('merchant'), ci = col('category'), ii = col('msgid');
      if (ai < 0 || ii < 0) { if (manual) toast('Unexpected sync format'); return; }
      let added = 0;
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const msgId = (row[ii] || '').trim();
        if (!msgId || state.syncedIds[msgId]) continue;
        const amount = Number(String(row[ai] || '').replace(/[^\d.]/g, ''));
        state.syncedIds[msgId] = 1;
        if (!amount) continue;
        const dateStr = (row[di] || '').trim();
        const merchant = (row[mi] || '').trim();
        const category = (row[ci] || '').trim() || autoCategory(merchant) || 'Other';
        const mKey = /^\d{4}-\d{2}/.test(dateStr) ? dateStr.slice(0, 7) : activeMonth;
        const month = getMonth(mKey);
        const dup = month.expenses.some((e) =>
          Number(e.amount) === amount && sameMerchant(e.name, merchant) &&
          (!e.date || !dateStr || e.date === dateStr));
        if (!dup) {
          month.expenses.push({
            id: uid(), name: merchant || 'Email spend', amount, category,
            details: 'Auto-synced from email', date: dateStr, source: 'email'
          });
          added++;
        }
      }
      state.sync.lastAt = Date.now();
      save();
      if (added || manual) { render(); toast(added ? `Synced ${added} new spend${added > 1 ? 's' : ''}` : 'Up to date'); }
    } catch (e) {
      if (manual) toast('Sync failed — check the link');
    }
  }

  // Download a daily recurring calendar reminder (.ics) at the chosen HH:MM.
  function downloadReminder(time) {
    const [h, m] = time.split(':').map(Number);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h || 21, m || 0, 0);
    const z = (n) => String(n).padStart(2, '0');
    const dt = (d) => `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}T${z(d.getHours())}${z(d.getMinutes())}00`;
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Budget Buddy//EN',
      'BEGIN:VEVENT',
      `UID:budget-buddy-reminder-${Date.now()}@local`,
      `DTSTART:${dt(start)}`,
      `DTEND:${dt(new Date(start.getTime() + 10 * 60000))}`,
      'RRULE:FREQ=DAILY',
      'SUMMARY:Budget Buddy — log today\'s spends',
      'DESCRIPTION:Open Budget Buddy, add any spends and check your daily limit.',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Budget Buddy', 'TRIGGER:PT0M', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    a.download = 'budget-buddy-daily-reminder.ics';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Open the file to add the daily reminder');
  }

  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ---------- Month math ----------
  function computeTotals(key) {
    const month = getMonth(key);
    let income = 0, fixedSpend = 0, budgetTotal = 0, varSpend = 0;

    for (const item of state.fixedItems) {
      const st = month.fixedStatus[item.id] || {};
      const amount = st.amount != null ? Number(st.amount) : Number(item.amount || 0);
      if (item.crdb === 'Cr') {
        income += amount;
      } else {
        // Only count toward spend if paid, else still show as planned
        fixedSpend += amount;
      }
      if (item.crdb !== 'Cr') budgetTotal += Number(item.budget || 0);
    }

    for (const e of month.expenses) varSpend += Number(e.amount || 0);

    const salaryIncome = Number(state.salary || 0);
    const totalIncome = salaryIncome + income;
    const totalSpend = fixedSpend + varSpend;
    const remaining = totalIncome - totalSpend;
    const goalContrib = state.goals.reduce((s, g) => s + Number(g.monthly || 0), 0);

    return {
      salaryIncome, otherIncome: income, totalIncome,
      fixedSpend, varSpend, totalSpend,
      budgetTotal, remaining, goalContrib,
      afterGoals: remaining - goalContrib
    };
  }

  // ---------- Rendering ----------
  const viewEl = document.getElementById('view');

  function render() {
    document.getElementById('monthTitle').textContent = monthLabel(activeMonth);
    const t = computeTotals(activeMonth);
    document.getElementById('monthSub').textContent =
      `${fmt(t.totalSpend)} spent · ${fmt(t.remaining)} left`;

    document.querySelectorAll('.tab').forEach((b) =>
      b.classList.toggle('active', b.dataset.tab === activeTab));

    if (activeTab === 'dashboard') viewEl.innerHTML = renderDashboard();
    else if (activeTab === 'month') viewEl.innerHTML = renderMonth();
    else if (activeTab === 'setup') viewEl.innerHTML = renderSetup();
    else if (activeTab === 'data') viewEl.innerHTML = renderData();

    viewEl.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function renderDashboard() {
    const t = computeTotals(activeMonth);
    const needsSetup = !state.salary && state.fixedItems.length === 0;

    if (needsSetup) {
      return `
        <div class="card empty">
          <div class="big">👋</div>
          <h2>Welcome to Budget Buddy</h2>
          <p class="muted">Let's set up once, then it only takes a minute each month.</p>
          <button class="btn" data-go="setup">Start setup</button>
          <button class="btn secondary" data-load-dec="1">Load my December data</button>
        </div>
        <div class="card">
          <h3>How it works</h3>
          <ul class="hint" style="padding-left:18px;">
            <li><b>Setup</b> — add your salary, banks, and fixed expenses (rent, EMIs, subscriptions).</li>
            <li><b>Month</b> — each month, confirm fixed expenses and add new ones.</li>
            <li><b>Home</b> — see what's left and track your savings goals.</li>
          </ul>
        </div>`;
    }

    const budgetUsedPct = t.budgetTotal ? Math.min(100, (t.totalSpend / t.budgetTotal) * 100) : 0;
    const overBudget = t.budgetTotal && t.totalSpend > t.budgetTotal;
    const spendPct = state.salary ? (t.totalSpend / state.salary) * 100 : null;

    return `
      <div class="card">
        <h2>${monthLabel(activeMonth)}</h2>
        <div class="stats">
          <div class="stat"><div class="label">Income</div><div class="value">${fmt(t.totalIncome)}</div></div>
          <div class="stat ${overBudget ? 'bad' : ''}"><div class="label">Total spend</div><div class="value">${fmt(t.totalSpend)}</div></div>
          <div class="stat ${t.remaining < 0 ? 'bad' : 'good'}"><div class="label">Left to spend</div><div class="value">${fmt(t.remaining)}</div></div>
          <div class="stat ${t.afterGoals < 0 ? 'warn' : 'good'}"><div class="label">After goals</div><div class="value">${fmt(t.afterGoals)}</div></div>
        </div>
        ${t.budgetTotal ? `
          <h3>Budget used ${overBudget ? `<span class="badge-over">over by ${fmt(t.totalSpend - t.budgetTotal)}</span>` : ''}</h3>
          <div class="progress ${overBudget ? 'over' : 'good'}"><span style="width:${budgetUsedPct}%"></span></div>
          <div class="hint">${fmt(t.totalSpend)} of ${fmt(t.budgetTotal)} budget${spendPct != null ? ` · ${spendPct.toFixed(0)}% of salary` : ''}</div>
        ` : ''}
      </div>

      ${renderDailyLimit(t)}

      ${renderReview()}

      <div class="card">
        <div class="section-title"><h2>Future plans</h2><button class="btn secondary btn-sm" data-go="setup">Edit goals</button></div>
        ${state.goals.length ? state.goals.map(renderGoalProgress).join('') :
          `<p class="empty">No goals yet. Add savings goals in Setup to plan ahead.</p>`}
      </div>

      <div class="card">
        <h2>Spending trend</h2>
        ${renderTrend()}
      </div>`;
  }

  // Weekly-review style card: where this month's variable spending is going.
  function renderReview() {
    const exp = getMonth(activeMonth).expenses;
    if (!exp.length) return '';
    const byCat = {};
    let total = 0;
    for (const e of exp) {
      const c = e.category || 'Other';
      byCat[c] = (byCat[c] || 0) + Number(e.amount || 0);
      total += Number(e.amount || 0);
    }
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const max = top[0][1] || 1;
    return `
      <div class="card">
        <div class="section-title"><h2>Where it's going</h2><span class="amount">${fmt(total)}</span></div>
        ${top.map(([cat, amt]) => `
          <div style="margin-bottom:10px;">
            <div class="flex-between"><span class="title">${esc(cat)}</span><span class="sub">${fmt(amt)} · ${Math.round(amt / total * 100)}%</span></div>
            <div class="progress"><span style="width:${Math.max(4, amt / max * 100)}%"></span></div>
          </div>`).join('')}
        <div class="hint">${exp.length} spend${exp.length > 1 ? 's' : ''} logged this month.</div>
      </div>`;
  }

  // Available balance + suggested daily spend limit (from the user's Plans sheet).
  function renderDailyLimit(t) {
    const days = daysLeftInMonth(activeMonth);
    const balance = t.remaining;
    if (balance < 0) {
      return `
        <div class="card">
          <h2>Daily limit</h2>
          <div class="stat bad"><div class="label">Available balance</div><div class="value">${fmt(balance)}</div></div>
          <div class="hint" style="margin-top:10px;">⚠️ You're over your available balance this month. Pause non-essential spends until next income.</div>
        </div>`;
    }
    const perDay = days > 0 ? balance / days : balance;
    return `
      <div class="card">
        <h2>Daily limit</h2>
        <div class="stats">
          <div class="stat good"><div class="label">Available balance</div><div class="value">${fmt(balance)}</div></div>
          <div class="stat"><div class="label">Spend / day${days ? ` (${days}d left)` : ''}</div><div class="value">${fmt(perDay)}</div></div>
        </div>
        <div class="hint" style="margin-top:10px;">Keep daily spends under ${fmt(perDay)} to stay on track for the rest of ${monthLabel(activeMonth)}.</div>
      </div>`;
  }

  function renderGoalProgress(g) {
    const target = Number(g.target || 0);
    const saved = Number(g.saved || 0);
    const pct = target ? Math.min(100, (saved / target) * 100) : 0;
    const done = target && saved >= target;
    return `
      <div style="margin-bottom:14px;">
        <div class="flex-between">
          <div class="title">${esc(g.name)} ${done ? '✅' : ''}</div>
          <div class="sub">${fmt(saved)} / ${fmt(target)}</div>
        </div>
        <div class="progress ${done ? 'good' : ''}"><span style="width:${pct}%"></span></div>
        <div class="hint">Setting aside ${fmt(g.monthly)} / month${g.due ? ` · target ${esc(g.due)}` : ''}</div>
      </div>`;
  }

  function renderTrend() {
    const keys = Object.keys(state.months).sort().slice(-6);
    if (!keys.length) return `<p class="empty">Track a few months to see your trend.</p>`;
    const data = keys.map((k) => ({ k, total: computeTotals(k).totalSpend }));
    const max = Math.max(...data.map((d) => d.total), 1);
    return `<div style="display:flex;align-items:flex-end;gap:8px;height:120px;">
      ${data.map((d) => {
        const h = Math.max(4, (d.total / max) * 100);
        const isActive = d.k === activeMonth;
        return `<div style="flex:1;text-align:center;">
          <div style="height:100px;display:flex;align-items:flex-end;">
            <div title="${fmt(d.total)}" style="width:100%;height:${h}%;background:${isActive ? 'var(--primary)' : 'var(--primary-soft)'};border-radius:8px 8px 0 0;"></div>
          </div>
          <small class="muted">${d.k.split('-')[1]}</small>
        </div>`;
      }).join('')}
    </div>`;
  }

  function renderMonth() {
    const month = getMonth(activeMonth);
    const t = computeTotals(activeMonth);
    const debits = state.fixedItems.filter((i) => i.crdb !== 'Cr');
    const credits = state.fixedItems.filter((i) => i.crdb === 'Cr');

    return `
      <div class="card">
        <h2>Step 1 · Confirm fixed items</h2>
        ${state.fixedItems.length === 0
          ? `<p class="empty">No fixed items yet. Add them in <a href="#" data-go="setup">Setup</a>.</p>`
          : ''}
        ${credits.length ? `<h3>Income</h3><ul class="list">${credits.map((i) => fixedRow(i, month)).join('')}</ul>` : ''}
        ${debits.length ? `<h3>Fixed expenses</h3><ul class="list">${debits.map((i) => fixedRow(i, month)).join('')}</ul>` : ''}
      </div>

      <div class="card">
        <h2>Step 2 · Add new expense</h2>
        <form id="expenseForm">
          <label>Paste a bank SMS / UPI alert (optional)</label>
          <textarea id="smsBox" rows="2" placeholder="Paste the message — amount, merchant & category fill in automatically"></textarea>
          <label>What did you spend on?</label>
          <input name="name" value="${esc(pendingShare?.name || '')}" placeholder="e.g. Groceries" required />
          <div class="form-grid">
            <div>
              <label>Amount</label>
              <input name="amount" type="number" inputmode="decimal" step="0.01" min="0" value="${pendingShare?.amount || ''}" placeholder="0" required />
            </div>
            <div>
              <label>Category</label>
              <input name="category" list="catList" value="${esc(pendingShare?.category || '')}" placeholder="e.g. Food" />
              <datalist id="catList">
                <option>Food</option><option>Groceries</option><option>Fuel</option><option>Transport</option><option>Shopping</option>
                <option>Bills</option><option>Health</option><option>Fun</option><option>Rent</option><option>Other</option>
              </datalist>
            </div>
          </div>
          <label>Details (optional)</label>
          <input name="details" placeholder="Any note" />
          <button class="btn" type="submit">+ Add expense</button>
        </form>
      </div>

      <div class="card">
        <div class="section-title"><h2>This month's expenses</h2><span class="amount">${fmt(t.varSpend)}</span></div>
        ${month.expenses.length === 0
          ? `<p class="empty">Nothing added yet.</p>`
          : `<ul class="list">${month.expenses.map(expenseRow).join('')}</ul>`}
      </div>

      <div class="card">
        <h2>Step 3 · Budget check</h2>
        ${renderBudgetCheck(t)}
      </div>`;
  }

  function fixedRow(item, month) {
    const st = month.fixedStatus[item.id] || {};
    const amount = st.amount != null ? st.amount : item.amount;
    const paid = st.status === 'Paid';
    const pct = pctOfSalary(amount);
    return `
      <li class="row" data-fixed="${item.id}">
        <div class="grow">
          <div class="title">${esc(item.detail)}</div>
          <div class="sub">
            ${esc(item.fromBank || 'Bank —')}
            ${item.autoDebit ? '<span class="pill auto">Auto</span>' : ''}
            ${item.fixedOM ? `<span class="pill">${esc(item.fixedOM)}</span>` : ''}
            ${pct != null ? ` · ${pct.toFixed(0)}% salary` : ''}
          </div>
        </div>
        <div style="text-align:right;">
          <div class="amount ${item.crdb === 'Cr' ? 'cr' : 'db'}">${item.crdb === 'Cr' ? '+' : ''}${fmt(amount)}</div>
          ${item.crdb === 'Cr' ? '' : `<button class="btn ${paid ? 'secondary' : 'ghost'} btn-sm" data-toggle-paid="${item.id}" style="margin-top:4px;">${paid ? '✓ Paid' : 'Mark paid'}</button>`}
        </div>
      </li>`;
  }

  function expenseRow(e) {
    return `
      <li class="row">
        <div class="grow">
          <div class="title">${esc(e.name)}</div>
          <div class="sub">${e.category ? `<span class="pill">${esc(e.category)}</span> ` : ''}${e.source === 'email' ? '<span class="pill auto">Auto</span> ' : ''}${esc(e.details || '')}</div>
        </div>
        <div class="amount db">${fmt(e.amount)}</div>
        <button class="icon-delete" data-del-expense="${e.id}" aria-label="Delete">🗑</button>
      </li>`;
  }

  function renderBudgetCheck(t) {
    if (!t.budgetTotal && !state.salary) {
      return `<p class="hint">Add a salary and budgets in Setup to see if you're on track.</p>`;
    }
    const overBudget = t.budgetTotal && t.totalSpend > t.budgetTotal;
    const rows = [];
    if (t.budgetTotal) {
      rows.push(`<div class="flex-between"><span>Budget</span><span class="amount">${fmt(t.budgetTotal)}</span></div>`);
    }
    rows.push(`<div class="flex-between"><span>Spent so far</span><span class="amount">${fmt(t.totalSpend)}</span></div>`);
    if (t.budgetTotal) {
      rows.push(`<div class="flex-between"><span>${overBudget ? 'Over budget' : 'Under budget'}</span><span class="${overBudget ? 'badge-over' : 'badge-under'}">${overBudget ? '-' : '+'}${fmt(Math.abs(t.budgetTotal - t.totalSpend))}</span></div>`);
    }
    rows.push(`<div class="flex-between"><span>Left from income</span><span class="${t.remaining < 0 ? 'badge-over' : 'badge-under'}">${fmt(t.remaining)}</span></div>`);
    const msg = overBudget
      ? `⚠️ You're over budget this month. Try to trim variable spending.`
      : t.remaining < 0
        ? `⚠️ You're spending more than your income this month.`
        : `✅ You're on track. Keep it up!`;
    return rows.join('<div class="spacer"></div>') +
      `<div class="hint" style="margin-top:12px;">${msg}</div>`;
  }

  function renderSetup() {
    return `
      <div class="card">
        <h2>Income & currency</h2>
        <div class="form-grid">
          <div>
            <label>Currency symbol</label>
            <input id="currencyInput" value="${esc(state.currency)}" maxlength="3" />
          </div>
          <div>
            <label>Monthly salary</label>
            <input id="salaryInput" type="number" inputmode="decimal" min="0" value="${state.salary || ''}" placeholder="0" />
          </div>
        </div>
        <button class="btn secondary" id="saveIncome">Save</button>
        <p class="hint">Stored only on this device. Used to show "% of salary" per expense.</p>
      </div>

      <div class="card">
        <div class="section-title"><h2>Banks</h2></div>
        <ul class="list">
          ${state.banks.length ? state.banks.map((b, i) =>
            `<li class="row"><div class="grow"><div class="title">${esc(b)}</div></div><button class="icon-delete" data-del-bank="${i}">🗑</button></li>`
          ).join('') : '<p class="empty">No banks yet.</p>'}
        </ul>
        <form id="bankForm" class="btn-row">
          <input name="bank" placeholder="e.g. HDFC" required />
          <button class="btn btn-sm" type="submit" style="width:auto;white-space:nowrap;">Add</button>
        </form>
      </div>

      <div class="card">
        <div class="section-title"><h2>Fixed items</h2></div>
        <p class="hint">Recurring income & expenses: salary credit, rent, EMIs, subscriptions. Mirrors your Excel columns.</p>
        <ul class="list">
          ${state.fixedItems.length ? state.fixedItems.map((i) => `
            <li class="row">
              <div class="grow">
                <div class="title">${esc(i.detail)}</div>
                <div class="sub">${esc(i.crdb)} · ${esc(i.fromBank || '—')} ${i.autoDebit ? '· Auto' : ''} ${i.fixedOM ? '· ' + esc(i.fixedOM) : ''}${i.budget ? ' · budget ' + fmt(i.budget) : ''}</div>
              </div>
              <div class="amount ${i.crdb === 'Cr' ? 'cr' : 'db'}">${fmt(i.amount)}</div>
              <button class="icon-delete" data-del-fixed="${i.id}">🗑</button>
            </li>`).join('') : '<p class="empty">No fixed items yet.</p>'}
        </ul>

        <form id="fixedForm">
          <label>Detail</label>
          <input name="detail" placeholder="e.g. Rent" required />
          <div class="form-grid">
            <div>
              <label>Amount</label>
              <input name="amount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0" required />
            </div>
            <div>
              <label>Type</label>
              <select name="crdb"><option value="Db">Debit (expense)</option><option value="Cr">Credit (income)</option></select>
            </div>
            <div>
              <label>Fixed / OM</label>
              <select name="fixedOM"><option value="Fixed">Fixed</option><option value="OM">OM</option></select>
            </div>
            <div>
              <label>From bank</label>
              <select name="fromBank">
                <option value="">—</option>
                ${state.banks.map((b) => `<option>${esc(b)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label>Budget</label>
              <input name="budget" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0" />
            </div>
            <div>
              <label>Auto-debit?</label>
              <select name="autoDebit"><option value="">No</option><option value="1">Yes</option></select>
            </div>
          </div>
          <button class="btn" type="submit">+ Add fixed item</button>
        </form>
      </div>

      <div class="card">
        <div class="section-title"><h2>Future plans / goals</h2></div>
        <ul class="list">
          ${state.goals.length ? state.goals.map((g) => `
            <li class="row">
              <div class="grow">
                <div class="title">${esc(g.name)}</div>
                <div class="sub">${fmt(g.saved)} / ${fmt(g.target)} · ${fmt(g.monthly)}/mo${g.due ? ' · ' + esc(g.due) : ''}</div>
              </div>
              <button class="btn secondary btn-sm" data-add-saved="${g.id}">+ Save</button>
              <button class="icon-delete" data-del-goal="${g.id}">🗑</button>
            </li>`).join('') : '<p class="empty">No goals yet.</p>'}
        </ul>
        <form id="goalForm">
          <label>Goal name</label>
          <input name="name" placeholder="e.g. Emergency fund" required />
          <div class="form-grid">
            <div><label>Target amount</label><input name="target" type="number" inputmode="decimal" min="0" placeholder="0" required /></div>
            <div><label>Save per month</label><input name="monthly" type="number" inputmode="decimal" min="0" placeholder="0" /></div>
            <div><label>Already saved</label><input name="saved" type="number" inputmode="decimal" min="0" placeholder="0" /></div>
            <div><label>Target date (optional)</label><input name="due" placeholder="e.g. Dec 2026" /></div>
          </div>
          <button class="btn" type="submit">+ Add goal</button>
        </form>
      </div>`;
  }

  function renderData() {
    const last = state.sync && state.sync.lastAt;
    return `
      <div class="card">
        <h2>Email sync (auto-capture)</h2>
        <p class="hint">Spends from your bank / UPI emails appear automatically. Set up the free Google Apps Script (see <b>apps-script/Code.gs</b>), publish its sheet as CSV, and paste that link here.</p>
        <label>Sync link (published CSV URL)</label>
        <input id="syncUrl" value="${esc(state.sync && state.sync.url || '')}" placeholder="https://docs.google.com/…/pub?output=csv" />
        <div class="btn-row">
          <button class="btn secondary" id="saveSync">Save link</button>
          <button class="btn" id="syncNow">Sync now</button>
        </div>
        <p class="hint">${last ? 'Last synced ' + new Date(last).toLocaleString() : 'Not synced yet'}</p>
      </div>
      <div class="card">
        <h2>Daily reminder</h2>
        <p class="hint">Add a recurring phone reminder to log / review. Works on any phone — it adds a daily event to your calendar.</p>
        <label>Remind me at</label>
        <input id="remindTime" type="time" value="21:00" />
        <button class="btn secondary" id="addReminder">Add daily reminder</button>
      </div>
      <div class="card">
        <h2>Export to Excel</h2>
        <p class="hint">Download a backup you can open in Excel. Keep it safe or import it on another phone.</p>
        <button class="btn" id="exportXlsx">⬇ Export Excel (.xlsx)</button>
        <button class="btn secondary" id="exportCsv">⬇ Export CSV</button>
      </div>
      <div class="card">
        <h2>Import from Excel</h2>
        <p class="hint">Import a file previously exported from this app, or your own sheet with matching column names (Detail, Amount, Cr/Db, Auto-Debit, Fixed/OM, From Bank, Budget).</p>
        <label class="btn ghost" for="importFile" style="margin-top:12px;">📄 Choose file to import</label>
        <input id="importFile" type="file" accept=".xlsx,.xls,.xlsm,.csv" style="display:none;" />
      </div>
      <div class="card">
        <h2>Install on phone</h2>
        <p class="hint">In your phone browser, open the menu and tap <b>"Add to Home Screen"</b>. It will open like a normal app and work offline.</p>
      </div>
      <div class="card">
        <h2>Starter data</h2>
        <p class="hint">Load the fixed items from your December sheet (salary, rent, loans, EMIs) so you don't have to type them in. You can edit everything afterwards.</p>
        <button class="btn secondary" data-load-dec="1">Load December starter data</button>
      </div>
      <div class="card">
        <h2>Reset</h2>
        <p class="hint">Deletes everything stored on this device. Export first if you want a backup.</p>
        <button class="btn danger" id="resetAll">Delete all data</button>
      </div>`;
  }

  // ---------- Events ----------
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => { pendingShare = null; activeTab = btn.dataset.tab; render(); });
  });
  document.getElementById('prevMonth').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('nextMonth').addEventListener('click', () => shiftMonth(1));

  function shiftMonth(delta) {
    const [y, m] = activeMonth.split('-').map(Number);
    activeMonth = monthKey(new Date(y, m - 1 + delta, 1));
    render();
  }

  // Delegated click handling for dynamic content
  viewEl.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) { activeTab = go.dataset.go; render(); return; }

    const loadDec = e.target.closest('[data-load-dec]');
    if (loadDec) { loadStarter(); return; }

    const paid = e.target.closest('[data-toggle-paid]');
    if (paid) {
      const id = paid.dataset.togglePaid;
      const month = getMonth(activeMonth);
      const st = month.fixedStatus[id] || {};
      st.status = st.status === 'Paid' ? 'Pending' : 'Paid';
      month.fixedStatus[id] = st;
      save(); render(); return;
    }

    const delExp = e.target.closest('[data-del-expense]');
    if (delExp) {
      const month = getMonth(activeMonth);
      month.expenses = month.expenses.filter((x) => x.id !== delExp.dataset.delExpense);
      save(); render(); return;
    }

    const delBank = e.target.closest('[data-del-bank]');
    if (delBank) { state.banks.splice(Number(delBank.dataset.delBank), 1); save(); render(); return; }

    const delFixed = e.target.closest('[data-del-fixed]');
    if (delFixed) { state.fixedItems = state.fixedItems.filter((x) => x.id !== delFixed.dataset.delFixed); save(); render(); return; }

    const delGoal = e.target.closest('[data-del-goal]');
    if (delGoal) { state.goals = state.goals.filter((x) => x.id !== delGoal.dataset.delGoal); save(); render(); return; }

    const addSaved = e.target.closest('[data-add-saved]');
    if (addSaved) {
      const g = state.goals.find((x) => x.id === addSaved.dataset.addSaved);
      if (g) {
        const amt = prompt(`Add to "${g.name}" savings:`, g.monthly || '');
        if (amt != null && amt !== '') { g.saved = Number(g.saved || 0) + Number(amt); save(); render(); toast('Saved!'); }
      }
      return;
    }
  });

  // Delegated form submissions
  viewEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;

    if (form.id === 'expenseForm') {
      const f = new FormData(form);
      const name = (f.get('name') || '').trim();
      const month = getMonth(activeMonth);
      month.expenses.push({
        id: uid(),
        name,
        amount: Number(f.get('amount')),
        category: (f.get('category') || '').trim() || autoCategory(name) || 'Other',
        details: (f.get('details') || '').trim()
      });
      pendingShare = null;
      save(); render(); toast('Expense added'); return;
    }

    if (form.id === 'bankForm') {
      const name = new FormData(form).get('bank').trim();
      if (name) { state.banks.push(name); save(); render(); }
      return;
    }

    if (form.id === 'fixedForm') {
      const f = new FormData(form);
      state.fixedItems.push({
        id: uid(),
        detail: f.get('detail').trim(),
        amount: Number(f.get('amount')),
        crdb: f.get('crdb'),
        fixedOM: f.get('fixedOM'),
        fromBank: f.get('fromBank') || '',
        budget: Number(f.get('budget') || 0),
        autoDebit: !!f.get('autoDebit')
      });
      save(); render(); toast('Fixed item added'); return;
    }

    if (form.id === 'goalForm') {
      const f = new FormData(form);
      state.goals.push({
        id: uid(),
        name: f.get('name').trim(),
        target: Number(f.get('target')),
        monthly: Number(f.get('monthly') || 0),
        saved: Number(f.get('saved') || 0),
        due: (f.get('due') || '').trim()
      });
      save(); render(); toast('Goal added'); return;
    }
  });

  // Delegated change/click for Setup & Data controls
  viewEl.addEventListener('click', (e) => {
    if (e.target.id === 'saveIncome') {
      state.currency = (document.getElementById('currencyInput').value || '₹').trim();
      state.salary = Number(document.getElementById('salaryInput').value || 0);
      save(); render(); toast('Saved');
    }
    if (e.target.id === 'exportXlsx') exportExcel();
    if (e.target.id === 'exportCsv') exportCsv();
    if (e.target.id === 'saveSync') {
      state.sync.url = document.getElementById('syncUrl').value.trim();
      save(); render(); toast('Sync link saved');
    }
    if (e.target.id === 'syncNow') syncEmails(true);
    if (e.target.id === 'addReminder') {
      const time = document.getElementById('remindTime').value || '21:00';
      downloadReminder(time);
    }
    if (e.target.id === 'resetAll') {
      if (confirm('Delete ALL data on this device? This cannot be undone.')) {
        localStorage.removeItem(STORE_KEY);
        state = defaultState();
        save(); render(); toast('All data cleared');
      }
    }
  });

  viewEl.addEventListener('change', (e) => {
    if (e.target.id === 'importFile' && e.target.files[0]) importFile(e.target.files[0]);
  });

  // Live-parse a pasted bank SMS into the add-expense fields.
  viewEl.addEventListener('input', (e) => {
    if (e.target.id !== 'smsBox') return;
    const parsed = parseSpendText(e.target.value);
    if (!parsed) return;
    const form = e.target.closest('form');
    if (!form) return;
    if (parsed.amount) form.querySelector('[name="amount"]').value = parsed.amount;
    if (parsed.name) form.querySelector('[name="name"]').value = parsed.name;
    if (parsed.category) form.querySelector('[name="category"]').value = parsed.category;
  });

  // ---------- Excel / CSV ----------
  function buildFixedRows() {
    return state.fixedItems.map((i) => ({
      Detail: i.detail,
      Amount: i.amount,
      'Cr/Db': i.crdb,
      'Auto-Debit': i.autoDebit ? 'Yes' : 'No',
      'Fixed/OM': i.fixedOM,
      'Percentage of my Salary': pctOfSalary(i.amount) != null ? Number(pctOfSalary(i.amount).toFixed(1)) : '',
      'From Bank': i.fromBank,
      Budget: i.budget
    }));
  }

  function buildExpenseRows() {
    const rows = [];
    for (const key of Object.keys(state.months).sort()) {
      for (const e of state.months[key].expenses) {
        rows.push({ Month: key, Expenses: e.name, Amount: e.amount, Category: e.category, Details: e.details });
      }
    }
    return rows;
  }

  function exportExcel() {
    if (typeof XLSX === 'undefined') { toast('Excel engine still loading — try again'); return; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildFixedRows()), 'Fixed');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildExpenseRows()), 'Expenses');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      state.goals.map((g) => ({ Goal: g.name, Target: g.target, Saved: g.saved, 'Per month': g.monthly, 'Target date': g.due }))
    ), 'Goals');
    // Full backup as JSON inside a sheet, so import can fully restore
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['__backup__'], [JSON.stringify(state)]]), '_backup');
    XLSX.writeFile(wb, `budget-${activeMonth}.xlsx`);
    toast('Excel exported');
  }

  function exportCsv() {
    const rows = buildFixedRows();
    const headers = Object.keys(rows[0] || { Detail: '', Amount: '' });
    const csv = [headers.join(',')]
      .concat(rows.map((r) => headers.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `budget-fixed-${activeMonth}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('CSV exported');
  }

  function importFile(file) {
    if (typeof XLSX === 'undefined') { toast('Excel engine still loading — try again'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array' });
        // Prefer a full backup if present
        if (wb.SheetNames.includes('_backup')) {
          const aoa = XLSX.utils.sheet_to_json(wb.Sheets['_backup'], { header: 1 });
          const json = aoa?.[1]?.[0];
          if (json) {
            state = Object.assign(defaultState(), JSON.parse(json));
            save(); render(); toast('Backup restored'); return;
          }
        }
        // Otherwise map known columns from the first sheet (or a "Fixed" sheet)
        const sheetName = wb.SheetNames.includes('Fixed') ? 'Fixed' : wb.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
        let added = 0;
        for (const r of rows) {
          const detail = r['Detail'] ?? r['detail'];
          if (!detail) continue;
          state.fixedItems.push({
            id: uid(),
            detail: String(detail).trim(),
            amount: Number(r['Amount'] ?? r['amount'] ?? 0),
            crdb: /cr/i.test(String(r['Cr/Db'] ?? r['CrDb'] ?? 'Db')) ? 'Cr' : 'Db',
            fixedOM: String(r['Fixed/OM'] ?? r['FixedOM'] ?? 'Fixed') || 'Fixed',
            fromBank: String(r['From Bank'] ?? r['FromBank'] ?? '').trim(),
            budget: Number(r['Budget'] ?? r['budget'] ?? 0),
            autoDebit: /yes|1|true/i.test(String(r['Auto-Debit'] ?? r['AutoDebit'] ?? ''))
          });
          added++;
        }
        save(); render();
        toast(added ? `Imported ${added} fixed items` : 'No matching rows found');
      } catch (err) {
        console.error(err);
        toast('Could not read that file');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ---------- Service worker (offline) ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }

  // ---------- Go ----------
  handleLaunchParams();
  render();
  if (pendingShare) toast('Review the expense, then tap Add');
  // Pull any new email-synced spends in the background on launch.
  if (state.sync && state.sync.url) syncEmails(false);
})();
