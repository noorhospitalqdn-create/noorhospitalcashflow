/* ═════════════════════════════════════════════════════════════════════════════
   Hospital ⇄ Muhasib Cash Borrowing & Liability Register (assets/cash-borrow.js)
   Offline-first • Supabase synced • Net liability calculation & settlements
   ═════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var LS_KEY = 'noor_cash_borrow_v1';
  var LS_DIRTY = 'noor_cash_borrow_dirty';
  var LS_DELETED = 'noor_cash_borrow_deleted';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function nowTime() {
    var d = new Date();
    var h = String(d.getHours()).padStart(2, '0');
    var m = String(d.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var p = String(iso).slice(0, 10).split('-');
    if (p.length === 3) return p[2] + '-' + p[1] + '-' + p[0];
    return String(iso);
  }

  function fmtINR(n) {
    n = Number(n) || 0;
    try { return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    catch (e) { return '₹' + n.toFixed(2); }
  }

  function fmtINR0(n) {
    n = Number(n) || 0;
    try { return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
    catch (e) { return '₹' + Math.round(n); }
  }

  /* ---- Number to words (Indian system) ---- */
  var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function twoDigits(n) {
    if (n < 20) return ONES[n];
    return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  }
  function threeDigits(n) {
    var h = Math.floor(n / 100), r = n % 100;
    return (h ? ONES[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? twoDigits(r) : '');
  }
  function amountInWords(num) {
    num = Math.round(Number(num) || 0);
    if (!num) return 'Zero Rupees Only';
    if (num < 0) return 'Minus ' + amountInWords(-num);
    var out = [];
    var cr = Math.floor(num / 10000000); num %= 10000000;
    var lk = Math.floor(num / 100000); num %= 100000;
    var th = Math.floor(num / 1000); num %= 1000;
    if (cr) out.push(threeDigits(cr) + ' Crore');
    if (lk) out.push(twoDigits(lk) + ' Lakh');
    if (th) out.push(twoDigits(th) + ' Thousand');
    if (num) out.push(threeDigits(num));
    return out.join(' ') + ' Rupees Only';
  }

  /* ---- Local Storage Helpers ---- */
  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function save(arr) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch (e) {}
  }

  function uid() {
    return 'cb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function loadIds(k) {
    try { var a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function saveIds(k, a) {
    try { localStorage.setItem(k, JSON.stringify(a)); } catch (e) {}
  }
  function markDirty(id) {
    var d = loadIds(LS_DIRTY);
    if (d.indexOf(String(id)) === -1) { d.push(String(id)); saveIds(LS_DIRTY, d); }
  }
  function unmarkDirty(id) {
    saveIds(LS_DIRTY, loadIds(LS_DIRTY).filter(function (x) { return String(x) !== String(id); }));
  }

  function toast(msg, type) {
    if (window.app && app.ui && app.ui.showToast) {
      app.ui.showToast(msg, type || 'success');
    } else {
      console.log('[CashBorrow]', msg);
    }
  }

  /* ---- Calculations ---- */
  function getTotals() {
    var list = load();
    var h2mPending = 0; // Hospital given to Muhasib -> Muhasib owes Hospital
    var m2hPending = 0; // Muhasib given to Hospital -> Hospital owes Muhasib
    var h2mPendingCount = 0;
    var m2hPendingCount = 0;
    var totalSettled = 0;
    var settledCount = 0;

    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var amt = Number(item.amount) || 0;
      var settledAmt = Number(item.settledAmount) || 0;
      var remaining = Math.max(0, amt - settledAmt);

      if (item.status === 'pending') {
        if (item.direction === 'hospital_to_muhasib') {
          h2mPending += remaining;
          h2mPendingCount++;
        } else {
          m2hPending += remaining;
          m2hPendingCount++;
        }
      } else {
        totalSettled += (settledAmt || amt);
        settledCount++;
      }
    }

    var netAmount = 0;
    var netParty = 'balanced'; // 'muhasib_owes' | 'hospital_owes' | 'balanced'
    var netText = 'Both Cashes Balanced';
    var netSub = 'Both cashboxes are balanced. No pending borrowings.';

    if (h2mPending > m2hPending) {
      netAmount = h2mPending - m2hPending;
      netParty = 'muhasib_owes';
      netText = 'Muhasib owes Hospital: ' + fmtINR(netAmount);
      netSub = 'Payable by Muhasib to Hospital Cash: ' + fmtINR(netAmount) + ' to balance cashboxes.';
    } else if (m2hPending > h2mPending) {
      netAmount = m2hPending - h2mPending;
      netParty = 'hospital_owes';
      netText = 'Hospital owes Muhasib: ' + fmtINR(netAmount);
      netSub = 'Payable by Hospital to Muhasib Cash: ' + fmtINR(netAmount) + ' to balance cashboxes.';
    }

    return {
      totalRecords: list.length,
      h2mPending: h2mPending,
      h2mPendingCount: h2mPendingCount,
      m2hPending: m2hPending,
      m2hPendingCount: m2hPendingCount,
      totalPending: h2mPending + m2hPending,
      totalPendingCount: h2mPendingCount + m2hPendingCount,
      totalSettled: totalSettled,
      settledCount: settledCount,
      netAmount: netAmount,
      netParty: netParty,
      netText: netText,
      netSub: netSub
    };
  }

  /* ---- Modal helpers ---- */
  function openModal(id) {
    var m = $(id);
    if (!m) return;
    try {
      if (typeof m.showModal === 'function' && !m.open) m.showModal();
      m.classList.add('active');
    } catch (e) {
      m.classList.add('active');
    }
  }
  function closeModal(id) {
    var m = $(id);
    if (!m) return;
    try {
      if (typeof m.close === 'function' && m.open) m.close();
      m.classList.remove('active');
    } catch (e) {
      m.classList.remove('active');
    }
  }

  /* ---- Supabase Online Sync ---- */
  function onlineReady() {
    try {
      return navigator.onLine && window.app && app.supabase && app.supabase.isConfigured && app.supabase.isConfigured();
    } catch (e) { return false; }
  }

  async function ensureCreds() {
    try {
      if ((!app.supabase.url || !app.supabase.key) && app.supabase.init) await app.supabase.init();
    } catch (e) {}
    return !!(app.supabase.url && app.supabase.key);
  }

  function toRemote(r) {
    var now = new Date().toISOString();
    return {
      id: String(r.id),
      date: r.date || todayISO(),
      direction: r.direction || 'hospital_to_muhasib',
      amount: Number(r.amount) || 0,
      purpose: r.purpose || '',
      given_by: r.givenBy || '',
      status: r.status || 'pending',
      settled_amount: Number(r.settledAmount) || 0,
      settled_at: r.settledAt || null,
      settle_notes: r.settleNotes || '',
      created_at: r.createdAt || now,
      updated_at: r.updatedAt || now,
      device_id: (window.app && app.getDeviceId) ? app.getDeviceId() : null
    };
  }

  function fromRemote(rec) {
    return {
      id: String(rec.id),
      date: rec.date || '',
      time: rec.time || '',
      direction: rec.direction || 'hospital_to_muhasib',
      amount: Number(rec.amount) || 0,
      purpose: rec.purpose || '',
      givenBy: rec.given_by || rec.givenBy || '',
      status: rec.status || 'pending',
      settledAmount: Number(rec.settled_amount || rec.settledAmount) || 0,
      settledAt: rec.settled_at || rec.settledAt || null,
      settleNotes: rec.settle_notes || rec.settleNotes || '',
      createdAt: rec.created_at || rec.createdAt || '',
      updatedAt: rec.updated_at || rec.updatedAt || ''
    };
  }

  async function syncOnline(silent) {
    if (!onlineReady()) {
      if (!silent) toast('Offline mode — saved locally in browser.', 'info');
      return;
    }
    try {
      var ok = await ensureCreds();
      if (!ok) return;

      // 1. Process deletes
      var deleted = loadIds(LS_DELETED);
      if (deleted.length && app.supabase && app.supabase.delete) {
        for (var i = 0; i < deleted.length; i++) {
          try {
            await app.supabase.delete('cash_borrowings', deleted[i]);
          } catch (delErr) {}
        }
        // NEVER reset LS_DELETED! Keep tombstones to protect against resurrection
      }

      // 2. Push dirty
      var dirty = loadIds(LS_DIRTY);
      var all = load();
      if (dirty.length && app.supabase && app.supabase.upsert) {
        var toPush = all.filter(function (x) { return dirty.indexOf(String(x.id)) > -1; });
        for (var p = 0; p < toPush.length; p++) {
          try {
            await app.supabase.upsert('cash_borrowings', toRemote(toPush[p]));
            unmarkDirty(toPush[p].id);
          } catch (upErr) {}
        }
      }

      // 3. Pull latest (strictly honor tombstones)
      if (app.supabase && app.supabase.request) {
        var remote = await app.supabase.request('cash_borrowings', 'GET', null, { order: 'created_at.desc', limit: '500' });
        if (Array.isArray(remote)) {
          var local = load();
          var map = {};
          local.forEach(function (x) { map[String(x.id)] = x; });

          var delMap = {};
          loadIds(LS_DELETED).forEach(function (d) { delMap[String(d)] = true; });

          remote.forEach(function (rm) {
            if (delMap[String(rm.id)]) {
              // Deleted locally! Ensure it is also purged from remote
              if (app.supabase && app.supabase.delete) {
                try { app.supabase.delete('cash_borrowings', rm.id); } catch (e) {}
              }
              return;
            }
            var rObj = fromRemote(rm);
            var loc = map[String(rm.id)];
            if (!loc) {
              map[String(rm.id)] = rObj;
            } else {
              var locUp = new Date(loc.updatedAt || loc.createdAt || 0).getTime();
              var remUp = new Date(rm.updated_at || rm.created_at || 0).getTime();
              if (remUp > locUp) {
                map[String(rm.id)] = rObj;
              }
            }
          });

          var merged = Object.values(map);
          merged.sort(function (a, b) {
            var da = (a.date || '') + ' ' + (a.time || '');
            var db = (b.date || '') + ' ' + (b.time || '');
            return db.localeCompare(da);
          });
          save(merged);
          render();
          triggerCashBalanceSync();
        }
      }
      if (!silent) toast('Cash borrowings synced online with cloud!');
    } catch (e) {
      if (!silent) console.warn('[CashBorrow] Sync warning:', e);
    }
  }

  /* ---- UI Renderers ---- */

  // 1. Executive Dashboard Banner (Compact, Subtle & Hidden When Balanced)
  function renderDashboardBanner() {
    var banner = $('dash-cash-borrow-banner');
    if (!banner) return;

    var totals = getTotals();

    if (totals.totalPending === 0) {
      banner.className = 'cash-borrow-hero-banner is-balanced';
      banner.style.display = 'none';
      banner.innerHTML = '';
      return;
    }

    banner.style.display = 'flex';
    banner.className = 'cash-borrow-hero-banner has-liability';

    var badgeText = totals.netParty === 'muhasib_owes' ? 'Muhasib Owes' : 'Hospital Owes';
    var badgeStyle = totals.netParty === 'muhasib_owes'
      ? 'background:rgba(168,85,247,0.18); color:#c084fc; border:1px solid rgba(168,85,247,0.4);'
      : 'background:rgba(2,132,199,0.18); color:#38bdf8; border:1px solid rgba(2,132,199,0.4);';

    var owesText = totals.netParty === 'muhasib_owes' ? 'Muhasib owes Hospital:' : 'Hospital owes Muhasib:';

    banner.innerHTML =
      '<div class="cb-compact-left">' +
        '<span class="cb-pulse-dot" style="width:7px;height:7px;"></span>' +
        '<span class="cb-compact-pill" style="' + badgeStyle + '">' + badgeText + '</span>' +
        '<span class="cb-compact-title">' + owesText + ' <strong class="cb-compact-amt">' + fmtINR(totals.netAmount) + '</strong></span>' +
      '</div>' +
      '<div style="display:flex; align-items:center; gap:0.4rem;">' +
        '<button type="button" class="cb-btn-compact-view" onclick="document.querySelector(\'[data-panel=\\\'cash-borrow\\\']\').click()">' +
          '<span>View &amp; Settle (' + totals.totalPendingCount + ')</span> &rarr;' +
        '</button>' +
      '</div>';
  }

  // 2. Sidebar Badge
  function renderSidebarBadge() {
    var totals = getTotals();
    var b = $('sidebar-borrow-badge');
    if (b) {
      if (totals.totalPendingCount > 0) {
        b.style.display = 'inline-block';
        b.textContent = totals.totalPendingCount;
        b.className = 'badge badge-error';
        b.title = totals.netText;
      } else {
        b.style.display = 'none';
      }
    }
  }

  // 3. Panel KPIs
  function renderPanelKPIs() {
    var totals = getTotals();

    var netVal = $('cb-kpi-net-val');
    var netSub = $('cb-kpi-net-sub');
    var h2mVal = $('cb-kpi-h2m-val');
    var h2mSub = $('cb-kpi-h2m-sub');
    var m2hVal = $('cb-kpi-m2h-val');
    var m2hSub = $('cb-kpi-m2h-sub');
    var setVal = $('cb-kpi-settled-val');
    var setSub = $('cb-kpi-settled-sub');

    if (netVal) {
      if (totals.netParty === 'muhasib_owes') {
        netVal.innerHTML = '<span style="color:#e11d48">' + fmtINR(totals.netAmount) + '</span>';
        netSub.textContent = 'Payable by Muhasib to Hospital Cash';
      } else if (totals.netParty === 'hospital_owes') {
        netVal.innerHTML = '<span style="color:#0284c7">' + fmtINR(totals.netAmount) + '</span>';
        netSub.textContent = 'Payable by Hospital to Muhasib Cash';
      } else {
        netVal.innerHTML = '<span style="color:#10b981">₹0.00 (Balanced)</span>';
        netSub.textContent = 'Both cashboxes are balanced';
      }
    }

    if (h2mVal) {
      h2mVal.textContent = fmtINR(totals.h2mPending);
      h2mSub.textContent = totals.h2mPendingCount + ' pending records (Muhasib liability)';
    }

    if (m2hVal) {
      m2hVal.textContent = fmtINR(totals.m2hPending);
      m2hSub.textContent = totals.m2hPendingCount + ' pending records (Hospital liability)';
    }

    if (setVal) {
      setVal.textContent = fmtINR(totals.totalSettled);
      setSub.textContent = totals.settledCount + ' records settled & returned';
    }
  }

  // 4. Panel Table & List
  var activeStatusFilter = 'all'; // 'all' | 'pending' | 'settled'

  function getFilteredList() {
    var list = load();
    var q = (($('search-cash-borrow') || {}).value || '').trim().toLowerCase();
    var dir = (($('filter-cb-direction') || {}).value || '').trim();
    var from = (($('filter-cb-from') || {}).value || '').trim();
    var to = (($('filter-cb-to') || {}).value || '').trim();

    return list.filter(function (item) {
      if (activeStatusFilter === 'pending' && item.status !== 'pending') return false;
      if (activeStatusFilter === 'settled' && item.status !== 'settled') return false;
      if (dir && item.direction !== dir) return false;
      if (from && (item.date || '') < from) return false;
      if (to && (item.date || '') > to) return false;

      if (q) {
        var hay = [
          String(item.amount || ''),
          fmtDate(item.date),
          item.date || '',
          item.status || '',
          item.direction === 'hospital_to_muhasib' ? 'hospital to muhasib' : 'muhasib to hospital'
        ].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderTable() {
    var tbody = $('list-cash-borrow');
    var mobList = $('mobile-list-cash-borrow');
    if (!tbody) return;

    var items = getFilteredList();

    // Sort order
    var sortVal = (($('sort-cash-borrow') || {}).value || 'date_desc');
    items.sort(function (a, b) {
      var da = (a.date || '') + ' ' + (a.time || '');
      var db = (b.date || '') + ' ' + (b.time || '');
      if (sortVal === 'date_desc') return db.localeCompare(da);
      if (sortVal === 'date_asc') return da.localeCompare(db);
      if (sortVal === 'amount_desc') return (Number(b.amount) || 0) - (Number(a.amount) || 0);
      if (sortVal === 'amount_asc') return (Number(a.amount) || 0) - (Number(b.amount) || 0);
      return 0;
    });

    // Badge showing filtered total
    var totalBadge = $('total-cash-borrow-badge');
    if (totalBadge) {
      var filteredSum = items.reduce(function (s, x) { return s + (Number(x.amount) || 0); }, 0);
      totalBadge.style.display = 'inline-block';
      totalBadge.textContent = 'Filtered: ' + fmtINR(filteredSum) + ' (' + items.length + ')';
    }

    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding:2.5rem; color:var(--text-muted);">' +
        '<div style="font-size:1.1rem; font-weight:700; margin-bottom:0.3rem;">No Borrowing Records Found</div>' +
        '<div style="font-size:0.82rem;">Click "+ New Borrow Entry" to record cash transfer between Hospital and Muhasib.</div>' +
        '</td></tr>';
      if (mobList) mobList.innerHTML = '<div style="text-align:center; padding:2rem; color:var(--text-muted);">No records found.</div>';
      return;
    }

    var html = '';
    var mobHtml = '';

    for (var i = 0; i < items.length; i++) {
      var r = items[i];
      var isH2M = r.direction === 'hospital_to_muhasib';
      var dirBadge = isH2M
        ? '<span class="badge-direction badge-direction-h2m" title="Drawn from Hospital Cash and used in Muhasib (Payable to Hospital)">' +
            '🏥 Hospital &rarr; 💼 Muhasib' +
          '</span>'
        : '<span class="badge-direction badge-direction-m2h" title="Drawn from Muhasib Cash and used in Hospital (Payable to Muhasib)">' +
            '💼 Muhasib &rarr; 🏥 Hospital' +
          '</span>';

      var statusBadge = r.status === 'pending'
        ? '<span class="badge-borrow-status pending"><span class="cb-pulse-dot" style="width:6px;height:6px;"></span> Pending</span>'
        : '<span class="badge-borrow-status settled">&#10003; Settled</span>';

      var actionBtns = '<div class="cb-action-btn-group">';
      if (r.status === 'pending') {
        actionBtns +=
          '<button type="button" class="btn-settle-action" onclick="(window.CashBorrow||app.cashBorrow).openSettleModal(\'' + esc(r.id) + '\')" title="Record return / settle">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="width:13px;height:13px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>' +
            '<span>Settle</span>' +
          '</button>';
      } else {
        actionBtns +=
          '<button type="button" class="btn-reopen-action" onclick="(window.CashBorrow||app.cashBorrow).reopen(\'' + esc(r.id) + '\')" title="Reopen as pending">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>' +
            '<span>Reopen</span>' +
          '</button>';
      }
      actionBtns +=
        '<button type="button" class="btn btn-secondary btn-sm" onclick="(window.CashBorrow||app.cashBorrow).openEditModal(\'' + esc(r.id) + '\')" title="Edit Record">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
        '<button type="button" class="btn btn-delete-cb" onclick="(window.CashBorrow||app.cashBorrow).deleteEntry(\'' + esc(r.id) + '\')" title="Delete Record">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>' +
        '</button>' +
      '</div>';

      var dutyText = isH2M ? '<small style="color:#a855f7; display:block; font-size:0.7rem;">Payable to Hospital Cash</small>' : '<small style="color:#0284c7; display:block; font-size:0.7rem;">Payable to Muhasib Cash</small>';

      html +=
        '<tr>' +
          '<td><strong>' + fmtDate(r.date) + '</strong></td>' +
          '<td>' + dirBadge + dutyText + '</td>' +
          '<td><strong style="font-size:1.05rem;">' + fmtINR(r.amount) + '</strong>' +
            (r.status === 'settled' && r.settledAt ? '<br><small class="text-muted">Settled on ' + fmtDate(r.settledAt) + '</small>' : '') +
          '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td class="text-center">' + actionBtns + '</td>' +
        '</tr>';

      // Mobile Card HTML
      mobHtml +=
        '<div class="cb-mobile-card ' + (r.status === 'pending' ? 'is-pending' : 'is-settled') + '">' +
          '<div class="cb-mobile-top">' +
            '<div>' + dirBadge + '</div>' +
            '<div class="cb-mobile-amount">' + fmtINR(r.amount) + '</div>' +
          '</div>' +
          '<div class="cb-mobile-meta">' +
            '<div><strong>Date:</strong> ' + fmtDate(r.date) + '</div>' +
            '<div><strong>Status:</strong> ' + statusBadge + '</div>' +
            (r.status === 'settled' && r.settledAt ? '<div class="text-muted"><strong>Settled:</strong> ' + fmtDate(r.settledAt) + '</div>' : '') +
          '</div>' +
          '<div style="display:flex; justify-content:flex-end; gap:0.4rem; margin-top:0.35rem; padding-top:0.45rem; border-top:1px dashed var(--border-color,#e5e7eb);">' +
            actionBtns +
          '</div>' +
        '</div>';
    }

    tbody.innerHTML = html;
    if (mobList) mobList.innerHTML = mobHtml;
  }

  function render() {
    renderDashboardBanner();
    renderSidebarBadge();
    renderPanelKPIs();
    renderTable();
  }

  /* ---- Modal Operations ---- */
  var selectedDirection = 'hospital_to_muhasib';
  var editingId = null;

  function setDirection(dir) {
    selectedDirection = dir;
    var c1 = $('cb-radio-h2m');
    var c2 = $('cb-radio-m2h');
    if (c1 && c2) {
      if (dir === 'hospital_to_muhasib') {
        c1.className = 'cb-radio-card active';
        c2.className = 'cb-radio-card';
      } else {
        c1.className = 'cb-radio-card';
        c2.className = 'cb-radio-card active-m2h';
      }
    }
  }

  function openAddModal(presetDir) {
    editingId = null;
    var titleEl = $('dialog-cb-title');
    if (titleEl) titleEl.textContent = 'Record Cash Borrowing / Transfer';
    var form = $('form-cb-add');
    if (form) form.reset();
    var d = $('cb-date'); if (d) d.value = todayISO();
    setDirection(presetDir || 'hospital_to_muhasib');
    updateWordsPreview();
    openModal('dialog-cash-borrow-add');
    setTimeout(function () {
      var a = $('cb-amount');
      if (a) {
        a.focus();
        try { a.select(); } catch (e) {}
      }
    }, 120);
  }

  function openEditModal(id) {
    var list = load();
    var found = list.find(function (x) { return String(x.id) === String(id); });
    if (!found) return;

    editingId = String(id);
    var titleEl = $('dialog-cb-title');
    if (titleEl) titleEl.textContent = 'Edit Cash Borrowing Record';
    var d = $('cb-date'); if (d) d.value = found.date || todayISO();
    var a = $('cb-amount'); if (a) a.value = found.amount || '';
    setDirection(found.direction || 'hospital_to_muhasib');
    updateWordsPreview();
    openModal('dialog-cash-borrow-add');
    setTimeout(function () {
      var amt = $('cb-amount');
      if (amt) { amt.focus(); try { amt.select(); } catch (e) {} }
    }, 120);
  }

  function updateWordsPreview() {
    var amt = parseFloat(($('cb-amount') || {}).value) || 0;
    var preview = $('cb-words-preview');
    if (preview) {
      preview.textContent = amt > 0 ? amountInWords(amt) : '—';
    }
  }

  function triggerCashBalanceSync() {
    try {
      if (window.app) {
        if (typeof app.recalculateCashBorrowingBalances === 'function') {
          app.recalculateCashBorrowingBalances();
        }
        if (typeof app.syncState === 'function') {
          app.syncState();
        }
      }
    } catch (e) {
      console.warn('[CashBorrow] Balance sync warning:', e);
    }
  }

  function saveEntry(e) {
    if (e && e.preventDefault) e.preventDefault();

    var amt = parseFloat($('cb-amount').value) || 0;
    if (amt <= 0) {
      toast('Please enter a valid amount greater than 0', 'error');
      $('cb-amount').focus();
      return;
    }

    var list = load();
    var nowIso = new Date().toISOString();

    if (editingId) {
      var idx = list.findIndex(function (x) { return String(x.id) === editingId; });
      if (idx > -1) {
        list[idx].date = ($('cb-date') && $('cb-date').value) || list[idx].date || todayISO();
        list[idx].amount = amt;
        list[idx].direction = selectedDirection;
        list[idx].updatedAt = nowIso;
        markDirty(list[idx].id);
        toast('Record updated: ' + fmtINR(amt));
      }
    } else {
      var item = {
        id: uid(),
        date: ($('cb-date') && $('cb-date').value) || todayISO(),
        time: '',
        amount: amt,
        direction: selectedDirection,
        purpose: '',
        givenBy: '',
        status: 'pending',
        settledAmount: 0,
        settledAt: null,
        settleNotes: '',
        createdAt: nowIso,
        updatedAt: nowIso
      };
      list.unshift(item);
      markDirty(item.id);

      var dirDesc = item.direction === 'hospital_to_muhasib'
        ? 'Hospital → Muhasib'
        : 'Muhasib → Hospital';
      toast('Cash transfer recorded: ' + fmtINR(amt) + ' (' + dirDesc + ')');
    }

    save(list);
    closeModal('dialog-cash-borrow-add');
    render();
    triggerCashBalanceSync();
    syncOnline(true);
  }

  /* ---- Settlement Handlers ---- */
  var settlingId = null;

  function openSettleModal(id) {
    var list = load();
    var found = list.find(function (x) { return String(x.id) === String(id); });
    if (!found) return;

    settlingId = String(id);
    var remaining = Math.max(0, (Number(found.amount) || 0) - (Number(found.settledAmount) || 0));

    var infoEl = $('cb-settle-record-info');
    if (infoEl) {
      infoEl.innerHTML =
        '<div style="font-size:0.95rem; font-weight:700;">' +
          (found.direction === 'hospital_to_muhasib' ? '🏥 Hospital &rarr; 💼 Muhasib' : '💼 Muhasib &rarr; 🏥 Hospital') +
          ' — ' + fmtINR(found.amount) +
        '</div>' +
        '<div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.2rem;">' +
          'Date: ' + fmtDate(found.date) +
        '</div>';
    }

    var setAmt = $('cb-settle-amount'); if (setAmt) setAmt.value = remaining;
    var setDate = $('cb-settle-date'); if (setDate) setDate.value = todayISO();

    openModal('dialog-cash-borrow-settle');
    setTimeout(function () {
      if (setAmt) { setAmt.focus(); try { setAmt.select(); } catch (e) {} }
    }, 120);
  }

  function confirmSettle(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!settlingId) return;

    var list = load();
    var idx = list.findIndex(function (x) { return String(x.id) === settlingId; });
    if (idx === -1) return;

    var sAmt = parseFloat(($('cb-settle-amount') || {}).value) || 0;
    if (sAmt <= 0) {
      toast('Please enter a valid settlement amount', 'error');
      return;
    }

    var item = list[idx];
    item.settledAmount = (Number(item.settledAmount) || 0) + sAmt;
    item.settledAt = ($('cb-settle-date') && $('cb-settle-date').value) || todayISO();

    if (item.settledAmount >= item.amount) {
      item.status = 'settled';
    }
    item.updatedAt = new Date().toISOString();

    markDirty(item.id);
    save(list);
    closeModal('dialog-cash-borrow-settle');
    render();
    triggerCashBalanceSync();
    syncOnline(true);
    toast('Cash settled successfully! ' + fmtINR(sAmt) + ' returned to cashbox.');
  }

  function reopen(id) {
    if (!id) return;
    var list = load();
    var idx = list.findIndex(function (x) { return String(x.id) === String(id); });
    if (idx === -1) return;

    function doReopen() {
      var fresh = load();
      var fIdx = fresh.findIndex(function (x) { return String(x.id) === String(id); });
      if (fIdx > -1) {
        fresh[fIdx].status = 'pending';
        fresh[fIdx].settledAmount = 0;
        fresh[fIdx].settledAt = null;
        fresh[fIdx].updatedAt = new Date().toISOString();
        markDirty(fresh[fIdx].id);
        save(fresh);
        render();
        triggerCashBalanceSync();
        syncOnline(true);
        toast('Entry reopened as pending.');
      }
    }

    if (window.app && app.ui && typeof app.ui.showConfirm === 'function') {
      app.ui.showConfirm('Reopen Borrowing Record', 'Are you sure you want to reopen this entry as PENDING?', doReopen);
    } else {
      if (confirm('Are you sure you want to reopen this entry as PENDING?')) {
        doReopen();
      }
    }
  }

  function deleteEntry(id) {
    if (!id) return;
    var list = load();
    var idx = list.findIndex(function (x) { return String(x.id) === String(id); });
    if (idx === -1) {
      toast('Record not found', 'error');
      return;
    }
    var item = list[idx];
    var flowName = item.direction === 'hospital_to_muhasib' ? 'Hospital to Muhasib' : 'Muhasib to Hospital';
    var confirmMsg = 'Are you sure you want to delete borrowing record of ' + fmtINR(item.amount) + ' (' + flowName + ')?\n\nThis will remove the transaction from your ledger.';

    function doDelete() {
      // 1. Permanent tombstone so sync NEVER resurrects it
      var deletedIds = loadIds(LS_DELETED);
      if (deletedIds.indexOf(String(id)) === -1) {
        deletedIds.push(String(id));
        saveIds(LS_DELETED, deletedIds);
      }
      unmarkDirty(id);

      // 2. Remove immediately from local store
      var fresh = load().filter(function (x) { return String(x.id) !== String(id); });
      save(fresh);

      // 3. Immediately render all components (banner, badge, table, KPIs)
      render();
      triggerCashBalanceSync();

      // 4. Remote delete if online
      if (onlineReady() && app.supabase && app.supabase.delete) {
        app.supabase.delete('cash_borrowings', id).catch(function (e) {
          console.warn('[CashBorrow] Remote delete error:', e);
        });
      }

      toast('Borrowing record deleted successfully.');
    }

    if (window.app && app.ui && typeof app.ui.showConfirm === 'function') {
      app.ui.showConfirm('Delete Cash Borrowing Record', confirmMsg, doDelete);
    } else {
      if (confirm(confirmMsg)) {
        doDelete();
      }
    }
  }

  /* ---- Printable Slip ---- */
  function printSlip(id) {
    var list = load();
    var r = list.find(function (x) { return String(x.id) === String(id); });
    if (!r) return;

    var isH2M = r.direction === 'hospital_to_muhasib';
    var fromName = isH2M ? 'Hospital Cash' : 'Muhasib Cash (Float)';
    var toName = isH2M ? 'Muhasib Cash (Float)' : 'Hospital Cash';
    var liabilityNotice = isH2M
      ? 'Muhasib has borrowed from Hospital. Must be returned to Hospital Cash.'
      : 'Hospital has borrowed from Muhasib. Must be returned to Muhasib Cash.';

    var w = window.open('', '_blank', 'width=520,height=650');
    if (!w) {
      toast('Please allow popups to print slip', 'error');
      return;
    }

    w.document.write(
      '<!DOCTYPE html><html><head><title>Cash Borrowing Voucher #' + esc(r.id) + '</title>' +
      '<style>' +
        'body{font-family:system-ui,-apple-system,sans-serif;margin:20px;padding:0;color:#111;}' +
        '.slip{border:2px dashed #222;border-radius:10px;padding:20px;max-width:440px;margin:0 auto;}' +
        '.slip-head{text-align:center;border-bottom:2px solid #222;padding-bottom:10px;margin-bottom:12px;}' +
        '.hosp-title{font-size:18px;font-weight:900;letter-spacing:1px;}' +
        '.sub{font-size:11px;color:#555;font-weight:600;}' +
        '.badge{display:inline-block;padding:3px 10px;border:1px solid #111;border-radius:6px;font-size:12px;font-weight:800;margin-top:6px;text-transform:uppercase;}' +
        '.row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px dotted #ccc;font-size:13px;}' +
        '.row strong{text-align:right;}' +
        '.words{background:#f4f4f4;border:1px dashed #999;padding:8px;border-radius:6px;margin:12px 0;font-size:12px;font-weight:700;text-align:center;}' +
        '.notice{font-size:11px;color:#666;font-style:italic;margin-top:10px;line-height:1.4;text-align:center;}' +
        '.signs{display:flex;justify-content:space-between;margin-top:35px;font-size:12px;text-align:center;}' +
        '@media print{.no-print{display:none;}}' +
      '</style>' +
      '</head><body>' +
      '<div class="slip">' +
        '<div class="slip-head">' +
          '<div class="hosp-title">NOOR HOSPITAL QADIAN</div>' +
          '<div class="sub">TREASURY &bull; INTER-CASH BORROWING VOUCHER</div>' +
          '<div class="badge">' + (isH2M ? 'Hospital &rarr; Muhasib' : 'Muhasib &rarr; Hospital') + '</div>' +
        '</div>' +
        '<div class="row"><span>Voucher ID:</span><strong>' + esc(r.id) + '</strong></div>' +
        '<div class="row"><span>Date & Time:</span><strong>' + fmtDate(r.date) + ' ' + esc(r.time || '') + '</strong></div>' +
        '<div class="row"><span>Cash Drawn From:</span><strong>' + fromName + '</strong></div>' +
        '<div class="row"><span>Cash Used In:</span><strong>' + toName + '</strong></div>' +
        '<div class="row"><span>Amount:</span><strong style="font-size:16px;">' + fmtINR(r.amount) + '</strong></div>' +
        '<div class="words">' + amountInWords(r.amount) + '</div>' +
        '<div class="row"><span>Purpose / Reason:</span><strong>' + esc(r.purpose || 'General Exchange / Change') + '</strong></div>' +
        '<div class="row"><span>Handed By / To:</span><strong>' + esc(r.givenBy || 'Mubashar') + '</strong></div>' +
        '<div class="row"><span>Current Status:</span><strong>' + (r.status === 'pending' ? 'PENDING (Payable)' : 'SETTLED (Returned)') + '</strong></div>' +
        (r.settledAt ? '<div class="row"><span>Settled Date:</span><strong>' + fmtDate(r.settledAt) + '</strong></div>' : '') +
        '<div class="notice">' + liabilityNotice + '</div>' +
        '<div class="signs">' +
          '<div>____________________<br>Cash Handed Over By</div>' +
          '<div>____________________<br>Receiver / Muhasib</div>' +
        '</div>' +
      '</div>' +
      '<div style="text-align:center;margin-top:15px;" class="no-print">' +
        '<button onclick="window.print()" style="padding:8px 16px;font-weight:700;font-size:13px;cursor:pointer;">Print Slip</button>' +
      '</div>' +
      '</body></html>'
    );
    w.document.close();
  }

  /* ---- Export to Excel ---- */
  function exportExcel() {
    if (typeof XLSX === 'undefined') {
      toast('Excel library loading... please try again.', 'error');
      return;
    }
    var list = getFilteredList();
    if (!list.length) {
      toast('No records to export', 'info');
      return;
    }

    var rows = list.map(function (r) {
      var isH2M = r.direction === 'hospital_to_muhasib';
      return {
        'ID': r.id,
        'Date': r.date,
        'Direction': isH2M ? 'Hospital -> Muhasib' : 'Muhasib -> Hospital',
        'Liability': isH2M ? 'Muhasib owes Hospital' : 'Hospital owes Muhasib',
        'Amount': Number(r.amount) || 0,
        'Status': r.status === 'pending' ? 'Pending' : 'Settled',
        'Settled Date': r.settledAt || ''
      };
    });

    var ws = XLSX.utils.json_to_sheet(rows);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cash Borrowings');
    XLSX.writeFile(wb, 'Cash_Borrowings_' + todayISO() + '.xlsx');
    toast('Excel exported successfully!');
  }

  /* ---- Filter Buttons Event Listeners ---- */
  function setStatusFilter(status) {
    activeStatusFilter = status;
    var btnAll = $('btn-cb-filter-all');
    var btnPending = $('btn-cb-filter-pending');
    var btnSettled = $('btn-cb-filter-settled');

    if (btnAll) btnAll.className = 'btn btn-sm ' + (status === 'all' ? 'btn-primary' : 'btn-secondary');
    if (btnPending) btnPending.className = 'btn btn-sm ' + (status === 'pending' ? 'btn-primary' : 'btn-secondary');
    if (btnSettled) btnSettled.className = 'btn btn-sm ' + (status === 'settled' ? 'btn-primary' : 'btn-secondary');

    renderTable();
  }

  function clearFilters() {
    activeStatusFilter = 'all';
    var q = $('search-cash-borrow'); if (q) q.value = '';
    var dir = $('filter-cb-direction'); if (dir) dir.value = '';
    var f = $('filter-cb-from'); if (f) f.value = '';
    var t = $('filter-cb-to'); if (t) t.value = '';
    var s = $('sort-cash-borrow'); if (s) s.value = 'date_desc';

    setStatusFilter('all');
  }

  /* ---- Wire up Events & Backup ---- */
  function bind() {
    // Quick Action button direct click listener
    var qBtn = $('btn-quick-cash-borrow');
    if (qBtn) {
      qBtn.addEventListener('click', function (e) {
        e.preventDefault();
        openAddModal();
      });
    }

    // Search & Filter listeners
    var sInput = $('search-cash-borrow');
    if (sInput) sInput.addEventListener('input', renderTable);

    var dSelect = $('filter-cb-direction');
    if (dSelect) dSelect.addEventListener('change', renderTable);

    var fDate = $('filter-cb-from');
    if (fDate) fDate.addEventListener('change', renderTable);

    var tDate = $('filter-cb-to');
    if (tDate) tDate.addEventListener('change', renderTable);

    var sortSel = $('sort-cash-borrow');
    if (sortSel) sortSel.addEventListener('change', renderTable);

    // Amount input auto words & Enter navigation (direct submit for ultra-fast entry)
    var amtInp = $('cb-amount');
    if (amtInp) {
      amtInp.addEventListener('input', updateWordsPreview);
      amtInp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          var formAdd = $('form-cb-add');
          if (formAdd) {
            if (typeof formAdd.requestSubmit === 'function') formAdd.requestSubmit();
            else saveEntry(e);
          }
        }
      });
    }

    // Direction radio cards in modal
    var c1 = $('cb-radio-h2m');
    if (c1) c1.addEventListener('click', function () { setDirection('hospital_to_muhasib'); });

    var c2 = $('cb-radio-m2h');
    if (c2) c2.addEventListener('click', function () { setDirection('muhasib_to_hospital'); });

    // Quick chips for amount
    document.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-cb-amt]');
      if (chip) {
        var v = chip.getAttribute('data-cb-amt');
        var input = $('cb-amount');
        if (input) {
          if (v === 'clear') {
            input.value = '';
          } else {
            var cur = parseFloat(input.value) || 0;
            input.value = cur + parseFloat(v);
          }
          updateWordsPreview();
        }
      }
    });

    // Form submissions
    var formAdd = $('form-cb-add');
    if (formAdd) formAdd.addEventListener('submit', saveEntry);

    var formSettle = $('form-cb-settle');
    if (formSettle) formSettle.addEventListener('submit', confirmSettle);

    // Global keyboard shortcuts (Alt+B, Alt+C, Ctrl+Shift+B, Ctrl+Enter, Escape)
    document.addEventListener('keydown', function (e) {
      var dlgAdd = $('dialog-cash-borrow-add');
      var isAddOpen = dlgAdd && (dlgAdd.open || dlgAdd.classList.contains('active'));
      var dlgSettle = $('dialog-cash-borrow-settle');
      var isSettleOpen = dlgSettle && (dlgSettle.open || dlgSettle.classList.contains('active'));

      // If Add Modal is active
      if (isAddOpen) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          if (formAdd) formAdd.requestSubmit();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closeModal('dialog-cash-borrow-add');
          return;
        }
      }

      // If Settle Modal is active
      if (isSettleOpen) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          if (formSettle) formSettle.requestSubmit();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closeModal('dialog-cash-borrow-settle');
          return;
        }
      }

      // Alt+B or Alt+C: Open Cash Borrow modal from anywhere
      if (e.altKey && (e.key === 'b' || e.key === 'B' || e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        openAddModal();
        return;
      }

      // Ctrl+Shift+B or Cmd+Shift+B: Secondary shortcut
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        openAddModal();
        return;
      }
    });
  }

  function patchBackup() {
    try {
      if (!window.app || !app.db) return;
      if (app.db.importBackup && !app.db.importBackup._cbPatched) {
        var origImport = app.db.importBackup.bind(app.db);
        app.db.importBackup = async function (file) {
          try {
            var text = await file.text();
            var data = JSON.parse(text);
            if (data && Array.isArray(data.cash_borrowings)) {
              save(data.cash_borrowings);
              setTimeout(function () {
                render();
                toast('Cash borrowings restored (' + data.cash_borrowings.length + ')');
              }, 1500);
            }
          } catch (e) {}
          return origImport(file);
        };
        app.db.importBackup._cbPatched = true;
      }
    } catch (e) {}
  }

  /* ---- Public API ---- */
  var api = {
    openAddModal: openAddModal,
    openEditModal: openEditModal,
    openSettleModal: openSettleModal,
    confirmSettle: confirmSettle,
    reopen: reopen,
    deleteEntry: deleteEntry,
    printSlip: printSlip,
    exportExcel: exportExcel,
    setStatusFilter: setStatusFilter,
    clearFilters: clearFilters,
    render: render,
    getTotals: getTotals,
    syncOnline: syncOnline,
    closeModal: closeModal
  };

  // Immediate global exports so shortcuts & buttons never fail on early click
  window.CashBorrow = api;
  if (!window.app) window.app = {};
  window.app.cashBorrow = api;

  function init() {
    window.CashBorrow = api;
    if (!window.app) window.app = window.app || {};
    window.app.cashBorrow = api;

    bind();
    render();
    patchBackup();
    triggerCashBalanceSync();

    // Patch top bar panel titles
    try {
      if (window.app && app.ui && app.ui.switchTab && !app.ui.switchTab._cbPatched) {
        var origSwitch = app.ui.switchTab.bind(app.ui);
        app.ui.switchTab = function (panelId) {
          var r = origSwitch(panelId);
          if (panelId === 'cash-borrow') {
            var t = $('main-panel-title');
            if (t) t.textContent = 'Cash Borrowing & Liability Register';
            var s = $('main-panel-sub');
            if (s) s.textContent = 'Hospital Cash ⇄ Muhasib Cash borrowings, change & liability settlement';
            render();
          }
          return r;
        };
        app.ui.switchTab._cbPatched = true;
      }
    } catch (e) {}

    // Listen to global app render events to keep dashboard synced
    window.addEventListener('app:rendered', render);

    // Online sync
    setTimeout(function () {
      try {
        if (!navigator.onLine) return;
        ensureCreds().then(function (ok) {
          if (ok && onlineReady()) syncOnline(true).catch(function () {});
        }).catch(function () {});
      } catch (e) {}
    }, 4500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 100); });
  } else {
    setTimeout(init, 100);
  }
})();
