/* Staff Advance Receipts — standalone module (offline-first, localStorage).
 * Naam + Amount dalo → receipt khud ban jata hai. Subject changeable.
 */
(function () {
  'use strict';

  var LS_KEY = 'noor_staff_receipts_v1';

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
    try { return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
    catch (e) { return '₹' + n; }
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
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ============ ONLINE (Supabase) SYNC — receipts also live online ============ */
  var LS_DIRTY = 'noor_staff_receipts_dirty';
  var LS_DELETED = 'noor_staff_receipts_deleted';
  var _tableWarned = false;

  function loadIds(key) {
    try { var a = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function saveIds(key, arr) {
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
  }
  function markDirty(id) {
    var d = loadIds(LS_DIRTY);
    if (d.indexOf(id) === -1 && d.indexOf(String(id)) === -1) { d.push(id); saveIds(LS_DIRTY, d); }
  }
  function unmarkDirty(id) {
    saveIds(LS_DIRTY, loadIds(LS_DIRTY).filter(function (x) { return String(x) !== String(id); }));
  }
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
      date: r.date || null,
      name: r.name || null,
      amount: Number(r.amount) || 0,
      subject: r.subject || null,
      purpose: r.purpose || null,
      givenBy: r.givenBy || null,
      status: r.status || 'pending',
      movedTo: r.movedTo || null,
      slipId: (r.slipId === undefined || r.slipId === null || r.slipId === '') ? null : r.slipId,
      slipToken: r.slipToken || null,
      created_at: r.createdAt || r.created_at || now,
      updated_at: r.updatedAt || r.updated_at || r.createdAt || now,
      device_id: (window.app && app.getDeviceId) ? app.getDeviceId() : null
    };
  }
  function fromRemote(rec) {
    return {
      id: String(rec.id),
      date: rec.date || '',
      name: rec.name || '',
      amount: Number(rec.amount) || 0,
      subject: rec.subject || 'ADVANCE',
      purpose: rec.purpose || '',
      givenBy: rec.givenBy || '',
      status: rec.status || 'pending',
      movedTo: rec.movedTo || null,
      slipId: (rec.slipId === undefined || rec.slipId === null) ? null : rec.slipId,
      slipToken: rec.slipToken || null,
      createdAt: rec.created_at || '',
      updatedAt: rec.updated_at || ''
    };
  }
  function tableMissing(msg) {
    msg = String(msg || '');
    return msg.includes('PGRST205') || msg.includes('Could not find the table') || msg.includes('schema cache');
  }
  async function remoteUpsert(r) {
    if (!(await ensureCreds())) throw new Error('offline');
    var cleanUrl = app.supabase.url.replace(/\/$/, '');
    var res = await fetch(cleanUrl + '/rest/v1/staff_receipts', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + app.supabase.key,
        'apikey': app.supabase.key,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify(toRemote(r))
    });
    if (!res.ok) {
      var t = '';
      try { t = await res.text(); } catch (e) {}
      throw new Error('HTTP ' + res.status + ': ' + String(t).slice(0, 220));
    }
  }
  async function remoteDelete(id) {
    if (!(await ensureCreds())) throw new Error('offline');
    await app.supabase.delete('staff_receipts', id);
  }
  function pushReceipt(r) {
    if (!onlineReady()) { markDirty(r.id); return; }
    remoteUpsert(r).then(function () { unmarkDirty(r.id); }).catch(function (e) {
      markDirty(r.id);
      var msg = String((e && e.message) || e || '');
      if (tableMissing(msg) && !_tableWarned) {
        _tableWarned = true;
        toast('Online receipts table is missing — please run the latest SQL from Backup & Settings once', 'error');
      }
    });
  }
  async function pullReceipts() {
    if (!onlineReady() || !(await ensureCreds())) return 0;
    var remote = await app.supabase.request('staff_receipts', 'GET', null, { order: 'updated_at.desc', limit: '5000' });
    if (!Array.isArray(remote)) remote = [];
    var arr = load();
    var byId = {};
    arr.forEach(function (x) { byId[String(x.id)] = x; });

    // Load tombstones (deleted IDs) - NEVER purge them, they protect against resurrection
    var tombstones = loadIds(LS_DELETED);
    var deadSet = {};
    tombstones.forEach(function (x) { deadSet[String(x)] = 1; });

    var changed = false;
    for (var i = 0; i < tombstones.length; i++) {
      var delId = String(tombstones[i]);
      var existsRemote = remote.some(function (x) { return String(x.id) === delId; });
      if (existsRemote) {
        try { await remoteDelete(tombstones[i]); } catch (e) {}
      }
      if (byId[delId]) {
        delete byId[delId];
        changed = true;
      }
    }

    remote.forEach(function (rec) {
      var id = String(rec.id);
      if (deadSet[id]) return; // strictly honor tombstones
      var incoming = fromRemote(rec);
      var local = byId[id];
      if (!local) { byId[id] = incoming; changed = true; }
      else {
        var rt = new Date(rec.updated_at || rec.updatedAt || 0).getTime();
        var lt = new Date(local.updatedAt || local.updated_at || local.createdAt || 0).getTime();
        if (rt >= lt) {
          var merged = {};
          Object.keys(local).forEach(function (k) { merged[k] = local[k]; });
          Object.keys(incoming).forEach(function (k) { if (incoming[k] !== undefined) merged[k] = incoming[k]; });
          byId[id] = merged; changed = true;
        }
      }
    });
    var dirty = loadIds(LS_DIRTY);
    for (var j = 0; j < dirty.length; j++) {
      var lr = byId[String(dirty[j])];
      if (lr) {
        try { await remoteUpsert(lr); unmarkDirty(lr.id); }
        catch (e) { /* stays dirty for next time */ }
      } else { unmarkDirty(dirty[j]); }
    }
    if (changed || Object.keys(byId).length !== arr.length) {
      save(Object.keys(byId).map(function (k) { return byId[k]; }));
      render();
    }
    return remote.length;
  }
  function getSubject() {
    return 'ADVANCE';
  }

  function buildText(r) {
    var amt = Number(r.amount) || 0;
    var words = amountInWords(amt);
    var lines = [];
    lines.push((r.subject || 'ADVANCE'));
    lines.push('Received a sum of ' + fmtINR0(amt) + '/- (' + words + ') as ' + String(r.subject || 'advance').toLowerCase() + '.');
    lines.push('Received By: ' + (r.name || '—'));
    lines.push('Amount: ' + fmtINR0(amt) + '/-');
    lines.push('Date: ' + fmtDate(r.date));
    if (r.purpose) lines.push('Purpose: ' + r.purpose);
    if (r.givenBy) lines.push('Given By: ' + r.givenBy);
    lines.push('');
    lines.push('Signature: ___________________');
    return lines.join('\n');
  }

  var filters = { search: '', from: '', to: '', vendor: '', sort: 'date_desc' };
  var currentId = null;

  function filtered() {
    var arr = load().slice();
    var q = (filters.search || '').toLowerCase().trim();
    if (q) {
      arr = arr.filter(function (r) {
        return String(r.name || '').toLowerCase().indexOf(q) > -1 ||
          String(r.subject || '').toLowerCase().indexOf(q) > -1 ||
          String(r.purpose || '').toLowerCase().indexOf(q) > -1 ||
          String(r.givenBy || '').toLowerCase().indexOf(q) > -1 ||
          String(r.slipToken || '').toLowerCase().indexOf(q) > -1 ||
          String(r.amount || '').indexOf(q) > -1;
      });
    }
    if (filters.from) arr = arr.filter(function (r) { return String(r.date || '') >= filters.from; });
    if (filters.to) arr = arr.filter(function (r) { return String(r.date || '') <= filters.to; });
    if (filters.vendor) {
      var vNorm = filters.vendor.toLowerCase().trim();
      arr = arr.filter(function (r) {
        return String(r.name || '').toLowerCase().trim() === vNorm;
      });
    }
    var s = filters.sort || 'date_desc';
    arr.sort(function (a, b) {
      if (s === 'date_asc') return String(a.date || '').localeCompare(String(b.date || '')) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      if (s === 'amount_desc') return (Number(b.amount) || 0) - (Number(a.amount) || 0);
      if (s === 'amount_asc') return (Number(a.amount) || 0) - (Number(b.amount) || 0);
      if (s === 'alpha_asc') return String(a.name || '').localeCompare(String(b.name || ''));
      if (s === 'alpha_desc') return String(b.name || '').localeCompare(String(a.name || ''));
      return String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    return arr;
  }

  function statusPill(st) {
    st = String(st || 'pending');
    var label = st === 'returned' ? 'Returned' : st === 'adjusted' ? 'Adjusted' : 'Pending';
    return '<span class="status-pill status-' + esc(st) + '">' + esc(label) + '</span>';
  }

  function movedBadge(r) {
    if (r && r.movedTo && r.slipToken) {
      var where = r.movedTo === 'hospital' ? 'Hospital Adv' : 'Muhasib Adv';
      return '<span class="moved-badge">→ ' + esc(where) + ' • ' + esc(r.slipToken) + '</span>';
    }
    return '<span class="moved-none">—</span>';
  }

  /* Ensure person exists in Vendor Directory (slip register requires registered vendor) */
  async function ensureVendor(name) {
    try {
      var trimmed = String(name || '').trim();
      if (!trimmed) return false;
      var list = (window.app && app.state && app.state.vendors) || [];
      var exists = list.some(function (v) {
        return v && v.name && v.name.trim().toLowerCase() === trimmed.toLowerCase();
      });
      if (exists) return true;
      var newV = {
        name: trimmed,
        category: 'General',
        phone: '',
        remarks: 'Auto-created from staff advance receipt'
      };
      var id = await app.db.add('vendors', newV);
      newV.id = id;
      if (window.app && app.state && app.state.vendors) {
        app.state.vendors.push(newV);
      }
      if (window.app && app.vendors && app.vendors.populateVendorDropdowns) {
        app.vendors.populateVendorDropdowns();
      }
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  /* Create (or re-create) a temporary slip for this receipt */
  async function createLinkedSlip(r, dest) {
    // remove the old linked slip first (when moving again)
    if (r.slipId) {
      try { await app.db.delete('temporary_slips', r.slipId); } catch (e) {}
    }
    var ok = await ensureVendor(r.name);
    if (!ok) { toast('Could not create vendor — please try again', 'error'); return null; }
    var tokType = dest === 'hospital' ? 'hospital_slip' : 'advance_slip';
    var slip = {
      date: r.date,
      vendor: r.name,
      amount: Number(r.amount) || 0,
      expenseType: dest,
      tokenNumber: app.generateToken(tokType),
      remarks: '[' + (r.subject || 'ADVANCE') + ']' + (r.purpose ? ' ' + r.purpose : ''),
      status: 'pending'
    };
    var slipId = await app.db.add('temporary_slips', slip);
    return { id: slipId, tokenNumber: slip.tokenNumber };
  }

  /* When a receipt is edited, update the linked slip too */
  async function syncLinkedSlip(r) {
    try {
      if (!r.slipId || !window.app || !app.db) return;
      var s = ((app.state && app.state.temporarySlips) || []).filter(function (x) { return String(x.id) === String(r.slipId); })[0];
      if (!s) return;
      s.date = r.date; s.vendor = r.name; s.amount = Number(r.amount) || 0;
      s.remarks = '[' + (r.subject || 'ADVANCE') + ']' + (r.purpose ? ' ' + r.purpose : '');
      await app.db.put('temporary_slips', s.id, s);
      if (app.syncState) await app.syncState();
    } catch (e) { console.error(e); }
  }

  function toast(msg, type) {
    try {
      if (window.app && app.ui && app.ui.showToast) { app.ui.showToast(msg, type || 'success'); return; }
    } catch (e) {}
    alert(msg);
  }

  function render() {
    var all = load();
    var rows = filtered();
    var total = rows.reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);

    var tb = $('list-staff-receipts');
    if (tb) {
      if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:1.2rem">No receipts yet — click “New Advance Receipt” to create the first receipt.</td></tr>';
      } else {
        tb.innerHTML = rows.map(function (r) {
          return '<tr>' +
            '<td style="white-space:nowrap">' + esc(fmtDate(r.date)) + '</td>' +
            '<td><strong>' + esc(r.name || '—') + '</strong>' + (r.purpose ? '<br><span class="text-muted" style="font-size:.75rem">' + esc(String(r.purpose).slice(0, 60)) + '</span>' : '') + '</td>' +
            '<td><span class="font-mono" style="font-size:.72rem;font-weight:800">' + esc(r.subject || 'ADVANCE') + '</span></td>' +
            '<td style="white-space:nowrap;font-weight:800">' + esc(fmtINR(r.amount)) + '</td>' +
            '<td>' + movedBadge(r) + '</td>' +
            '<td><div class="rcpt-row-actions">' +
              '<button class="btn btn-secondary btn-sm" onclick="app.receipts.preview(\'' + esc(r.id) + '\')">View</button>' +
              '<button class="btn btn-secondary btn-sm" onclick="app.receipts.openMoveDialog(\'' + esc(r.id) + '\')" title="Move to Muhasib Advance / Hospital Advance">Move</button>' +
              '<button class="btn btn-secondary btn-sm" onclick="app.receipts.edit(\'' + esc(r.id) + '\')">Edit</button>' +
              '<button class="btn btn-secondary btn-sm text-error" onclick="app.receipts.remove(\'' + esc(r.id) + '\')">Del</button>' +
            '</div></td></tr>';
        }).join('');
      }
    }

    var mc = $('mobile-list-staff-receipts');
    if (mc) {
      mc.innerHTML = rows.map(function (r) {
        return '<div class="m-card">' +
          '<div class="m-card-top"><strong>' + esc(r.name || '—') + '</strong>' + movedBadge(r) + '</div>' +
          '<div class="m-card-mid"><span class="font-mono">' + esc(fmtDate(r.date)) + '</span><strong>' + esc(fmtINR(r.amount)) + '</strong></div>' +
          '<div class="text-muted" style="font-size:.75rem">' + esc(r.subject || '') + (r.purpose ? ' • ' + esc(String(r.purpose).slice(0, 80)) : '') + '</div>' +
          '<div class="rcpt-row-actions" style="margin-top:.5rem;justify-content:flex-start">' +
            '<button class="btn btn-secondary btn-sm" onclick="app.receipts.preview(\'' + esc(r.id) + '\')">View / Print</button>' +
            '<button class="btn btn-secondary btn-sm" onclick="app.receipts.openMoveDialog(\'' + esc(r.id) + '\')">Move</button>' +
            '<button class="btn btn-secondary btn-sm" onclick="app.receipts.edit(\'' + esc(r.id) + '\')">Edit</button>' +
            '<button class="btn btn-secondary btn-sm text-error" onclick="app.receipts.remove(\'' + esc(r.id) + '\')">Del</button>' +
          '</div></div>';
      }).join('') || '<div class="card text-center text-muted" style="padding:1.2rem">No receipts found.</div>';
    }

    var badge = $('total-staff-receipts');
    if (badge) {
      badge.textContent = 'Total: ' + fmtINR(total) + ' (' + rows.length + ')';
      badge.style.display = 'inline-flex';
    }
    var sb = $('sidebar-receipts-badge');
    if (sb) sb.textContent = String(all.length);

    populateVendorSelect();
  }

  /* Populate the "Received By" dropdown and the Filter bar dropdown with registered vendors */
  function populateVendorSelect(selectedVal) {
    var vendors = [];
    try {
      if (window.app && app.vendors && app.vendors.getUniqueVendors) {
        vendors = app.vendors.getUniqueVendors();
      } else if (window.app && app.state && app.state.vendors) {
        vendors = app.state.vendors;
      }
    } catch (e) {}

    var sorted = (vendors || []).filter(function (v) { return v && v.name && v.name.trim(); })
      .slice()
      .sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });

    function optLabel(v) {
      var code = String(v.vendorCode || v.code || '').trim();
      var nm = esc(v.name || '');
      return code ? nm + ' (' + esc(code) + ')' : nm;
    }

    var sel = $('receipt-name');
    if (sel && sel.tagName === 'SELECT') {
      var curr = selectedVal != null ? selectedVal : (sel.value || '');
      var opts = ['<option value="">-- Select Registered Vendor / Staff --</option>'];
      sorted.forEach(function (v) {
        opts.push('<option value="' + esc(v.name) + '">' + optLabel(v) + '</option>');
      });
      opts.push('<option disabled>──────────</option>');
      opts.push('<option value="__NEW__">➕ + Register New Vendor / Staff...</option>');
      opts.push('<option value="__CUSTOM__">✏️ Custom / Other Name...</option>');

      // If selectedVal is custom/legacy and not in list, add it as an option
      if (curr && curr !== '__NEW__' && curr !== '__CUSTOM__') {
        var found = sorted.some(function (v) { return (v.name || '').toLowerCase() === curr.toLowerCase(); });
        if (!found) {
          opts.splice(1, 0, '<option value="' + esc(curr) + '">' + esc(curr) + ' (Custom)</option>');
        }
      }
      sel.innerHTML = opts.join('');
      if (curr) sel.value = curr;
    }

    // Also populate filter dropdown if present
    var filterSel = $('filter-staff-receipts-vendor');
    if (filterSel) {
      var fCurr = filters.vendor || filterSel.value || '';
      var fOpts = ['<option value="">All Staff / Vendors</option>'];
      sorted.forEach(function (v) {
        fOpts.push('<option value="' + esc(v.name) + '">' + optLabel(v) + '</option>');
      });
      filterSel.innerHTML = fOpts.join('');
      if (fCurr) filterSel.value = fCurr;
    }
  }

  function renderRecentReceiverChips() {
    var rv = $('recent-receipt-vendors');
    if (!rv) return;
    var seen = {}, recents = [];
    var all = load();
    for (var i = all.length - 1; i >= 0; i--) {
      var n = String(all[i].name || '').trim();
      if (n && !seen[n.toLowerCase()]) {
        seen[n.toLowerCase()] = 1;
        recents.push(n);
        if (recents.length >= 4) break;
      }
    }
    if (recents.length < 4 && window.app && app.vendors && app.vendors.getUniqueVendors) {
      var list = app.vendors.getUniqueVendors();
      for (var j = 0; j < list.length; j++) {
        var vn = String(list[j].name || '').trim();
        if (vn && !seen[vn.toLowerCase()]) {
          seen[vn.toLowerCase()] = 1;
          recents.push(vn);
          if (recents.length >= 4) break;
        }
      }
    }
    if (!recents.length) { rv.innerHTML = ''; return; }
    rv.innerHTML = recents.map(function (nm) {
      return '<button type="button">' + esc(nm) + '</button>';
    }).join('');
    Array.prototype.forEach.call(rv.querySelectorAll('button'), function (btn, idx) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var targetName = recents[idx];
        api.selectVendor(targetName);
        var amt = $('receipt-amount');
        if (amt) amt.focus();
      });
    });
  }

  function fillForm(r) {
    $('edit-receipt-id').value = r ? r.id : '';
    $('receipt-date').value = r ? (r.date || todayISO()) : todayISO();
    var rName = r ? (r.name || '') : '';
    populateVendorSelect(rName);
    renderRecentReceiverChips();
    var sel = $('receipt-name');
    var wrap = $('receipt-name-custom-wrap');
    var custom = $('receipt-name-custom');
    if (sel && sel.tagName === 'SELECT') {
      if (rName) {
        sel.value = rName;
        if (sel.value !== rName) {
          sel.value = '__CUSTOM__';
          if (wrap) wrap.classList.remove('hidden');
          if (custom) custom.value = rName;
        } else {
          if (wrap) wrap.classList.add('hidden');
          if (custom) custom.value = '';
        }
      } else {
        sel.value = '';
        if (wrap) wrap.classList.add('hidden');
        if (custom) custom.value = '';
      }
    } else if ($('receipt-name')) {
      $('receipt-name').value = rName;
    }
    $('receipt-amount').value = r ? (r.amount || '') : '';
    $('receipt-purpose').value = r ? (r.purpose || '') : '';
    $('receipt-givenby').value = r ? (r.givenBy || '') : '';
    $('receipt-status').value = r ? (r.status || 'pending') : 'pending';
    var subjSel = $('receipt-subject');
    if (subjSel) subjSel.value = 'ADVANCE';
    var title = $('dialog-receipt-title');
    if (title) title.textContent = r ? 'Edit Staff Advance Receipt' : 'New Staff Advance Receipt';
    updateLive();
  }

  function readForm() {
    var amt = parseFloat(($('receipt-amount') || {}).value);
    var sel = $('receipt-name');
    var name = '';
    if (sel && sel.tagName === 'SELECT') {
      if (sel.value === '__CUSTOM__') {
        name = (($('receipt-name-custom') || {}).value || '').trim();
      } else if (sel.value === '__NEW__') {
        name = '';
      } else {
        name = (sel.value || '').trim();
      }
    } else {
      name = (($('receipt-name') || {}).value || '').trim();
    }
    return {
      date: ($('receipt-date') || {}).value || todayISO(),
      name: name,
      amount: isNaN(amt) ? 0 : amt,
      subject: getSubject(),
      purpose: (($('receipt-purpose') || {}).value || '').trim(),
      givenBy: (($('receipt-givenby') || {}).value || '').trim(),
      status: ($('receipt-status') || {}).value || 'pending'
    };
  }

  function updateLive() {
    var box = $('receipt-live-preview');
    var wp = $('receipt-words-preview');
    if (!box && !wp) return;
    var d = readForm();
    if (wp) wp.textContent = d.amount > 0 ? fmtINR0(d.amount) + '/-  •  ' + amountInWords(d.amount) : '— Amount in words will appear here —';
    if (box) {
      var txt = buildText(d).replace(/\n/g, '<br>');
      box.innerHTML = esc(fmtDate(d.date)) + '<br>' + esc(d.name || '— enter name —') + ' • <strong>' + esc(fmtINR(d.amount)) + '</strong><br><span class="text-muted">' + esc(d.subject || '') + '</span><div style="margin-top:.4rem;font-size:.8rem;background:var(--bg-elevated);border-radius:8px;padding:.5rem .6rem;white-space:normal">' + txt + '</div>';
    }
  }

  function openModal(id) {
    var d = $(id);
    if (d && d.open) return;
    try {
      if (window.app && app.ui && app.ui.openModal) { app.ui.openModal(id); return; }
    } catch (e) {}
    if (d && d.showModal) { try { d.showModal(); } catch (e2) { try { d.setAttribute('open', ''); } catch (e3) {} } }
  }
  function closeModal(id) {
    var d = $(id);
    if (d && !d.open) return;
    try {
      if (window.app && app.ui && app.ui.closeModal) { try { app.ui.closeModal(id); } catch (e) {} return; }
    } catch (e2) {}
    if (d && d.close) { try { d.close(); } catch (e3) {} }
  }

  function paintPaper(r) {
    $('receipt-paper-subject').textContent = r.subject || 'ADVANCE';
    $('receipt-paper-date').textContent = 'Date: ' + fmtDate(r.date);
    $('receipt-paper-date2').textContent = fmtDate(r.date);
    $('receipt-paper-name').textContent = r.name || '—';
    $('receipt-paper-amount').textContent = fmtINR0(Number(r.amount) || 0) + '/- (' + amountInWords(Number(r.amount) || 0) + ')';
    $('receipt-paper-text').textContent = 'Received a sum of ' + fmtINR0(Number(r.amount) || 0) + '/- (' + amountInWords(Number(r.amount) || 0) + ') as ' + String(r.subject || 'advance').toLowerCase() + '.';
    var pw = $('receipt-paper-purpose-wrap');
    if (r.purpose) { pw.style.display = ''; $('receipt-paper-purpose').textContent = r.purpose; }
    else { pw.style.display = 'none'; }
    var gw = $('receipt-paper-givenby-wrap');
    if (r.givenBy) { gw.style.display = ''; $('receipt-paper-givenby').textContent = r.givenBy; }
    else { gw.style.display = 'none'; }
    var sub = $('receipt-view-sub');
    if (sub) sub.textContent = (r.name || '') + ' • ' + fmtINR(r.amount);
  }

  function printDoc(r) {
    var w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { toast('Popup blocked — please allow popups for this page', 'error'); return; }
    if (w.focus) { try { w.focus(); } catch (e) {} }
    var amt = Number(r.amount) || 0;
    var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Staff Advance Receipt</title>' +
      '<style>' +
      '@page{size:A4 portrait;margin:12mm}' +
      '*{box-sizing:border-box}' +
      'body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#111;background:#fff}' +
      '.sheet{width:186mm;margin:0 auto}' +
      '.half{height:136mm;overflow:hidden}' +
      '.box{border:2px solid #111;border-radius:3mm;padding:8mm 7mm 7mm}' +
      'h1{text-align:center;letter-spacing:2mm;margin:0;font-size:22pt;font-weight:900}' +
      '.sub{text-align:center;font-size:10pt;color:#333;margin:1mm 0 5mm}' +
      '.subj{text-align:center;font-weight:900;font-size:13pt;letter-spacing:3mm;border:1.2pt solid #111;border-radius:2mm;padding:2.5mm;margin:0 0 5mm;text-indent:3mm}' +
      '.meta{display:flex;justify-content:space-between;font-size:10.5pt;font-weight:700;margin-bottom:4mm}' +
      '.txt{font-size:11.5pt;line-height:1.7;border:1pt dashed #888;border-radius:2mm;padding:3.5mm 4mm;background:#fafafa}' +
      '.rows{margin-top:4mm;font-size:11.5pt}' +
      '.rows div{margin:2mm 0}' +
      '.sign{display:flex;justify-content:space-between;margin-top:12mm;font-size:10.5pt;text-align:center}' +
      '.cut{border-top:1.2pt dashed #999;margin-top:8mm;text-align:center}' +
      '.cut span{background:#fff;padding:0 4mm;font-size:9pt;color:#666;position:relative;top:-3.5mm}' +
      '@media print{body{padding:0}.sheet{width:auto;margin:0}}' +
      '</style></head><body>' +
      '<div class="sheet"><div class="half">' +
      '<div class="box"><h1>NOOR HOSPITAL</h1>' +
      '<div class="subj">' + esc(r.subject || 'ADVANCE') + '</div>' +
      '<div class="meta"><span>Date: ' + esc(fmtDate(r.date)) + '</span></div>' +
      '<div class="txt">Received a sum of <strong>' + esc(fmtINR0(amt)) + '/- (' + esc(amountInWords(amt)) + ')</strong> as ' + esc(String(r.subject || 'advance').toLowerCase()) + '.</div>' +
      '<div class="rows"><div><strong>Received By:</strong> ' + esc(r.name || '') + '</div>' +
      '<div><strong>Amount:</strong> ' + esc(fmtINR0(amt)) + '/-</div>' +
      '<div><strong>Date:</strong> ' + esc(fmtDate(r.date)) + '</div>' +
      (r.purpose ? '<div><strong>Purpose:</strong> ' + esc(r.purpose) + '</div>' : '') +
      (r.givenBy ? '<div><strong>Given By:</strong> ' + esc(r.givenBy) + '</div>' : '') + '</div>' +
      '<div class="sign"><div>Receiver Signature<br><br>___________________</div><div>Authorised Sign<br><br>___________________</div></div>' +
      '</div>' +
      '<div class="cut"><span>&#9986; cut here</span></div>' +
      '</div></div><script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>';
    w.document.write(html);
    w.document.close();
  }

  var api = {
    openAddModal: function () {
      currentId = null;
      fillForm(null);
      openModal('dialog-receipt-add');
      setTimeout(function () {
        var n = $('receipt-name');
        if (n) n.focus();
      }, 150);
    },
    selectVendor: function (name) {
      name = String(name || '').trim();
      if (!name) return;
      populateVendorSelect(name);
      var sel = $('receipt-name');
      var wrap = $('receipt-name-custom-wrap');
      var custom = $('receipt-name-custom');
      if (sel) {
        sel.value = name;
        if (wrap) wrap.classList.add('hidden');
        if (custom) custom.value = '';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      updateLive();
    },
    populateVendorSelect: populateVendorSelect,
    /* Open the move-choice dialog (after save, or from list/preview) */
    openMoveDialog: function (id) {
      if (id) currentId = id;
      var r = load().filter(function (x) { return String(x.id) === String(currentId); })[0];
      if (!r) { toast('Receipt not found', 'error'); return; }
      var sub = $('receipt-move-sub');
      if (sub) sub.textContent = (r.name || '') + ' • ' + fmtINR(r.amount);
      var box = $('receipt-move-summary');
      if (box) {
        box.innerHTML = esc(fmtDate(r.date)) +
          '<br>' + esc(r.name || '') + ' • <strong>' + esc(fmtINR(r.amount)) + '</strong>' +
          '<br><span class="text-muted">' + esc(r.subject || '') + '</span>';
      }
      var note = $('receipt-move-note');
      if (note) {
        note.textContent = r.movedTo
          ? 'This receipt is already in ' + (r.movedTo === 'hospital' ? 'Hospital Advance' : 'Muhasib Advance') + ' (' + (r.slipToken || '') + ') — choosing again will remove the old slip and add it to the new place.'
          : 'Selecting Muhasib Advance or Hospital Advance will create an entry for this amount in that slip register. Skip keeps only the receipt.';
      }
      openModal('dialog-receipt-move');
    },
    confirmMove: async function (dest) {
      var arr = load();
      var r = arr.filter(function (x) { return String(x.id) === String(currentId); })[0];
      if (!r) { closeModal('dialog-receipt-move'); return; }
      if (!window.app || !app.db) { toast('App is not ready — please try again in a moment', 'error'); return; }
      toast('Adding to slip register...', 'info');
      try {
        var link = await createLinkedSlip(r, dest);
        if (!link) return;
        r.movedTo = dest;
        r.slipId = link.id;
        r.slipToken = link.tokenNumber;
        r.updatedAt = new Date().toISOString();
        save(arr.map(function (x) { return String(x.id) === String(r.id) ? r : x; }));
        pushReceipt(r);
        if (app.syncState) await app.syncState();
        render();
        closeModal('dialog-receipt-move');
        paintPaper(r); openModal('dialog-receipt-view');
        toast(dest === 'hospital' ? 'Added to Hospital Advance (' + link.tokenNumber + ')' : 'Added to Muhasib Advance (' + link.tokenNumber + ')');
      } catch (e) {
        console.error(e);
        toast('Move failed: ' + (e && e.message ? e.message : e), 'error');
      }
    },
    skipMove: function () {
      closeModal('dialog-receipt-move');
      var r = load().filter(function (x) { return String(x.id) === String(currentId); })[0];
      if (r) { paintPaper(r); openModal('dialog-receipt-view'); }
    },
    syncNow: function (manual) {
      if (!onlineReady()) {
        if (manual !== false) toast('Offline — receipts are saved on this device and will sync when online', 'warning');
        return Promise.resolve(false);
      }
      if (manual !== false) toast('Syncing receipts online...', 'info');
      return pullReceipts().then(function (n) {
        render();
        if (manual !== false) toast('Receipts synced online (' + n + ' online records)', 'success');
        return true;
      }).catch(function (e) {
        var msg = String((e && e.message) || e || 'Unknown error');
        if (tableMissing(msg)) {
          toast('Online receipts table is missing — please run the latest SQL from Backup & Settings once', 'error');
        } else if (manual !== false) {
          toast('Online sync failed: ' + msg.slice(0, 140), 'error');
        }
        return false;
      });
    },
    edit: function (id) {
      var r = load().filter(function (x) { return String(x.id) === String(id); })[0];
      if (!r) return;
      currentId = r.id; fillForm(r); closeModal('dialog-receipt-view'); openModal('dialog-receipt-add');
    },
    editCurrent: function () { if (currentId) api.edit(currentId); },
    preview: function (id) {
      var r = load().filter(function (x) { return String(x.id) === String(id); })[0];
      if (!r) return;
      currentId = r.id; paintPaper(r); openModal('dialog-receipt-view');
    },
    printCurrent: function () {
      var r = load().filter(function (x) { return String(x.id) === String(currentId); })[0];
      if (r) printDoc(r);
    },
    copyText: function () {
      var r = load().filter(function (x) { return String(x.id) === String(currentId); })[0];
      if (!r) return;
      var t = buildText(r);
      function done() { toast('Receipt text copied!'); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function () { fallback(); });
      else fallback();
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = t; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed', 'error'); }
        document.body.removeChild(ta);
      }
    },
    shareWhatsApp: function () {
      var r = load().filter(function (x) { return String(x.id) === String(currentId); })[0];
      if (!r) return;
      window.open('https://wa.me/?text=' + encodeURIComponent('*NOOR HOSPITAL — ' + (r.subject || 'ADVANCE') + '*\n' + buildText(r)), '_blank');
    },
    shareWhatsAppId: function (id) {
      var r = load().filter(function (x) { return String(x.id) === String(id); })[0];
      if (!r) return;
      window.open('https://wa.me/?text=' + encodeURIComponent('*NOOR HOSPITAL — ' + (r.subject || 'ADVANCE') + '*\n' + buildText(r)), '_blank');
    },
    cycleStatus: function () {},
    remove: function (id) {
      if (!id) return;
      var arr = load();
      var r = arr.filter(function (x) { return String(x.id).trim() === String(id).trim(); })[0];
      if (!r) { console.warn('[receipts] remove: id not found', id); return; }
      var extra = r.movedTo ? '\nThe linked slip (' + (r.slipToken || '') + ') will also be deleted.' : '';
      var msg = 'Delete receipt for ' + (r.name || '') + ' (' + fmtINR(r.amount) + ')?' + extra;

      function doDelete() {
        console.log('[receipts] deleting receipt', id, r.name);
        // 1. Immediately remove from local storage & memory
        var fresh = load();
        fresh = fresh.filter(function (x) { return String(x.id).trim() !== String(id).trim(); });
        save(fresh);

        // 2. Permanent tombstone in LS_DELETED so Supabase pull NEVER re-inserts it
        var tomb = loadIds(LS_DELETED);
        if (tomb.indexOf(String(id)) === -1) {
          tomb.push(String(id));
          saveIds(LS_DELETED, tomb);
        }
        unmarkDirty(id);

        // 3. Online remote delete (fire & forget with tombstone protection)
        if (onlineReady()) {
          remoteDelete(id).catch(function (e) { console.warn('[receipts] remote delete failed (tombstone protects):', e); });
        }

        // 4. Delete linked slip from IndexedDB temporary_slips & app.state
        if (window.app && app.db) {
          (async function () {
            try {
              if (r.slipId) {
                await app.db.delete('temporary_slips', r.slipId);
                try { await app.db.delete('temporary_slips', parseInt(r.slipId, 10)); } catch (_) {}
                try { await app.db.delete('temporary_slips', String(r.slipId)); } catch (_) {}
              }
              if (r.slipToken && app.state && app.state.temporarySlips) {
                var matched = app.state.temporarySlips.filter(function (s) {
                  return String(s.tokenNumber) === String(r.slipToken) || String(s.id) === String(r.slipId);
                });
                for (var m = 0; m < matched.length; m++) {
                  try { await app.db.delete('temporary_slips', matched[m].id); } catch (_) {}
                  try { await app.db.delete('temporary_slips', parseInt(matched[m].id, 10)); } catch (_) {}
                }
                app.state.temporarySlips = app.state.temporarySlips.filter(function (s) {
                  return String(s.tokenNumber) !== String(r.slipToken) && String(s.id) !== String(r.slipId);
                });
              }
              if (app.syncState) await app.syncState();
            } catch (slipErr) {
              console.error('[receipts] Linked slip cleanup failed:', slipErr);
            }
          })();
        }

        // 5. Re-render receipts list and alert user
        render();
        toast('Receipt deleted successfully');
      }

      // Use app's custom confirm dialog (native confirm() fails on some mobile browsers)
      if (window.app && app.ui && app.ui.showConfirm) {
        app.ui.showConfirm('Delete Receipt', msg, doDelete);
      } else {
        // Fallback to native confirm if app.ui not ready
        if (confirm(msg)) doDelete();
      }
    },
    clearFilters: function () {
      filters = { search: '', from: '', to: '', vendor: '', sort: 'date_desc' };
      if ($('search-staff-receipts')) $('search-staff-receipts').value = '';
      if ($('filter-staff-receipts-from')) $('filter-staff-receipts-from').value = '';
      if ($('filter-staff-receipts-to')) $('filter-staff-receipts-to').value = '';
      if ($('filter-staff-receipts-vendor')) $('filter-staff-receipts-vendor').value = '';
      if ($('sort-staff-receipts')) $('sort-staff-receipts').value = 'date_desc';
      render();
    },
    exportExcel: function () {
      var rows = filtered();
      if (!rows.length) { toast('No receipts to export', 'warning'); return; }
      var data = rows.map(function (r) {
        return {
          'Date': fmtDate(r.date),
          'Received By': r.name || '',
          'Subject': r.subject || '',
          'Amount': Number(r.amount) || 0,
          'Amount In Words': amountInWords(Number(r.amount) || 0),
          'Purpose': r.purpose || '',
          'Given By': r.givenBy || '',
          'Moved To': r.movedTo ? (r.movedTo === 'hospital' ? 'Hospital Advance' : 'Muhasib Advance') + ' (' + (r.slipToken || '') + ')' : 'Not moved'
        };
      });
      try {
        if (window.XLSX && XLSX.utils) {
          var ws = XLSX.utils.json_to_sheet(data);
          var wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, 'Staff Receipts');
          XLSX.writeFile(wb, 'staff-advance-receipts-' + todayISO() + '.xlsx');
          return;
        }
      } catch (e) {}
      var head = Object.keys(data[0]);
      var csv = head.join(',') + '\n' + data.map(function (o) {
        return head.map(function (h) { return '"' + String(o[h]).replace(/"/g, '""') + '"'; }).join(',');
      }).join('\n');
      var blob = new Blob([csv], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'staff-advance-receipts-' + todayISO() + '.csv';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    },
    render: render,
    amountInWords: amountInWords,
    getAllReceipts: load,
    _load: load
  };

  function bind() {
    var f = $('form-receipt-add');
    if (f && !f._rcptBound) {
      f._rcptBound = true;
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var d = readForm();
        if (!d.name) {
          toast('Please select or enter the receiver / vendor name', 'error');
          var nameElem = $('receipt-name');
          if (nameElem && nameElem.value === '__CUSTOM__') {
            var cInp = $('receipt-name-custom');
            if (cInp) cInp.focus();
          } else if (nameElem) {
            nameElem.focus();
          }
          return;
        }
        if (!(d.amount > 0)) { toast('Please enter a valid amount', 'error'); return; }
        if (d.subject === '__CUSTOM__') d.subject = 'ADVANCE';
        var arr = load();
        var editId = ($('edit-receipt-id') || {}).value || currentId;
        var rec;
        if (editId) {
          rec = null;
          arr = arr.map(function (x) {
            if (String(x.id) === String(editId)) {
              rec = Object.assign({}, x, d, { id: x.id, updatedAt: new Date().toISOString() });
              return rec;
            }
            return x;
          });
          if (!rec) { rec = Object.assign({ id: uid(), createdAt: new Date().toISOString() }, d); arr.push(rec); }
        } else {
          rec = Object.assign({ id: uid(), createdAt: new Date().toISOString() }, d);
          arr.push(rec);
        }
        save(arr); render();
        pushReceipt(rec);
        closeModal('dialog-receipt-add');
        var form = $('form-receipt-add'); if (form) form.reset();
        $('edit-receipt-id').value = '';
        currentId = rec.id;
        // If an already-moved receipt was edited → sync the linked slip, then preview
        if (rec.movedTo && rec.slipId) {
          syncLinkedSlip(rec).then(function () {
            render();
            paintPaper(rec); openModal('dialog-receipt-view');
          });
        } else {
          // New entry → first ask where to move it
          api.openMoveDialog(rec.id);
        }
        toast('Receipt saved: ' + (rec.name || '') + ' — ' + fmtINR(rec.amount));
      });
      ['receipt-date', 'receipt-name', 'receipt-name-custom', 'receipt-amount', 'receipt-subject', 'receipt-subject-custom', 'receipt-purpose', 'receipt-givenby'].forEach(function (id) {
        var el = $(id);
        if (el) el.addEventListener('input', updateLive);
        if (el) el.addEventListener('change', updateLive);
      });
      var nameSel = $('receipt-name');
      if (nameSel) nameSel.addEventListener('change', function () {
        var wrap = $('receipt-name-custom-wrap');
        var custom = $('receipt-name-custom');
        if (nameSel.value === '__NEW__') {
          nameSel.value = '';
          if (wrap) wrap.classList.add('hidden');
          if (window.app && app.vendors && app.vendors.openAddVendorModal) {
            app.vendors.openAddVendorModal('', 'receipt');
          }
        } else if (nameSel.value === '__CUSTOM__') {
          if (wrap) wrap.classList.remove('hidden');
          if (custom) custom.focus();
        } else {
          if (wrap) wrap.classList.add('hidden');
          if (custom) custom.value = '';
        }
        updateLive();
      });
      document.addEventListener('click', function (e) {
        var chip = e.target.closest ? e.target.closest('[data-receipt-add]') : null;
        if (!chip) return;
        e.preventDefault();
        var inp = $('receipt-amount');
        if (!inp) return;
        var v = chip.getAttribute('data-receipt-add');
        if (v === 'clear') inp.value = '';
        else inp.value = ((parseFloat(inp.value) || 0) + parseFloat(v)).toString().replace(/\.00$/, '');
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        updateLive(); inp.focus();
      });
    }

    function bindFilter(id, key) {
      var el = $(id);
      if (el && !el._rcptBound) {
        el._rcptBound = true;
        el.addEventListener('input' in el && el.tagName === 'SELECT' ? 'change' : 'input', function () {
          filters[key] = el.value; render();
        });
        if (el.tagName === 'SELECT') el.addEventListener('change', function () { filters[key] = el.value; render(); });
      }
    }
    bindFilter('search-staff-receipts', 'search');
    bindFilter('filter-staff-receipts-from', 'from');
    bindFilter('filter-staff-receipts-to', 'to');
    bindFilter('filter-staff-receipts-vendor', 'vendor');
    bindFilter('sort-staff-receipts', 'sort');
  }

  /* Backup integration: restore receipts on JSON import */
  function patchBackup() {
    try {
      if (!window.app || !app.db) return;
      if (app.db.importBackup && !app.db.importBackup._rcptPatched) {
        var origImport = app.db.importBackup.bind(app.db);
        app.db.importBackup = async function (file) {
          try {
            var text = await file.text();
            var data = JSON.parse(text);
            if (data && Array.isArray(data.staff_receipts)) {
              save(data.staff_receipts);
              setTimeout(function () { render(); toast('Staff receipts restored (' + data.staff_receipts.length + ')'); }, 1500);
            }
          } catch (e) {}
          return origImport(file);
        };
        app.db.importBackup._rcptPatched = true;
      }
    } catch (e) {}
  }

  function init() {
    if (!window.app) window.app = window.app || {};
    window.app.receipts = api;
    bind();
    render();
    patchBackup();
    // Top-bar title fix: set title/sub once after switchTab (no loop)
    try {
      if (window.app && app.ui && app.ui.switchTab && !app.ui.switchTab._rcptPatched) {
        var origSwitch = app.ui.switchTab.bind(app.ui);
        app.ui.switchTab = function (panelId) {
          var r = origSwitch(panelId);
          if (panelId === 'staff-receipts') {
            var t = $('main-panel-title');
            if (t) t.textContent = 'Staff Advance Receipts';
            var s = $('main-panel-sub');
            if (s) s.textContent = 'Individual staff advance — name + amount = receipt ready';
          }
          return r;
        };
        app.ui.switchTab._rcptPatched = true;
      }
    } catch (e) {}
    // Silent online sync shortly after load (push dirty + pull latest)
    setTimeout(function () {
      try {
        if (!navigator.onLine) return;
        ensureCreds().then(function (ok) {
          if (ok && onlineReady()) pullReceipts().catch(function () {});
        }).catch(function () {});
      } catch (e) {}
    }, 4000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 300); });
  else setTimeout(init, 300);
})();
