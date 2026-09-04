/**
 * Noor Hospital Cash Management System
 * Core Client-Side Logic
 */

// Application Namespace
const app = {
  // Database Configuration
  dbConfig: {
    name: 'NoorHospitalCashDB',
    version: 6,
    stores: ['settings', 'advance_cash', 'hospital_cash', 'temporary_slips', 'bills', 'transfers', 'sync_queue', 'hospital_deposits', 'accounts_register']
  },

  // Chart.js instances tracking
  charts: {
    position: null,
    sources: null,
    status: null
  },

  // Central Application State
  state: {
    theme: 'dark',
    openingAdvanceCash: 0,
    openingHospitalCash: 0,
    
    advanceCashEntries: [],
    hospitalCashEntries: [],
    temporarySlips: [],
    bills: [],
    transfers: [],
    hospitalDeposits: [],
    accountsRegister: [],
    
    // Calculated aggregates
    advanceCashAvailable: 0,
    hospitalCashAvailable: 0,
    totalCashWithMe: 0,
    totalAdvanceCashReceived: 0,
    totalHospitalCashCollected: 0,
    totalHospitalDeposited: 0,
    advanceBillsPending: 0,
    hospitalBillsPending: 0,
    totalPendingBills: 0,
    advanceAvailableToSend: 0,
    hospitalAvailableToSend: 0,
    totalAdvanceSentToAccounts: 0,
    totalHospitalSentToAccounts: 0,
    totalSentToAccounts: 0,
    advanceAwaitingTransfer: 0,
    hospitalAwaitingTransfer: 0,
    totalAwaitingTransfer: 0,
    amanatReceived: 0,
    imprestReceived: 0,
    totalTransferred: 0,
    temporarySlipsPending: 0,
    temporarySlipsPendingAmount: 0
  },

  // Get/generate unique device ID
  getDeviceId() {
    let deviceId = localStorage.getItem('noor_device_id');
    if (!deviceId) {
      deviceId = 'device_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();
      localStorage.setItem('noor_device_id', deviceId);
    }
    return deviceId;
  },

  /**
   * Generate a unique sequential token number for entries.
   * @param {'slip'|'advance_bill'|'hospital_bill'} type
   * @returns {string} e.g. TS-1001, MB-1001, HB-1001
   */
  generateToken(type) {
    const prefixMap = {
      hospital_bill: 'HB',
      advance_bill: 'MB',
      hospital_slip: 'HS',
      advance_slip: 'MS',
      slip: 'TS'
    };
    let resolvedType = type;
    if (resolvedType === 'slip') {
      const expEl = document.getElementById('slip-exp-type');
      resolvedType = (expEl?.value === 'hospital') ? 'hospital_slip' : 'advance_slip';
    }
    const prefix = prefixMap[resolvedType] || prefixMap[type] || 'TK';
    let maxNum = 1000;

    const extractNum = (token, pfx) => {
      if (!token) return 0;
      const str = String(token).trim();
      const match = str.match(new RegExp('^' + pfx + '-(\\d+)$', 'i')) || str.match(/-(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    };

    if (resolvedType === 'hospital_bill' || resolvedType === 'advance_bill') {
      const expType = resolvedType === 'advance_bill' ? 'advance' : 'hospital';
      (app.state.bills || []).forEach(b => {
        if (String(b.expenseType || '').toLowerCase().trim() === expType) {
          const n = extractNum(b.tokenNumber, prefix);
          if (n > maxNum) maxNum = n;
        }
      });
    } else if (resolvedType === 'hospital_slip' || resolvedType === 'advance_slip') {
      const expType = resolvedType === 'advance_slip' ? 'advance' : 'hospital';
      (app.state.temporarySlips || []).forEach(s => {
        if (String(s.expenseType || '').toLowerCase().trim() === expType) {
          const n = extractNum(s.tokenNumber, prefix);
          if (n > maxNum) maxNum = n;
        }
      });
    } else {
      (app.state.temporarySlips || []).forEach(s => {
        const n = extractNum(s.tokenNumber, prefix);
        if (n > maxNum) maxNum = n;
      });
    }

    return `${prefix}-${maxNum + 1}`;
  },

  /**
   * Returns only true active, pending temporary slips.
   * Explicitly filters out:
   * 1) status === 'converted'
   * 2) Any slip whose ID is already referenced by a final bill (b.slipId) in the bills store.
   */
  getActiveTemporarySlips() {
    const convertedSlipIds = new Set(
      (app.state.bills || [])
        .filter(b => b.slipId !== null && b.slipId !== undefined && b.slipId !== '')
        .map(b => String(b.slipId))
    );
    return (app.state.temporarySlips || []).filter(s => 
      s.status !== 'converted' && !convertedSlipIds.has(String(s.id))
    );
  },

  // Simple Authentication Module
  auth: {
    credentials: {
      username: 'MUBASHAR',
      password: '6006212045'
    },

    isLoggedIn() {
      return localStorage.getItem('noor_user_logged_in') === 'true';
    },

    getUsername() {
      return localStorage.getItem('noor_username') || 'Guest';
    },

    login(username, password) {
      if (username.toUpperCase().trim() === app.auth.credentials.username && password === app.auth.credentials.password) {
        localStorage.setItem('noor_user_logged_in', 'true');
        localStorage.setItem('noor_username', username.toUpperCase().trim());
        
        // Populate Supabase credentials in localStorage automatically
        app.auth.embedSupabaseCredentials();

        app.ui.showToast('Logged in successfully!');
        app.auth.showApp();
        
        // Reload all data from Supabase to IndexedDB since it's a new device/session
        app.sync.pullAllData().then(() => {
          app.syncState();
        }).catch(err => {
          console.error('Initial pull on login failed:', err);
        });
        
        return true;
      } else {
        app.ui.showToast('Invalid username or password!', 'error');
        return false;
      }
    },

    logout() {
      localStorage.removeItem('noor_user_logged_in');
      localStorage.removeItem('noor_username');
      app.ui.showToast('Logged out successfully.');
      app.auth.showLogin();
      setTimeout(() => location.reload(), 500);
    },

    showApp() {
      const loginScreen = document.getElementById('login-screen');
      const appLayout = document.querySelector('.app-layout');
      if (loginScreen) loginScreen.style.display = 'none';
      if (appLayout) appLayout.style.display = 'grid';
      
      const userDisplay = document.getElementById('user-display-name');
      if (userDisplay) userDisplay.textContent = app.auth.getUsername();
    },

    showLogin() {
      const loginScreen = document.getElementById('login-screen');
      const appLayout = document.querySelector('.app-layout');
      if (loginScreen) loginScreen.style.display = 'flex';
      if (appLayout) appLayout.style.display = 'none';
    },

    embedSupabaseCredentials() {
      const embeddedUrl = 'https://lwnowxuqsqffhttfudxd.supabase.co';
      const embeddedKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3bm93eHVxc3FmZmh0dGZ1ZHhkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDg1MTU4OCwiZXhwIjoyMDk2NDI3NTg4fQ.s4oVRjjNEnP8kpNwzi9-CNSq31QZKv4nkfUDvtrZ46o';
      const embeddedBucket = 'bills';

      localStorage.setItem('noor_supabase_url', embeddedUrl);
      localStorage.setItem('noor_supabase_key', embeddedKey);
      localStorage.setItem('noor_supabase_bucket', embeddedBucket);

      app.db.setSetting('supabaseUrl', embeddedUrl);
      app.db.setSetting('supabaseKey', embeddedKey);
      app.db.setSetting('supabaseBucket', embeddedBucket);
    }
  },

  // Supabase Database CRUD client module
  supabase: {
    url: '',
    key: '',
    bucket: '',

    isConfigured() {
      return !!((localStorage.getItem('noor_supabase_url') && localStorage.getItem('noor_supabase_key')) || 
             (app.supabase.url && app.supabase.key));
    },

    async init() {
      let url = localStorage.getItem('noor_supabase_url');
      let key = localStorage.getItem('noor_supabase_key');
      let bucket = localStorage.getItem('noor_supabase_bucket');
      
      if (!url || !key || !bucket) {
        url = await app.db.getSetting('supabaseUrl', url || '');
        key = await app.db.getSetting('supabaseKey', key || '');
        bucket = await app.db.getSetting('supabaseBucket', bucket || '');
        if (url) localStorage.setItem('noor_supabase_url', url);
        if (key) localStorage.setItem('noor_supabase_key', key);
        if (bucket) localStorage.setItem('noor_supabase_bucket', bucket);
      }
      
      app.supabase.url = url;
      app.supabase.key = key;
      app.supabase.bucket = bucket;
    },

    async request(table, method = 'GET', body = null, queryParams = {}) {
      if (!app.supabase.url || !app.supabase.key) {
        await app.supabase.init();
      }
      if (!app.supabase.url || !app.supabase.key) {
        throw new Error('Supabase credentials not configured');
      }

      const cleanUrl = app.supabase.url.replace(/\/$/, '');
      let requestUrl = `${cleanUrl}/rest/v1/${table}`;
      
      const query = new URLSearchParams(queryParams);
      if (query.toString()) {
        requestUrl += `?${query.toString()}`;
      }

      const headers = {
        'Authorization': `Bearer ${app.supabase.key}`,
        'apikey': app.supabase.key,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      };

      const options = {
        method,
        headers
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(requestUrl, options);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Supabase request failed: ${response.statusText} (${response.status}) - ${errorText}`);
      }

      if (response.status === 204) {
        return null;
      }
      
      return await response.json();
    },

    async getAll(table) {
      return await app.supabase.request(table, 'GET');
    },

    async insert(table, record) {
      // Exclude id for auto-increment columns if it is a temporary local id
      const clone = { ...record };
      delete clone.id;
      
      try {
        const results = await app.supabase.request(table, 'POST', clone);
        return results && results.length > 0 ? results[0] : null;
      } catch (err) {
        // If Supabase table doesn't have tokenNumber column yet, retry without tokenNumber
        if (clone.tokenNumber && String(err.message || '').includes('tokenNumber')) {
          console.warn(`Supabase table "${table}" does not have tokenNumber column yet. Retrying payload without tokenNumber.`);
          const fallbackClone = { ...clone };
          delete fallbackClone.tokenNumber;
          const fallbackResults = await app.supabase.request(table, 'POST', fallbackClone);
          return fallbackResults && fallbackResults.length > 0 ? fallbackResults[0] : null;
        }
        throw err;
      }
    },

    async update(table, id, record) {
      const clone = { ...record };
      delete clone.id; // Id should not be in the patch payload body
      try {
        const results = await app.supabase.request(table, 'PATCH', clone, { id: `eq.${id}` });
        return results && results.length > 0 ? results[0] : null;
      } catch (err) {
        // If Supabase table doesn't have tokenNumber column yet, retry without tokenNumber
        if (clone.tokenNumber && String(err.message || '').includes('tokenNumber')) {
          console.warn(`Supabase table "${table}" does not have tokenNumber column yet. Retrying update without tokenNumber.`);
          const fallbackClone = { ...clone };
          delete fallbackClone.tokenNumber;
          const fallbackResults = await app.supabase.request(table, 'PATCH', fallbackClone, { id: `eq.${id}` });
          return fallbackResults && fallbackResults.length > 0 ? fallbackResults[0] : null;
        }
        throw err;
      }
    },

    async delete(table, id) {
      await app.supabase.request(table, 'DELETE', null, { id: `eq.${id}` });
      return true;
    },

    async upsertSetting(key, value) {
      const record = {
        key,
        value: typeof value === 'object' ? JSON.stringify(value) : String(value),
        updated_at: new Date().toISOString(),
        device_id: app.getDeviceId()
      };

      const cleanUrl = app.supabase.url.replace(/\/$/, '');
      const requestUrl = `${cleanUrl}/rest/v1/settings`;
      const headers = {
        'Authorization': `Bearer ${app.supabase.key}`,
        'apikey': app.supabase.key,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation'
      };

      const response = await fetch(requestUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(record)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Supabase settings upsert failed: ${errorText}`);
      }
      return true;
    }
  },

  // Sync state engine
  sync: {
    status: 'offline',
    isProcessingQueue: false,

    init() {
      app.sync.checkConnection();
      
      window.addEventListener('online', () => {
        app.ui.showToast('Network restored. Syncing database & files...', 'info');
        app.sync.checkConnection().then(online => {
          if (online) {
            app.sync.processQueue();
          }
        });
      });
      
      window.addEventListener('offline', () => {
        app.sync.setStatus('offline', 'Offline Mode');
      });

      // Periodic check every 20 seconds
      setInterval(() => {
        if (navigator.onLine && app.supabase.isConfigured() && !app.sync.isProcessingQueue) {
          app.sync.processQueue();
        }
      }, 20000);
    },

    setStatus(status, message) {
      app.sync.status = status;
      const indicator = document.getElementById('sync-status-indicator');
      const dot = document.getElementById('sync-status-dot');
      const text = document.getElementById('sync-status-text');
      
      if (!indicator || !dot || !text) return;
      
      indicator.className = 'sync-status-indicator ' + status;
      text.textContent = message || (status === 'synced' ? 'Online & Synced' : 
                                      status === 'syncing' ? 'Syncing...' : 
                                      status === 'offline' ? 'Offline Mode' : 'Sync Error');
    },

    async checkConnection() {
      if (!navigator.onLine) {
        app.sync.setStatus('offline', 'Offline Mode');
        return false;
      }
      
      if (!app.supabase.isConfigured()) {
        app.sync.setStatus('offline', 'Not Configured');
        return false;
      }

      try {
        const cleanUrl = app.supabase.url.replace(/\/$/, '');
        const response = await fetch(`${cleanUrl}/rest/v1/settings?select=key&limit=1`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${app.supabase.key}`,
            'apikey': app.supabase.key
          }
        });
        
        if (response.ok) {
          app.sync.setStatus('synced', 'Online & Synced');
          return true;
        } else {
          app.sync.setStatus('error', 'Sync Error');
          return false;
        }
      } catch (err) {
        console.error('Connection check failed:', err);
        app.sync.setStatus('offline', 'Offline (No Connection)');
        return false;
      }
    },

    async queueOperation(table, method, recordId, record) {
      const operation = {
        table,
        method,
        recordId,
        record: record ? JSON.parse(JSON.stringify(record)) : null,
        timestamp: new Date().toISOString()
      };
      
      await app.db.add('sync_queue', operation);
      app.sync.setStatus('offline', 'Offline (Queue Pending)');
    },

    async processQueue() {
      if (app.sync.isProcessingQueue) return;
      if (!navigator.onLine || !app.supabase.isConfigured()) return;
      
      app.sync.isProcessingQueue = true;
      try {
        const queue = await app.db.getAll('sync_queue');
        if (queue.length > 0) {
          app.sync.setStatus('syncing', 'Syncing...');
          
          for (const item of queue) {
            try {
              if (item.method === 'INSERT') {
                const result = await app.supabase.insert(item.table, item.record);
                if (result && result.id) {
                  // Delete temporary local record, write actual record (localOnly = true)
                  await app.db.delete(item.table, item.recordId, true);
                  await app.db.put(item.table, null, result, true);
                  
                  // Propagate the real ID down the queue
                  app.sync.updateQueueReferences(queue, item.table, item.recordId, result.id);
                }
              } else if (item.method === 'UPDATE') {
                await app.supabase.update(item.table, item.recordId, item.record);
              } else if (item.method === 'DELETE') {
                await app.supabase.delete(item.table, item.recordId);
              } else if (item.method === 'SET_SETTING') {
                await app.supabase.upsertSetting(item.recordId, item.record.value);
              }
              
              await app.db.delete('sync_queue', item.id);
            } catch (itemErr) {
              console.error('Failed to sync queue item:', item, itemErr);
              app.sync.setStatus('error', 'Sync Error');
              return;
            }
          }
        }
        
        // Always pull latest data from remote and refresh local states when online
        await app.sync.pullAllData();
        app.sync.setStatus('synced', 'Online & Synced');
        await app.syncState();
      } catch (err) {
        console.error('Sync queue processing error:', err);
        app.sync.setStatus('error', 'Sync Error');
      } finally {
        app.sync.isProcessingQueue = false;
      }
    },

    updateQueueReferences(queue, table, oldId, newId) {
      for (const item of queue) {
        if (!item.record) continue;
        if (item.table === 'bills' && table === 'temporary_slips' && item.record.slipId === oldId) {
          item.record.slipId = newId;
          app.db.put('sync_queue', null, item);
        }
        if (item.table === table && item.recordId === oldId) {
          item.recordId = newId;
          if (item.record) item.record.id = newId;
          app.db.put('sync_queue', null, item);
        }
      }
    },

    async pullAllData() {
      if (!app.supabase.isConfigured()) return;

      // If a reset was deferred while offline, execute it on Supabase now before pulling.
      if (localStorage.getItem('noor_database_reset_pending') === 'true') {
        await app.sync.wipeRemoteTables();
        localStorage.removeItem('noor_database_reset_pending');
      }
      
      const tables = ['advance_cash', 'hospital_cash', 'temporary_slips', 'bills', 'transfers', 'hospital_deposits', 'accounts_register'];
      
      for (const table of tables) {
        try {
          const remoteRecords = await app.supabase.getAll(table);
          const localRecords = await app.db.getAll(table);
          
          const localMap = new Map(localRecords.map(r => [r.id, r]));

          // Build sets of pending queue operations so we never overwrite local intent
          const syncQueue = await app.db.getAll('sync_queue');
          const queuedInserts = new Set(syncQueue.filter(q => q.table === table && q.method === 'INSERT').map(q => String(q.recordId)));
          const queuedDeletes = new Set(syncQueue.filter(q => q.table === table && q.method === 'DELETE').map(q => String(q.recordId)));
          
          for (const remote of remoteRecords) {
            if (remote.amount !== undefined) remote.amount = parseFloat(remote.amount);
            if (remote.slipId !== undefined && remote.slipId !== null) remote.slipId = parseInt(remote.slipId);
            if (remote.transferId !== undefined && remote.transferId !== null) remote.transferId = parseInt(remote.transferId);

            // Skip any record that is queued for local deletion – do not restore it.
            if (queuedDeletes.has(String(remote.id))) continue;
            
            const local = localMap.get(remote.id);
            if (!remote.tokenNumber && local && local.tokenNumber) {
              remote.tokenNumber = local.tokenNumber;
            }
            if (!local) {
              await app.db.put(table, null, remote, true); // localOnly = true
            } else {
              const localUpdatedAt = new Date(local.updated_at || 0).getTime();
              const remoteUpdatedAt = new Date(remote.updated_at || 0).getTime();
              
              if (remoteUpdatedAt >= localUpdatedAt) {
                await app.db.put(table, null, remote, true); // localOnly = true
              }
            }
          }
          
          const remoteIds = new Set(remoteRecords.map(r => r.id));
          
          for (const local of localRecords) {
            if (!remoteIds.has(local.id) && !queuedInserts.has(local.id)) {
              await app.db.delete(table, local.id, true); // localOnly = true
            }
          }
        } catch (err) {
          console.error(`Failed to pull table ${table}:`, err);
          throw err;
        }
      }
      
      try {
        const remoteSettings = await app.supabase.getAll('settings');
        for (const remote of remoteSettings) {
          // Never let a remote setting overwrite local Supabase credentials
          if (remote.key === 'supabaseUrl' || remote.key === 'supabaseKey' || remote.key === 'supabaseBucket') continue;
          await app.db.setSetting(remote.key, remote.value, true); // localOnly = true
        }
      } catch (err) {
        console.error('Failed to pull settings:', err);
      }
    },

    /**
     * Delete all rows from every Supabase data table (used by Reset Database).
     */
    async wipeRemoteTables() {
      const tables = ['advance_cash', 'hospital_cash', 'temporary_slips', 'bills', 'transfers', 'hospital_deposits', 'accounts_register'];
      for (const table of tables) {
        try {
          // Delete all rows by using a filter that matches every row (id > 0)
          const cleanUrl = app.supabase.url.replace(/\/$/, '');
          const requestUrl = `${cleanUrl}/rest/v1/${table}?id=gt.0`;
          const headers = {
            'Authorization': `Bearer ${app.supabase.key}`,
            'apikey': app.supabase.key,
            'Content-Type': 'application/json'
          };
          await fetch(requestUrl, { method: 'DELETE', headers });
        } catch (err) {
          console.error(`Failed to wipe remote table ${table}:`, err);
        }
      }
    }
  },

  // ==========================================
  // INDEXEDDB ENGINE
  // ==========================================
  db: {
    /**
     * Initializes the IndexedDB database structure.
     */
    init() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(app.dbConfig.name, app.dbConfig.version);
        
        request.onerror = () => {
          app.ui.showToast('Database connection failed!', 'error');
          reject(request.error);
        };
        
        request.onsuccess = () => {
          resolve(request.result);
        };
        
        request.onupgradeneeded = (event) => {
          const db = request.result;
          
          if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings');
          }
          if (!db.objectStoreNames.contains('advance_cash')) {
            db.createObjectStore('advance_cash', { keyPath: 'id', autoIncrement: true });
          }
          if (!db.objectStoreNames.contains('hospital_cash')) {
            db.createObjectStore('hospital_cash', { keyPath: 'id', autoIncrement: true });
          }
          if (!db.objectStoreNames.contains('temporary_slips')) {
            db.createObjectStore('temporary_slips', { keyPath: 'id', autoIncrement: true });
          }
          if (!db.objectStoreNames.contains('bills')) {
            db.createObjectStore('bills', { keyPath: 'id', autoIncrement: true });
          }
          if (!db.objectStoreNames.contains('transfers')) {
            db.createObjectStore('transfers', { keyPath: 'id', autoIncrement: true });
          }
          if (!db.objectStoreNames.contains('sync_queue')) {
            const queueStore = db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
            queueStore.createIndex('status', 'status', { unique: false });
          }
          if (!db.objectStoreNames.contains('hospital_deposits')) {
            db.createObjectStore('hospital_deposits', { keyPath: 'id', autoIncrement: true });
          }
          if (!db.objectStoreNames.contains('accounts_register')) {
            db.createObjectStore('accounts_register', { keyPath: 'id', autoIncrement: true });
          }
        };
      });
    },

    /**
     * Helper to perform database transaction.
     */
    getTransaction(storeName, mode = 'readonly') {
      return app.db.init().then(db => {
        const transaction = db.transaction(storeName, mode);
        return transaction.objectStore(storeName);
      });
    },

    /**
     * Retrieve all items from a store.
     */
    getAll(storeName) {
      return new Promise((resolve, reject) => {
        app.db.getTransaction(storeName, 'readonly')
          .then(store => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          })
          .catch(reject);
      });
    },

    /**
     * Add a record to a store. Intercepts write to sync to Supabase first when online.
     */
    async add(storeName, record, localOnly = false) {
      if (storeName === 'settings' || storeName === 'sync_queue') {
        return new Promise((resolve, reject) => {
          app.db.getTransaction(storeName, 'readwrite')
            .then(store => {
              const request = store.add(record);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            })
            .catch(reject);
        });
      }

      if (!localOnly) {
        record.device_id = app.getDeviceId();
        const now = new Date().toISOString();
        if (!record.created_at) record.created_at = now;
        record.updated_at = now;
      }

      // Always save instantly to local IndexedDB
      const tempId = await new Promise((resolve, reject) => {
        app.db.getTransaction(storeName, 'readwrite')
          .then(store => {
            const request = store.add(record);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          })
          .catch(reject);
      });

      record.id = tempId;

      if (!localOnly) {
        // Queue the sync operation
        await app.sync.queueOperation(storeName, 'INSERT', tempId, record);
        // Trigger background sync in non-blocking manner
        app.sync.processQueue();
      }

      return tempId;
    },

    /**
     * Put (update) a record in a store. Intercepts write to sync to Supabase first when online.
     */
    async put(storeName, key, record, localOnly = false) {
      if (storeName === 'settings' || storeName === 'sync_queue') {
        return new Promise((resolve, reject) => {
          app.db.getTransaction(storeName, 'readwrite')
            .then(store => {
              let request;
              if (store.keyPath) {
                request = store.put(record);
              } else {
                request = store.put(record, key);
              }
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            })
            .catch(reject);
        });
      }

      // Only stamp device metadata when this is a user-initiated write, not a remote pull
      if (!localOnly) {
        record.device_id = app.getDeviceId();
        record.updated_at = new Date().toISOString();
      }

      const recordId = record.id;

      // Always save instantly to local IndexedDB
      await new Promise((resolve, reject) => {
        app.db.getTransaction(storeName, 'readwrite')
          .then(store => {
            const request = store.put(record);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          })
          .catch(reject);
      });

      if (!localOnly) {
        // Queue sync and trigger background sync asynchronously
        await app.sync.queueOperation(storeName, 'UPDATE', recordId, record);
        app.sync.processQueue();
      }

      return recordId;
    },

    /**
     * Delete a record by ID. Intercepts delete to sync to Supabase first when online.
     */
    async delete(storeName, id, localOnly = false) {
      if (storeName === 'settings' || storeName === 'sync_queue') {
        return new Promise((resolve, reject) => {
          app.db.getTransaction(storeName, 'readwrite')
            .then(store => {
              const request = store.delete(id);
              request.onsuccess = () => resolve();
              request.onerror = () => reject(request.error);
            })
            .catch(reject);
        });
      }

      // Always save instantly to local IndexedDB
      await new Promise((resolve, reject) => {
        app.db.getTransaction(storeName, 'readwrite')
          .then(store => {
            store.delete(id);
            if (typeof id === 'string' && !isNaN(parseInt(id, 10))) {
              try { store.delete(parseInt(id, 10)); } catch (_) {}
            } else if (typeof id === 'number') {
              try { store.delete(String(id)); } catch (_) {}
            }
            resolve();
          })
          .catch(reject);
      });

      if (!localOnly) {
        // Queue delete operation and trigger background sync asynchronously
        await app.sync.queueOperation(storeName, 'DELETE', id, null);
        app.sync.processQueue();
      }
    },

    /**
     * Retrieve settings keys.
     */
    getSetting(key, defaultValue) {
      return new Promise((resolve, reject) => {
        app.db.getTransaction('settings', 'readonly')
          .then(store => {
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result !== undefined ? request.result : defaultValue);
            request.onerror = () => reject(request.error);
          })
          .catch(reject);
      });
    },

    /**
     * Save settings key. Intercepts settings changes to sync to Supabase settings when appropriate.
     */
    async setSetting(key, value, localOnly = false) {
      const shouldSync = key !== 'supabaseUrl' && key !== 'supabaseKey' && key !== 'supabaseBucket';

      // Always save instantly to local settings cache
      await new Promise((resolve, reject) => {
        app.db.getTransaction('settings', 'readwrite')
          .then(store => {
            const request = store.put(value, key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
          })
          .catch(reject);
      });

      if (shouldSync && !localOnly) {
        await app.sync.queueOperation('settings', 'SET_SETTING', key, { value });
        app.sync.processQueue();
      }
    },

    /**
     * Export all data as a backup JSON file.
     */
    async exportBackup() {
      try {
        const backup = {
          openingAdvanceCash: app.state.openingAdvanceCash,
          openingHospitalCash: app.state.openingHospitalCash,
          theme: app.state.theme,
          advance_cash: await app.db.getAll('advance_cash'),
          hospital_cash: await app.db.getAll('hospital_cash'),
          temporary_slips: await app.db.getAll('temporary_slips'),
          bills: await app.db.getAll('bills'),
          transfers: await app.db.getAll('transfers'),
          hospital_deposits: await app.db.getAll('hospital_deposits'),
          accounts_register: await app.db.getAll('accounts_register')
        };
        
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `NoorHospital_Backup_${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        URL.revokeObjectURL(url);
        app.ui.showToast('Backup JSON file exported successfully!');
      } catch (err) {
        console.error(err);
        app.ui.showToast('Failed to export backup data.', 'error');
      }
    },

    /**
     * Wipes and restores the database using a backup file.
     */
    async importBackup(file) {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        
        // Simple verification
        if (data.openingAdvanceCash === undefined || data.openingHospitalCash === undefined) {
          throw new Error('Invalid backup file headers.');
        }

        const db = await app.db.init();

        // Preserve Supabase credentials
        const savedUrl = await app.db.getSetting('supabaseUrl', '');
        const savedKey = await app.db.getSetting('supabaseKey', '');
        const savedBucket = await app.db.getSetting('supabaseBucket', '');
        
        // Wipe all stores first
        for (const storeName of app.dbConfig.stores) {
          await new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          });
        }

        // Restore Settings
        await app.db.setSetting('openingAdvanceCash', parseFloat(data.openingAdvanceCash) || 0);
        await app.db.setSetting('openingHospitalCash', parseFloat(data.openingHospitalCash) || 0);
        await app.db.setSetting('theme', data.theme || 'dark');

        // Restore Supabase credentials
        if (savedUrl) await app.db.setSetting('supabaseUrl', savedUrl);
        if (savedKey) await app.db.setSetting('supabaseKey', savedKey);
        if (savedBucket) await app.db.setSetting('supabaseBucket', savedBucket);

        // Restore Ledgers & Registers
        const restoreStore = async (storeName, records) => {
          if (!records || !records.length) return;
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          for (const item of records) {
            store.add(item);
          }
          return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
        };

        await restoreStore('advance_cash', data.advance_cash);
        await restoreStore('hospital_cash', data.hospital_cash);
        await restoreStore('temporary_slips', data.temporary_slips);
        await restoreStore('bills', data.bills);
        await restoreStore('transfers', data.transfers);
        await restoreStore('hospital_deposits', data.hospital_deposits);
        await restoreStore('accounts_register', data.accounts_register);

        app.ui.showToast('Database successfully restored from JSON!');
        setTimeout(() => location.reload(), 1500);
      } catch (err) {
        console.error(err);
        app.ui.showToast('Restore failed: ' + err.message, 'error');
      }
    },

    /**
     * Prompts the user to reset the database.
     */
    promptResetDatabase() {
      app.ui.showConfirm(
        'Reset Database',
        'Warning: This will permanently erase ALL ledger records on this device AND the cloud database. You should export a backup file first. This action cannot be undone.',
        async () => {
          try {
            const db = await app.db.init();
            
            // Preserve Supabase credentials
            const savedUrl = await app.db.getSetting('supabaseUrl', '');
            const savedKey = await app.db.getSetting('supabaseKey', '');
            const savedBucket = await app.db.getSetting('supabaseBucket', '');

            // 1. Wipe ALL local IndexedDB stores
            for (const storeName of app.dbConfig.stores) {
              await new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                const req = store.clear();
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
              });
            }

            // 2. Restore Supabase credentials so connectivity is preserved
            if (savedUrl) await app.db.setSetting('supabaseUrl', savedUrl);
            if (savedKey) await app.db.setSetting('supabaseKey', savedKey);
            if (savedBucket) await app.db.setSetting('supabaseBucket', savedBucket);

            // 3. Also wipe remote Supabase tables to prevent auto-restore on next sync
            if (navigator.onLine && app.supabase.isConfigured()) {
              app.ui.showToast('Clearing cloud database...', 'info');
              await app.sync.wipeRemoteTables();
            } else {
              // Offline: mark a pending reset flag so it runs on next online sync
              localStorage.setItem('noor_database_reset_pending', 'true');
            }

            app.ui.showToast('Database wiped successfully. All cloud records cleared.');
            setTimeout(() => location.reload(), 1800);
          } catch (err) {
            console.error('Reset failed:', err);
            app.ui.showToast('Reset failed: ' + err.message, 'error');
          }
        }
      );
    },

    /**
     * Prompts the user to delete a record and handles dependencies.
     */
    promptDelete(storeName, id) {
      let message = 'Are you sure you want to delete this record?';
      if (storeName === 'temporary_slips') {
        const slip = app.state.temporarySlips.find(s => s.id === id);
        if (slip && slip.status === 'converted') {
          message = 'This temporary slip was converted to a final bill. Deleting it will also delete the associated final bill. Are you sure you want to proceed?';
        } else {
          message = 'Are you sure you want to delete this temporary slip?';
        }
      } else if (storeName === 'bills') {
        const bill = app.state.bills.find(b => b.id === id);
        if (bill && bill.slipId) {
          message = 'This bill was converted from a temporary slip. Deleting it will revert the temporary slip status back to pending. Are you sure?';
        } else {
          message = 'Are you sure you want to delete this bill?';
        }
      } else if (storeName === 'transfers') {
        message = 'Are you sure you want to delete this transfer?';
      } else if (storeName === 'accounts_register') {
        message = 'Are you sure you want to delete this Accounts Department entry?';
      }

      app.ui.showConfirm('Confirm Delete', message, async () => {
        try {
          if (storeName === 'temporary_slips') {
            const slip = app.state.temporarySlips.find(s => s.id === id);
            if (slip) {
              await app.attachments.deleteRecordAttachment(slip);
            }
            const associatedBill = app.state.bills.find(b => b.slipId === id);
            if (associatedBill) {
              await app.attachments.deleteRecordAttachment(associatedBill);
              await app.db.delete('bills', associatedBill.id);
            }
            await app.db.delete('temporary_slips', id);
          } else if (storeName === 'bills') {
            const bill = app.state.bills.find(b => b.id === id);
            if (bill) {
              await app.attachments.deleteRecordAttachment(bill);
              if (bill.slipId) {
                const slip = app.state.temporarySlips.find(s => s.id === bill.slipId);
                if (slip) {
                  slip.status = 'pending';
                  await app.db.put('temporary_slips', slip.id, slip);
                }
              }
            }
            await app.db.delete('bills', id);
          } else if (storeName === 'transfers') {
            await app.db.delete('transfers', id);
          } else if (storeName === 'accounts_register') {
            await app.db.delete('accounts_register', id);
          } else if (storeName === 'hospital_deposits') {
            const deposit = app.state.hospitalDeposits.find(d => d.id === id);
            if (deposit) {
              await app.attachments.deleteRecordAttachment(deposit);
            }
            await app.db.delete('hospital_deposits', id);
          } else {
            await app.db.delete(storeName, id);
          }
          app.ui.showToast('Record deleted successfully.');
          app.syncState();
        } catch (err) {
          app.ui.showToast('Failed to delete: ' + err.message, 'error');
        }
      });
    }
  },

  // ==========================================
  // STATE CALCULATIONS & DATA PIPELINE
  // ==========================================
  async syncState() {
    try {
      // 1. Fetch opening balances & settings
      app.state.openingAdvanceCash = parseFloat(await app.db.getSetting('openingAdvanceCash', 0)) || 0;
      app.state.openingHospitalCash = parseFloat(await app.db.getSetting('openingHospitalCash', 0)) || 0;
      app.state.theme = await app.db.getSetting('theme', 'dark');
      app.state.gdriveHospitalBills = await app.db.getSetting('gdriveHospitalBills', '');
      app.state.gdriveAdvanceBills = await app.db.getSetting('gdriveAdvanceBills', '');
      app.state.gdriveTempSlips = await app.db.getSetting('gdriveTempSlips', '');
      app.state.gdriveMuhasibDeposits = await app.db.getSetting('gdriveMuhasibDeposits', '');

      // 2. Fetch all raw items
      app.state.advanceCashEntries = await app.db.getAll('advance_cash');
      app.state.hospitalCashEntries = await app.db.getAll('hospital_cash');
      for (const e of app.state.hospitalCashEntries) { if (e.source === 'Other') { e.source = 'Reception Cash'; try { await app.db.put('hospital_cash', e.id, e); } catch(_){} } }
      app.state.bills = await app.db.getAll('bills');
      app.state.transfers = await app.db.getAll('transfers');
      app.state.hospitalDeposits = await app.db.getAll('hospital_deposits');
      app.state.accountsRegister = await app.db.getAll('accounts_register');

      app.state.temporarySlips = await app.db.getAll('temporary_slips');
      // Auto-purge any converted slips so they are totally removed from temporary slips:
      // 1) explicitly status === 'converted'
      // 2) any slip whose id is already converted into a bill (b.slipId in bills store)
      const convertedSlipIds = new Set(
        (app.state.bills || [])
          .filter(b => b.slipId !== null && b.slipId !== undefined && b.slipId !== '')
          .map(b => String(b.slipId))
      );
      const slipsToPurge = (app.state.temporarySlips || []).filter(s => 
        s.status === 'converted' || convertedSlipIds.has(String(s.id))
      );
      if (slipsToPurge.length > 0) {
        for (const cs of slipsToPurge) {
          try { 
            await app.db.delete('temporary_slips', cs.id);
            if (typeof cs.id === 'string' && !isNaN(parseInt(cs.id, 10))) {
              try { await app.db.delete('temporary_slips', parseInt(cs.id, 10)); } catch (_) {}
            } else if (typeof cs.id === 'number') {
              try { await app.db.delete('temporary_slips', String(cs.id)); } catch (_) {}
            }
          } catch (_) {}
        }
        app.state.temporarySlips = (app.state.temporarySlips || []).filter(s => 
          s.status !== 'converted' && !convertedSlipIds.has(String(s.id))
        );
      }

      // Auto-assign token numbers to any existing bills lacking one
      const sortedBills = (app.state.bills || []).slice().sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0) || (a.id || 0) - (b.id || 0));
      for (const bill of sortedBills) {
        if (!bill.tokenNumber || bill.tokenNumber === '-' || !String(bill.tokenNumber).match(/^[A-Z]{2}-\d+$/i)) {
          const isAdv = String(bill.expenseType || '').toLowerCase().trim() === 'advance';
          bill.tokenNumber = app.generateToken(isAdv ? 'advance_bill' : 'hospital_bill');
          try { await app.db.put('bills', bill.id, bill); } catch (_) {}
        }
      }

      // Auto-assign token numbers to any existing slips lacking one
      const sortedSlips = (app.state.temporarySlips || []).slice().sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0) || (a.id || 0) - (b.id || 0));
      for (const slip of sortedSlips) {
        if (!slip.tokenNumber || slip.tokenNumber === '-' || !String(slip.tokenNumber).match(/^[A-Z]{2}-\d+$/i)) {
          const isAdv = String(slip.expenseType || '').toLowerCase().trim() === 'advance';
          slip.tokenNumber = app.generateToken(isAdv ? 'advance_slip' : 'hospital_slip');
          try { await app.db.put('temporary_slips', slip.id, slip); } catch (_) {}
        }
      }

      // 3. Mathematical Aggregates
      
      // Totals of inflows
      const advanceCashInflows = app.state.advanceCashEntries.reduce((sum, e) => sum + e.amount, 0);
      const hospitalCashInflows = app.state.hospitalCashEntries.reduce((sum, e) => sum + e.amount, 0);

      // Total Inflows including opening balances
      app.state.totalAdvanceCashReceived = app.state.openingAdvanceCash + advanceCashInflows;
      app.state.totalHospitalCashCollected = app.state.openingHospitalCash + hospitalCashInflows;

      // Totals of active pending temporary slips (cash given out on pending vouchers)
      const activeSlipsList = app.getActiveTemporarySlips();
      const allAdvanceSlipsAmount = activeSlipsList
        .filter(s => s.expenseType === 'advance')
        .reduce((sum, s) => sum + s.amount, 0);

      const allHospitalSlipsAmount = activeSlipsList
        .filter(s => s.expenseType === 'hospital')
        .reduce((sum, s) => sum + s.amount, 0);

      // Totals of all final bills in bills store
      const allAdvanceBillsAmount = app.state.bills
        .filter(b => b.expenseType === 'advance')
        .reduce((sum, b) => sum + b.amount, 0);

      const allHospitalBillsAmount = app.state.bills
        .filter(b => b.expenseType === 'hospital')
        .reduce((sum, b) => sum + b.amount, 0);

      // Total Expenses: Pending Slips + Final Bills
      const advanceExpenses = allAdvanceSlipsAmount + allAdvanceBillsAmount;
      const hospitalExpenses = allHospitalSlipsAmount + allHospitalBillsAmount;

      // Sent To Accounts = total historically sent to accounts (must be computed BEFORE available cash so dashboard matches ledger)
      app.state.totalAdvanceSentToAccounts = app.state.accountsRegister
        .filter(a => a.billType === 'advance')
        .reduce((sum, a) => sum + a.amount, 0);
      app.state.totalHospitalSentToAccounts = app.state.accountsRegister
        .filter(a => a.billType === 'hospital')
        .reduce((sum, a) => sum + a.amount, 0);
      app.state.totalSentToAccounts = app.state.totalAdvanceSentToAccounts + app.state.totalHospitalSentToAccounts;

      // Available Cash Calculations
      app.state.advanceCashAvailable = app.state.openingAdvanceCash + advanceCashInflows - advanceExpenses;
      
      const hospitalDepositsSum = app.state.hospitalDeposits.reduce((sum, d) => sum + d.amount, 0);
      app.state.totalHospitalDeposited = hospitalDepositsSum;
      
      // Hospital Cash Available = Opening + Collections - Slips/Bills Expenses - Deposits to Muhasib - Sent To Accounts (hospital)
      // Accounts deduction added so dashboard matches Hospital Cash Ledger report (Dr = Collections | Cr = Bills/Slips/Deposits/Accounts)
      app.state.hospitalCashAvailable = app.state.openingHospitalCash + hospitalCashInflows - hospitalExpenses - hospitalDepositsSum - app.state.totalHospitalSentToAccounts;
      app.state.totalCashWithMe = app.state.advanceCashAvailable + app.state.hospitalCashAvailable;

      // Transfers & Settlements
      const imprestTransfersAmount = app.state.transfers
        .filter(t => t.type === 'imprest')
        .reduce((sum, t) => sum + t.amount, 0);

      const amanatTransfersAmount = app.state.transfers
        .filter(t => t.type === 'amanat')
        .reduce((sum, t) => sum + t.amount, 0);

      // Pending Bills = Total Bills - Total Transferred
      app.state.advanceBillsPending = allAdvanceBillsAmount - imprestTransfersAmount;
      app.state.hospitalBillsPending = allHospitalBillsAmount - amanatTransfersAmount;
      app.state.totalPendingBills = app.state.advanceBillsPending + app.state.hospitalBillsPending;

      // Available to send to accounts = Total Bills - Already Sent to Accounts
      app.state.advanceAvailableToSend = allAdvanceBillsAmount - app.state.totalAdvanceSentToAccounts;
      app.state.hospitalAvailableToSend = allHospitalBillsAmount - app.state.totalHospitalSentToAccounts;

      // Awaiting Transfer = Sent to Accounts - Transferred
      app.state.advanceAwaitingTransfer = app.state.totalAdvanceSentToAccounts - imprestTransfersAmount;
      app.state.hospitalAwaitingTransfer = app.state.totalHospitalSentToAccounts - amanatTransfersAmount;
      app.state.totalAwaitingTransfer = app.state.advanceAwaitingTransfer + app.state.hospitalAwaitingTransfer;

      app.state.amanatReceived = amanatTransfersAmount;
      app.state.imprestReceived = imprestTransfersAmount;
      app.state.totalTransferred = app.state.amanatReceived + app.state.imprestReceived;

      // Temporary Slips Pending Indicators
      app.state.temporarySlipsPending = activeSlipsList.length;
      app.state.temporarySlipsPendingAmount = activeSlipsList.reduce((sum, s) => sum + s.amount, 0);

      // Trigger Render and Refresh Viewports
      app.ui.renderAll();

      // Populate settings inputs and update folder link hrefs
      app.ui.updateDriveFolderUI();
    } catch (err) {
      console.error(err);
      app.ui.showToast(`Error synchronizing database calculations: ${err.message || err}`, 'error');
    }
  },

  // ==========================================
  // USER INTERFACE & NAVIGATION
  // ==========================================
  ui: {
    filters:{
      advance:{search:'',from:'',to:'',sort:'date_desc'},
      hospital:{search:'',from:'',to:'',sort:'date_desc'},
      deposits:{search:'',from:'',to:'',sort:'date_desc'},
      slips:{search:'',from:'',to:'',sort:'date_desc'},
      bills:{search:'',from:'',to:'',sort:'date_desc'},
      'advance-bills':{search:'',from:'',to:'',sort:'date_desc'},
      accounts:{search:'',from:'',to:'',sort:'date_desc'},
      transfers:{search:'',from:'',to:'',sort:'date_desc'}
    },
    applyFilter(page, patch){
      Object.assign(app.ui.filters[page], patch);
      const map={advance:'renderAdvanceTable',hospital:'renderHospitalTable',deposits:'renderDepositsTable',slips:'renderSlipsTable',bills:'renderBillsTable','advance-bills':'renderAdvanceBillsTable',accounts:'renderAccountsTable',transfers:'renderTransfersTable'};
      if(map[page]) app.ui[map[page]]();
      const mmap={advance:'renderAdvanceCards',hospital:'renderHospitalCards',deposits:'renderDepositsCards',slips:'renderSlipsCards',bills:'renderBillsCards','advance-bills':'renderAdvanceBillsCards',accounts:'renderAccountsCards',transfers:'renderTransfersCards'};
      if(app.mobile.isMobile() && app.mobile[mmap[page]]) app.mobile[mmap[page]]();
    },
    clearFilters(page){
      app.ui.filters[page]={search:'',from:'',to:'',sort:'date_desc'};
      const s=document.getElementById('search-'+page); if(s) s.value='';
      const f=document.getElementById('filter-'+page+'-from'); if(f) f.value='';
      const t=document.getElementById('filter-'+page+'-to'); if(t) t.value='';
      const so=document.getElementById('sort-'+page); if(so) so.value='date_desc';
      app.ui.applyFilter(page,{});
    },
    getFiltered(list, page, opts={}){
      const f=app.ui.filters[page]||{search:'',from:'',to:'',sort:'date_desc'};
      let out=[...list];
      if(f.from) out=out.filter(x=>{const d=x.date||x.dateSent||''; return d>=f.from});
      if(f.to) out=out.filter(x=>{const d=x.date||x.dateSent||''; return d<=f.to});
      if(f.search){
        const q=f.search.toLowerCase();
        out=out.filter(x=>JSON.stringify(x).toLowerCase().includes(q));
      }
      if(page==='bills' && opts.billsType!==undefined){
        const bt=document.getElementById('filter-bills-type')?.value;
        if(bt) out=out.filter(b=>b.expenseType===bt);
      }
      const sort=f.sort||'date_desc';
      const alphaKey={advance:'remarks',hospital:'source',deposits:'receiptNumber',slips:'vendor',bills:'vendor','advance-bills':'vendor',accounts:'referenceNo',transfers:'remarks'}[page];
      const dateKey= page==='accounts' ? 'dateSent' : 'date';
      out.sort((a,b)=>{
        if(sort==='date_asc') return new Date(a[dateKey]||0)-new Date(b[dateKey]||0);
        if(sort==='date_desc') return new Date(b[dateKey]||0)-new Date(a[dateKey]||0);
        if(sort==='amount_asc') return (a.amount||0)-(b.amount||0);
        if(sort==='amount_desc') return (b.amount||0)-(a.amount||0);
        if(sort==='alpha_asc') return String(a[alphaKey]||'').localeCompare(String(b[alphaKey]||''));
        if(sort==='alpha_desc') return String(b[alphaKey]||'').localeCompare(String(a[alphaKey]||''));
        return 0;
      });
      return out;
    },
    /**
     * Initializes listeners for click, navigation, form submissions, and dropdown changes.
     */
    init() {
      // Sidebar Tab Toggling
      const navButtons = document.querySelectorAll('.sidebar-nav .nav-item');
      navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const panelId = btn.getAttribute('data-panel');
          app.ui.switchTab(panelId);
        });
      });

      // Mobile Menu Trigger Buttons & Backdrop
      const mobileMenuBtn = document.getElementById('mobile-menu-btn');
      const mobileCloseBtn = document.getElementById('mobile-close-btn');
      const sidebar = document.getElementById('sidebar');
      const sidebarBackdrop = document.getElementById('sidebar-backdrop');

      function openSidebar() {
        sidebar.classList.add('mobile-open');
        if (sidebarBackdrop) sidebarBackdrop.classList.add('active');
      }

      function closeSidebar() {
        sidebar.classList.remove('mobile-open');
        if (sidebarBackdrop) sidebarBackdrop.classList.remove('active');
      }

      if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', openSidebar);
      if (mobileCloseBtn) mobileCloseBtn.addEventListener('click', closeSidebar);
      if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);

      // Mobile Theme Button Listener
      const mobileThemeBtn = document.getElementById('mobile-theme-btn');
      if (mobileThemeBtn) {
        mobileThemeBtn.addEventListener('click', () => {
          const current = document.documentElement.getAttribute('data-theme') || 'light';
          const next = current === 'dark' ? 'light' : 'dark';
          app.ui.setTheme(next, true);
        });
      }

      // Form Modals Declarative Click Fallbacks for outside clicks (light dismiss polyfill)
      const dialogs = document.querySelectorAll('dialog');
      dialogs.forEach(dialog => {
        if (!('closedBy' in HTMLDialogElement.prototype)) {
          dialog.addEventListener('click', (event) => {
            if (event.target !== dialog) return;
            const rect = dialog.getBoundingClientRect();
            const isClickInside = (
              rect.top <= event.clientY &&
              event.clientY <= rect.top + rect.height &&
              rect.left <= event.clientX &&
              event.clientX <= rect.left + rect.width
            );
            if (!isClickInside) {
              dialog.close();
            }
          });
        }
      });

      // Theme toggle handlers
      document.getElementById('theme-light-btn').addEventListener('click', () => app.ui.setTheme('light'));
      document.getElementById('theme-dark-btn').addEventListener('click', () => app.ui.setTheme('dark'));

      const bindPage=(page)=>{
        const s=document.getElementById('search-'+page);
        if(s) s.addEventListener('input', e=> app.ui.applyFilter(page,{search:e.target.value}));
        const f=document.getElementById('filter-'+page+'-from');
        if(f) f.addEventListener('change', e=> app.ui.applyFilter(page,{from:e.target.value}));
        const t=document.getElementById('filter-'+page+'-to');
        if(t) t.addEventListener('change', e=> app.ui.applyFilter(page,{to:e.target.value}));
        const so=document.getElementById('sort-'+page);
        if(so) so.addEventListener('change', e=> app.ui.applyFilter(page,{sort:e.target.value}));
      };
      ['advance','hospital','deposits','slips','bills','advance-bills','accounts','transfers'].forEach(bindPage);

      // Paid From segmented control <-> hidden select sync (fixes mode not changing)
      const syncBillSegUI = (val) => {
        const v = val || document.getElementById('bill-exp-type')?.value || 'advance';
        document.querySelectorAll('#bill-seg .seg-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.val === v);
        });
        const sel = document.getElementById('bill-exp-type');
        if (sel && sel.value !== v) sel.value = v;
        if (typeof app.ui.updateDriveFolderUI === 'function') app.ui.updateDriveFolderUI();
      };
      window.syncBillSegUI = syncBillSegUI;
      document.querySelectorAll('#bill-seg .seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const sel = document.getElementById('bill-exp-type');
          if (sel) {
            sel.value = btn.dataset.val;
            sel.dispatchEvent(new Event('change'));
          }
          syncBillSegUI(btn.dataset.val);
        });
      });
      // Auto-switch Google Drive folder link & dynamic token when bill expense type changes
      document.getElementById('bill-exp-type').addEventListener('change', () => {
        const val = document.getElementById('bill-exp-type').value;
        syncBillSegUI(val);
        const billTokenEl = document.getElementById('bill-token');
        if (billTokenEl && !document.getElementById('edit-bill-id')?.value) {
          billTokenEl.value = app.generateToken(val === 'advance' ? 'advance_bill' : 'hospital_bill');
          const billBadge = document.getElementById('bill-token-badge');
          if (billBadge) billBadge.textContent = billTokenEl.value;
        }
        if (app.attachments.activeSources['bill'] === 'gdrive') {
          app.attachments.setUploadSource('bill', 'gdrive');
        }
      });

      // Dynamic token when slip expense type changes
      const slipExpEl = document.getElementById('slip-exp-type');
      if (slipExpEl) {
        slipExpEl.addEventListener('change', () => {
          const slipTokenEl = document.getElementById('slip-token');
          if (slipTokenEl && !document.getElementById('edit-slip-id')?.value) {
            slipTokenEl.value = app.generateToken(slipExpEl.value === 'hospital' ? 'hospital_slip' : 'advance_slip');
            const slipBadge = document.getElementById('slip-token-badge');
            if (slipBadge) slipBadge.textContent = slipTokenEl.value;
          }
        });
      }

      // Dynamic token when convert destination expense type changes
      const convertExpEl = document.getElementById('convert-bill-exptype');
      if (convertExpEl) {
        convertExpEl.addEventListener('change', () => {
          const convertTokenEl = document.getElementById('convert-bill-token');
          if (convertTokenEl) {
            convertTokenEl.value = app.generateToken(convertExpEl.value === 'advance' ? 'advance_bill' : 'hospital_bill');
          }
        });
      }

      // Transfer amount field validation as user types
      const transferTypeSelect = document.getElementById('transfer-type');
      const transferAmountInput = document.getElementById('transfer-amount');
      
      const validateTransferAmount = () => {
        const type = transferTypeSelect.value;
        const amount = parseFloat(transferAmountInput.value) || 0;
        const limit = type === 'imprest' ? app.state.advanceBillsPending : app.state.hospitalBillsPending;
        
        const errorHelp = document.getElementById('transfer-amount-error-help');
        const submitBtn = document.querySelector('#form-transfer-add button[type="submit"]');

        document.getElementById('transfer-pending-limit-display').innerText = app.ui.formatCurrency(limit);

        if (amount > limit) {
          errorHelp.classList.remove('hidden');
          submitBtn.disabled = true;
        } else {
          errorHelp.classList.add('hidden');
          submitBtn.disabled = false;
        }
      };

      transferTypeSelect.addEventListener('change', validateTransferAmount);
      transferAmountInput.addEventListener('input', validateTransferAmount);

      // FORM SUBMISSIONS

      // Form: Edit Opening Balances
      document.getElementById('form-settings-balances').addEventListener('submit', async (e) => {
        e.preventDefault();
        const advVal = parseFloat(document.getElementById('input-opening-advance').value) || 0;
        const hospVal = parseFloat(document.getElementById('input-opening-hospital').value) || 0;
        await app.db.setSetting('openingAdvanceCash', advVal);
        await app.db.setSetting('openingHospitalCash', hospVal);
        app.ui.closeModal('dialog-settings');
        app.ui.showToast('Opening balances adjusted.');
        app.syncState();
      });

      document.getElementById('form-update-opening-balances').addEventListener('submit', async (e) => {
        e.preventDefault();
        const advVal = parseFloat(document.getElementById('setting-opening-advance').value) || 0;
        const hospVal = parseFloat(document.getElementById('setting-opening-hospital').value) || 0;
        await app.db.setSetting('openingAdvanceCash', advVal);
        await app.db.setSetting('openingHospitalCash', hospVal);
        app.ui.showToast('Starting balances updated.');
        app.syncState();
      });

      // Form: Add/Edit Muhasib Cash Entry
      document.getElementById('form-advance-add').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const editId = document.getElementById('edit-advance-id').value;
          const entry = {
            date: document.getElementById('adv-date').value,
            amount: parseFloat(document.getElementById('adv-amount').value),
            remarks: document.getElementById('adv-remarks').value
          };
          if (editId) {
            entry.id = parseInt(editId);
            await app.db.put('advance_cash', entry.id, entry);
            app.ui.showToast('Muhasib cash entry updated successfully!');
          } else {
            await app.db.add('advance_cash', entry);
            app.ui.showToast('Muhasib cash entry added successfully!');
          }
          app.ui.closeModal('dialog-advance-add');
          app.syncState();
        } catch (err) {
          console.error(err);
          app.ui.showToast('Failed to save Muhasib cash entry.', 'error');
        }
      });

      // Form: Add/Edit Hospital Cash collection
      document.getElementById('form-hospital-add').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const editId = document.getElementById('edit-hospital-id').value;
          const entry = {
            date: document.getElementById('hosp-date').value,
            source: document.getElementById('hosp-source').value,
            amount: parseFloat(document.getElementById('hosp-amount').value),
            remarks: document.getElementById('hosp-remarks').value
          };
          if (editId) {
            entry.id = parseInt(editId);
            await app.db.put('hospital_cash', entry.id, entry);
            app.ui.showToast('Hospital collection entry updated!');
          } else {
            await app.db.add('hospital_cash', entry);
            app.ui.showToast('Hospital collection entry recorded!');
          }
          app.ui.closeModal('dialog-hospital-add');
          app.syncState();
        } catch (err) {
          console.error(err);
          app.ui.showToast('Failed to save hospital collection entry.', 'error');
        }
      });

      // Form: Add/Edit Hospital Cash Deposit to Muhasib
      document.getElementById('form-deposit-add').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const editId = document.getElementById('edit-deposit-id').value;
          let attachmentProps = {};
          
          if (app.attachments.activeSources['deposit'] === 'gdrive') {
            const driveUrl = document.getElementById('deposit-gdrive-url').value.trim();
            if (driveUrl) {
              attachmentProps = {
                attachmentUrl: driveUrl,
                fileName: 'Google Drive File',
                fileType: 'url/gdrive',
                uploadDate: new Date().toISOString(),
                pendingUpload: false,
                localAttachmentData: null
              };
            }
          } else {
            const staged = app.attachments.stagedDepositAttachment;
            if (staged) {
              if (staged.removed) {
                attachmentProps = {
                  attachmentUrl: null,
                  fileName: null,
                  fileType: null,
                  uploadDate: null,
                  pendingUpload: false,
                  localAttachmentData: null
                };
              } else {
                attachmentProps = await app.attachments.processSave(staged);
              }
            }
          }

          const deposit = {
            date: document.getElementById('dep-date').value,
            amount: parseFloat(document.getElementById('dep-amount').value),
            receiptNumber: document.getElementById('dep-receipt').value,
            remarks: document.getElementById('dep-remarks').value,
            ...attachmentProps
          };

          if (editId) {
            deposit.id = parseInt(editId);
            if (!attachmentProps.attachmentUrl && app.attachments.activeViewedRecord && app.attachments.activeViewedRecord.attachmentUrl && !app.attachments.stagedDepositAttachment?.removed && app.attachments.activeSources['deposit'] !== 'gdrive') {
              deposit.attachmentUrl = app.attachments.activeViewedRecord.attachmentUrl;
              deposit.fileName = app.attachments.activeViewedRecord.fileName;
              deposit.fileType = app.attachments.activeViewedRecord.fileType;
              deposit.uploadDate = app.attachments.activeViewedRecord.uploadDate;
              deposit.pendingUpload = app.attachments.activeViewedRecord.pendingUpload || false;
              deposit.localAttachmentData = app.attachments.activeViewedRecord.localAttachmentData || null;
            }
            await app.db.put('hospital_deposits', deposit.id, deposit);
            app.ui.showToast('Hospital cash deposit updated successfully!');
          } else {
            await app.db.add('hospital_deposits', deposit);
            app.ui.showToast('Hospital cash deposit to Muhasib recorded successfully!');
          }
          
          app.attachments.clearStagedFile('deposit');
          app.ui.closeModal('dialog-deposit-add');
          app.syncState();
        } catch (err) {
          console.error(err);
          app.ui.showToast('Failed to save hospital cash deposit.', 'error');
        }
      });

      // Form: Add/Edit Temporary Slip
      document.getElementById('form-slip-add').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const editId = document.getElementById('edit-slip-id').value;
          let attachmentProps = {};
          
          if (app.attachments.activeSources['slip'] === 'gdrive') {
            const driveUrl = document.getElementById('slip-gdrive-url').value.trim();
            if (driveUrl) {
              attachmentProps = {
                attachmentUrl: driveUrl,
                fileName: 'Google Drive File',
                fileType: 'url/gdrive',
                uploadDate: new Date().toISOString(),
                pendingUpload: false,
                localAttachmentData: null
              };
            }
          } else {
            const staged = app.attachments.stagedSlipAttachment;
            if (staged) {
              if (staged.removed) {
                attachmentProps = {
                  attachmentUrl: null,
                  fileName: null,
                  fileType: null,
                  uploadDate: null,
                  pendingUpload: false,
                  localAttachmentData: null
                };
              } else {
                attachmentProps = await app.attachments.processSave(staged);
              }
            }
          }

          const slipExp = document.getElementById('slip-exp-type').value;
          const slipTokenType = slipExp === 'hospital' ? 'hospital_slip' : 'advance_slip';
          const slip = {
            date: document.getElementById('slip-date').value,
            vendor: document.getElementById('slip-vendor').value,
            amount: parseFloat(document.getElementById('slip-amount').value),
            expenseType: slipExp,
            remarks: document.getElementById('slip-remarks').value,
            status: editId ? app.attachments.activeViewedRecord.status : 'pending',
            tokenNumber: editId
              ? (app.attachments.activeViewedRecord.tokenNumber || app.generateToken(slipTokenType))
              : (document.getElementById('slip-token')?.value || app.generateToken(slipTokenType)),
            ...attachmentProps
          };

          if (editId) {
            slip.id = parseInt(editId);
            if (!attachmentProps.attachmentUrl && app.attachments.activeViewedRecord && app.attachments.activeViewedRecord.attachmentUrl && !app.attachments.stagedSlipAttachment?.removed && app.attachments.activeSources['slip'] !== 'gdrive') {
              slip.attachmentUrl = app.attachments.activeViewedRecord.attachmentUrl;
              slip.fileName = app.attachments.activeViewedRecord.fileName;
              slip.fileType = app.attachments.activeViewedRecord.fileType;
              slip.uploadDate = app.attachments.activeViewedRecord.uploadDate;
              slip.pendingUpload = app.attachments.activeViewedRecord.pendingUpload || false;
              slip.localAttachmentData = app.attachments.activeViewedRecord.localAttachmentData || null;
            }
            await app.db.put('temporary_slips', slip.id, slip);
            app.ui.showToast('Temporary slip updated successfully!');
          } else {
            await app.db.add('temporary_slips', slip);
            app.ui.showToast('Temporary slip registered successfully!');
          }

          app.attachments.clearStagedFile('slip');
          app.ui.closeModal('dialog-slip-add');
          app.syncState();
        } catch (err) {
          console.error(err);
          app.ui.showToast('Failed to save temporary slip.', 'error');
        }
      });

      // Form: Convert Temporary Slip to Final Bill
      document.getElementById('form-slip-convert').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const slipId = parseInt(document.getElementById('convert-slip-id').value);
          const expenseType = document.getElementById('convert-bill-exptype')?.value || document.getElementById('convert-slip-exptype')?.value || 'hospital';
          const originalVendor = document.getElementById('convert-slip-vendor-display').innerText;

          const slip = app.state.temporarySlips.find(s => s.id === slipId);
          
          let attachmentProps = {};
          
          if (app.attachments.activeSources['convert'] === 'gdrive') {
            const driveUrl = document.getElementById('convert-gdrive-url').value.trim();
            if (driveUrl) {
              attachmentProps = {
                attachmentUrl: driveUrl,
                fileName: 'Google Drive File',
                fileType: 'url/gdrive',
                uploadDate: new Date().toISOString(),
                pendingUpload: false,
                localAttachmentData: null
              };
            }
          } else {
            const staged = app.attachments.stagedConvertAttachment;
            if (staged) {
              if (staged.removed) {
                attachmentProps = {
                  attachmentUrl: null,
                  fileName: null,
                  fileType: null,
                  uploadDate: null,
                  pendingUpload: false,
                  localAttachmentData: null
                };
              } else {
                const processed = await app.attachments.processSave(staged);
                attachmentProps = processed;
                if (slip && slip.attachmentUrl) {
                  await app.attachments.deleteRecordAttachment(slip);
                }
              }
            } else if (slip && slip.attachmentUrl) {
              attachmentProps = {
                attachmentUrl: slip.attachmentUrl,
                fileName: slip.fileName,
                fileType: slip.fileType,
                uploadDate: slip.uploadDate,
                pendingUpload: slip.pendingUpload || false,
                localAttachmentData: slip.localAttachmentData || null
              };
            }
          }

          const bill = {
            date: document.getElementById('convert-bill-date').value,
            billNumber: document.getElementById('convert-bill-number').value,
            vendor: originalVendor, // carried over
            amount: parseFloat(document.getElementById('convert-bill-amount').value),
            expenseType: expenseType, // Hospital Bill (or chosen destination)
            category: document.getElementById('convert-bill-category').value,
            remarks: document.getElementById('convert-bill-remarks').value,
            slipId: slipId, // references parent slip
            status: 'pending', // pending / transferred
            tokenNumber: document.getElementById('convert-bill-token')?.value || app.generateToken(expenseType === 'advance' ? 'advance_bill' : 'hospital_bill'),
            ...attachmentProps
          };

          // Immediately mark converted in memory so no stale render can ever show it
          if (slip) {
            slip.status = 'converted';
          }
          app.state.temporarySlips = (app.state.temporarySlips || []).filter(s => String(s.id) !== String(slipId));

          // Save bill entry
          await app.db.add('bills', bill);

          // When converted to bill, completely delete the slip from temporary_slips store
          await app.db.delete('temporary_slips', slipId);
          if (typeof slipId === 'string' && !isNaN(parseInt(slipId, 10))) {
            try { await app.db.delete('temporary_slips', parseInt(slipId, 10)); } catch (_) {}
          } else if (typeof slipId === 'number') {
            try { await app.db.delete('temporary_slips', String(slipId)); } catch (_) {}
          }

          app.attachments.clearStagedFile('convert');
          app.ui.closeModal('dialog-slip-convert');
          const destLabel = expenseType === 'hospital' ? 'Hospital Bills' : 'Muhasib Bills';
          app.ui.showToast(`Temporary slip converted to ${destLabel}! Removed from Temp Slips.`);
          await app.syncState();
        } catch (err) {
          console.error(err);
          app.ui.showToast('Failed to convert temporary slip to bill.', 'error');
        }
      });

      // Form: Add/Edit Bill Directly
      document.getElementById('form-bill-add').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const editId = document.getElementById('edit-bill-id').value;
          let attachmentProps = {};
          
          if (app.attachments.activeSources['bill'] === 'gdrive') {
            const driveUrl = document.getElementById('bill-gdrive-url').value.trim();
            if (driveUrl) {
              attachmentProps = {
                attachmentUrl: driveUrl,
                fileName: 'Google Drive File',
                fileType: 'url/gdrive',
                uploadDate: new Date().toISOString(),
                pendingUpload: false,
                localAttachmentData: null
              };
            }
          } else {
            const staged = app.attachments.stagedBillAttachment;
            if (staged) {
              if (staged.removed) {
                attachmentProps = {
                  attachmentUrl: null,
                  fileName: null,
                  fileType: null,
                  uploadDate: null,
                  pendingUpload: false,
                  localAttachmentData: null
                };
              } else {
                attachmentProps = await app.attachments.processSave(staged);
              }
            }
          }

          const expenseType = document.getElementById('bill-exp-type').value;
          const bill = {
            date: document.getElementById('bill-date').value,
            billNumber: document.getElementById('bill-number').value,
            vendor: document.getElementById('bill-vendor').value,
            amount: parseFloat(document.getElementById('bill-amount').value),
            expenseType: expenseType,
            category: document.getElementById('bill-category').value,
            remarks: document.getElementById('bill-remarks').value,
            slipId: editId ? app.attachments.activeViewedRecord.slipId : null,
            status: editId ? app.attachments.activeViewedRecord.status : 'pending',
            transferId: editId ? app.attachments.activeViewedRecord.transferId : null,
            tokenNumber: editId
              ? (app.attachments.activeViewedRecord.tokenNumber || app.generateToken(expenseType === 'advance' ? 'advance_bill' : 'hospital_bill'))
              : (document.getElementById('bill-token')?.value || app.generateToken(expenseType === 'advance' ? 'advance_bill' : 'hospital_bill')),
            ...attachmentProps
          };

          if (editId) {
            bill.id = parseInt(editId);
            if (!attachmentProps.attachmentUrl && app.attachments.activeViewedRecord && app.attachments.activeViewedRecord.attachmentUrl && !app.attachments.stagedBillAttachment?.removed && app.attachments.activeSources['bill'] !== 'gdrive') {
              bill.attachmentUrl = app.attachments.activeViewedRecord.attachmentUrl;
              bill.fileName = app.attachments.activeViewedRecord.fileName;
              bill.fileType = app.attachments.activeViewedRecord.fileType;
              bill.uploadDate = app.attachments.activeViewedRecord.uploadDate;
              bill.pendingUpload = app.attachments.activeViewedRecord.pendingUpload || false;
              bill.localAttachmentData = app.attachments.activeViewedRecord.localAttachmentData || null;
            }
            await app.db.put('bills', bill.id, bill);
            app.ui.showToast('Direct bill updated successfully!');
          } else {
            await app.db.add('bills', bill);
            app.ui.showToast('Direct bill registered successfully!');
          }

          app.attachments.clearStagedFile('bill');
          app.ui.closeModal('dialog-bill-add');
          app.syncState();
        } catch (err) {
          console.error(err);
          app.ui.showToast('Failed to save direct bill.', 'error');
        }
      });

      // Form: Send To Accounts Department
      const formAccountsAdd = document.getElementById('form-accounts-add');
      if (formAccountsAdd) {
        formAccountsAdd.addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            const editId = document.getElementById('edit-accounts-id').value;
            const dateSent = document.getElementById('accounts-date').value;
            const billType = document.getElementById('accounts-bill-type').value;
            const amount = parseFloat(document.getElementById('accounts-amount').value);
            const referenceNo = document.getElementById('accounts-ref').value;
            const remarks = document.getElementById('accounts-remarks').value;

            if (isNaN(amount) || amount <= 0) {
              app.ui.showToast('Please enter a valid amount.', 'error');
              return;
            }

            let maxAvailable = billType === 'advance' ? app.state.advanceAvailableToSend : app.state.hospitalAvailableToSend;
            if (editId && app.attachments.activeViewedRecord && app.attachments.activeViewedRecord.billType === billType) {
              maxAvailable += app.attachments.activeViewedRecord.amount;
            }

            if (amount > maxAvailable) {
              app.ui.showToast(`Amount exceeds maximum available bills (₹${maxAvailable.toFixed(2)})`, 'error');
              return;
            }

            const batch = {
              dateSent,
              billType,
              amount,
              referenceNo,
              remarks
            };

            if (editId) {
              const batchId = parseInt(editId);
              batch.id = batchId;
              await app.db.put('accounts_register', batchId, batch);
              app.ui.showToast('Accounts Department entry updated.');
            } else {
              await app.db.add('accounts_register', batch);
              app.ui.showToast(`Successfully sent ₹${amount} to accounts.`);
            }

            app.ui.closeModal('dialog-accounts-add');
            app.syncState();
          } catch (err) {
            console.error(err);
            app.ui.showToast(`Failed to save accounts entry: ${err.message || err}`, 'error');
          }
        });
      }

      // Form: Add/Edit Transfer Record
      document.getElementById('form-transfer-add').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const editId = document.getElementById('edit-transfer-id').value;
          const type = document.getElementById('transfer-type').value;
          const amount = parseFloat(document.getElementById('transfer-amount').value);
          let limit = type === 'imprest' ? app.state.advanceAwaitingTransfer : app.state.hospitalAwaitingTransfer;

          if (editId && app.attachments.activeViewedRecord && app.attachments.activeViewedRecord.type === type) {
            limit += app.attachments.activeViewedRecord.amount;
          }

          // Double check validation before storing
          if (amount > limit) {
            app.ui.showToast('Transfer exceeds pending bills limit!', 'error');
            return;
          }

          const transfer = {
            date: document.getElementById('transfer-date').value,
            type: type, // imprest / amanat
            amount: amount,
            remarks: document.getElementById('transfer-remarks').value
          };

          let transferId;
          if (editId) {
            transferId = parseInt(editId);
            transfer.id = transferId;
            await app.db.put('transfers', transferId, transfer);
            app.ui.showToast('Verification transfer updated.');
          } else {
            transferId = await app.db.add('transfers', transfer);
            app.ui.showToast('Verification transfer recorded.');
          }
   
          app.ui.closeModal('dialog-transfer-add');
          app.syncState();
        } catch (err) {
          console.error(err);
          app.ui.showToast('Failed to save verification transfer.', 'error');
        }
      });

      // Form: Google Drive Folders Configuration
      const gdriveForm = document.getElementById('form-gdrive-folders');
      if (gdriveForm) {
        gdriveForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const hosp = document.getElementById('setting-gdrive-hosp-bills').value.trim();
          const adv = document.getElementById('setting-gdrive-adv-bills').value.trim();
          const slips = document.getElementById('setting-gdrive-slips').value.trim();
          const deposits = document.getElementById('setting-gdrive-deposits').value.trim();
          
          await app.db.setSetting('gdriveHospitalBills', hosp);
          await app.db.setSetting('gdriveAdvanceBills', adv);
          await app.db.setSetting('gdriveTempSlips', slips);
          await app.db.setSetting('gdriveMuhasibDeposits', deposits);
          
          app.ui.showToast('Google Drive folder links saved successfully!');
          app.syncState();
        });
      }

      // Handle JSON import trigger
      document.getElementById('import-file-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          app.db.importBackup(file);
        }
      });

      // Register report type change
      document.getElementById('report-select-type').addEventListener('change', () => {
        app.reports.renderReportView();
      });
      document.getElementById('report-date-start').addEventListener('input', () => app.reports.renderReportView());
      document.getElementById('report-date-end').addEventListener('input', () => app.reports.renderReportView());

      // Supabase credentials configuration submit
      document.getElementById('form-supabase-config').addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = document.getElementById('setting-supabase-url').value.trim();
        const key = document.getElementById('setting-supabase-key').value.trim();
        const bucket = document.getElementById('setting-supabase-bucket').value.trim();
        
        localStorage.setItem('noor_supabase_url', url);
        localStorage.setItem('noor_supabase_key', key);
        localStorage.setItem('noor_supabase_bucket', bucket);
        
        await app.db.setSetting('supabaseUrl', url);
        await app.db.setSetting('supabaseKey', key);
        await app.db.setSetting('supabaseBucket', bucket);
        
        await app.supabase.init();
        
        app.ui.showToast('Supabase configuration saved successfully!');
        
        // Trigger initial sync and queue processing
        if (navigator.onLine && url && key) {
          app.sync.setStatus('syncing', 'Syncing...');
          try {
            await app.sync.processQueue();
            await app.sync.pullAllData();
            app.ui.showToast('Initial sync completed successfully!');
            app.sync.setStatus('synced', 'Online & Synced');
            await app.syncState();
          } catch (err) {
            console.error('Initial sync failed:', err);
            app.ui.showToast('Initial sync failed. Check settings and connection.', 'error');
            app.sync.setStatus('error', 'Sync Error');
          }
        }
        
        // Trigger offline sync queue for attachments
        app.attachments.runSyncQueue();
      });

      // Bind drag and drop / mobile upload triggers for each modal context
      app.attachments.bindUploadEvents('slip');
      app.attachments.bindUploadEvents('convert');
      app.attachments.bindUploadEvents('bill');
      app.attachments.bindUploadEvents('deposit');

      // Bind Document Viewer modal actions
      const replaceBtn = document.getElementById('viewer-replace-btn');
      const replaceInput = document.getElementById('viewer-replace-input');
      const deleteBtn = document.getElementById('viewer-delete-btn');

      replaceBtn.addEventListener('click', () => {
        replaceInput.click();
      });

      replaceInput.addEventListener('change', async () => {
        if (!replaceInput.files.length) return;
        const file = replaceInput.files[0];
        
        const storeName = app.attachments.activeViewedStore;
        const record = app.attachments.activeViewedRecord;
        if (!storeName || !record) return;

        app.ui.showToast('Processing attachment replacement...', 'info');
        const optimized = await app.attachments.optimizeImage(file);
        
        const reader = new FileReader();
        reader.onload = async (e) => {
          const dataUrl = e.target.result;
          
          // Delete old storage asset
          await app.attachments.deleteRecordAttachment(record);
          
          const credentials = await app.attachments.getCredentials();
          const isOnline = navigator.onLine;
          
          let updatedProps = {};
          if (isOnline && credentials) {
            try {
              const ext = optimized.fileName.split('.').pop();
              const uniqueName = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${ext}`;
              const publicUrl = await app.attachments.uploadToSupabase(optimized.file, uniqueName, optimized.fileType, credentials);
              updatedProps = {
                attachmentUrl: publicUrl,
                fileName: optimized.fileName,
                fileType: optimized.fileType,
                uploadDate: new Date().toISOString(),
                pendingUpload: false,
                localAttachmentData: null
              };
            } catch (err) {
              console.error(err);
              app.ui.showToast('Supabase upload failed. Saving replacement locally.', 'warning');
              updatedProps = {
                attachmentUrl: 'local',
                fileName: optimized.fileName,
                fileType: optimized.fileType,
                uploadDate: new Date().toISOString(),
                pendingUpload: true,
                localAttachmentData: dataUrl
              };
            }
          } else {
            updatedProps = {
              attachmentUrl: 'local',
              fileName: optimized.fileName,
              fileType: optimized.fileType,
              uploadDate: new Date().toISOString(),
              pendingUpload: true,
              localAttachmentData: dataUrl
            };
          }
          
          const updatedRecord = { ...record, ...updatedProps };
          await app.db.put(storeName, record.id, updatedRecord);
          
          app.ui.showToast('Attachment replaced successfully!');
          app.ui.closeModal('dialog-viewer');
          app.syncState();
        };
        reader.readAsDataURL(optimized.file);
      });

      deleteBtn.addEventListener('click', () => {
        const storeName = app.attachments.activeViewedStore;
        const record = app.attachments.activeViewedRecord;
        if (!storeName || !record) return;

        app.ui.showConfirm(
          'Delete Attachment',
          'Are you sure you want to permanently delete this attachment? This action cannot be undone.',
          async () => {
            try {
              await app.attachments.deleteRecordAttachment(record);
              
              const updatedRecord = { ...record };
              updatedRecord.attachmentUrl = null;
              updatedRecord.fileName = null;
              updatedRecord.fileType = null;
              updatedRecord.uploadDate = null;
              updatedRecord.pendingUpload = false;
              updatedRecord.localAttachmentData = null;
              
              await app.db.put(storeName, record.id, updatedRecord);
              
              app.ui.showToast('Attachment deleted successfully!');
              app.ui.closeModal('dialog-viewer');
              app.syncState();
            } catch (err) {
              console.error(err);
              app.ui.showToast('Failed to delete attachment: ' + err.message, 'error');
            }
          }
        );
      });
    },

    switchTab(panelId) {

      // Update sidebar highlight
      const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
      navItems.forEach(item => {
        if (item.getAttribute('data-panel') === panelId) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });

      // Switch panels visibility
      const panels = document.querySelectorAll('.panel-container .panel');
      panels.forEach(panel => {
        if (panel.id === `panel-${panelId}`) {
          panel.classList.add('active');
        } else {
          panel.classList.remove('active');
        }
      });

      // Close mobile drawer if open
      document.getElementById('sidebar').classList.remove('mobile-open');
      const sbBackdrop = document.getElementById('sidebar-backdrop');
      if (sbBackdrop) sbBackdrop.classList.remove('active');

      // Close mobile submenus if open
      const ledgerSub = document.getElementById('mobile-ledger-submenu');
      if (ledgerSub) ledgerSub.classList.remove('active');
      const billsSub2 = document.getElementById('mobile-bills-submenu');
      if (billsSub2) billsSub2.classList.remove('active');
      const reportsSub = document.getElementById('mobile-reports-submenu');
      if (app.mobile.isMobile()) setTimeout(()=>app.mobile.renderAllMobileCards(),20);
      if (panelId === 'dashboard') {
        setTimeout(() => app.ui.renderCharts(), 20);
      }
      if (window.syncHeroUI) window.syncHeroUI();

      // Sync bottom nav active state
      const bottomNavMapping = {
        'dashboard': 'dashboard',
        'advance-cash': 'ledgers',
        'hospital-cash': 'ledgers',
        'hospital-deposits': 'ledgers',
        'temp-slips': 'ledgers',
        'advance-bills': 'bills',
        'accounts': 'ledgers',
        'transfers': 'ledgers',
        'bills': 'bills',
        'balance-sheet': 'reports',
        'reports': 'reports',
        'settings': 'settings'
      };
      const activeNav = bottomNavMapping[panelId] || 'dashboard';
      const bottomNavItems = document.querySelectorAll('.bottom-nav-item');
      bottomNavItems.forEach(item => {
        if (item.getAttribute('data-nav') === activeNav) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });

      // Update Top Title Bar
      const titles = {
        'dashboard': 'Overview Dashboard',
        'advance-cash': 'Muhasib Cash Ledger',
        'hospital-cash': 'Hospital Cash Collection Ledger',
        'hospital-deposits': 'Hospital Cash Deposits Ledger',
        'temp-slips': 'Temporary Expense Slips Register',
        'advance-bills': 'Muhasib Bills Register',
        'bills': 'Hospital Bills Register',
        'accounts': 'Accounts Department Register',
        'transfers': 'Accounts Verification & Transfers',
        'balance-sheet': 'Cash Position Balance Sheet',
        'reports': 'Financial Reports Centre',
        'settings': 'Data Backup & Settings'
      };
      
      document.getElementById('main-panel-title').innerText = titles[panelId] || 'Noor Hospital CMS';

      // Load specific view layouts
      if (panelId === 'reports') {
        app.reports.renderReportView();
      } else if (panelId === 'balance-sheet') {
        app.ui.renderBalanceSheet();
      }

      // Scroll to top on mobile (panel-container is the scroller, not window)
      try {
        var sc = document.querySelector('.panel-container');
        if (sc) sc.scrollTo({ top: 0, behavior: 'auto' });
        else window.scrollTo({ top: 0 });
      } catch (e) { window.scrollTo(0, 0); }
    },

    openBillModal(type){
      const sel=document.getElementById('bill-exp-type');
      if(sel && type) sel.value=type;
      if(sel) sel.dispatchEvent(new Event('change'));
      app.ui.openModal('dialog-bill-add');
    },
    openModal(dialogId) {
      const dialog = document.getElementById(dialogId);
      if (dialog) {
        // Set default dates to today
        const dateInputs = dialog.querySelectorAll('input[type="date"]');
        const todayStr = new Date().toISOString().split('T')[0]; // formats as YYYY-MM-DD local time
        dateInputs.forEach(input => {
          if (!input.value) {
            input.value = todayStr;
          }
        });

        // Initialize display values for specific dialogs
        if (dialogId === 'dialog-slip-add') {
          app.attachments.clearStagedFile('slip');
          // Auto-generate token for new slips
          const slipTokenEl = document.getElementById('slip-token');
          const slipBadge = document.getElementById('slip-token-badge');
          if (slipTokenEl && !document.getElementById('edit-slip-id').value) {
            const tok = app.generateToken('slip');
            slipTokenEl.value = tok;
            if (slipBadge) slipBadge.innerText = tok;
          } else if (slipBadge && slipTokenEl) {
            slipBadge.innerText = slipTokenEl.value || 'AUTO';
          }
        } else if (dialogId === 'dialog-bill-add') {
          app.attachments.clearStagedFile('bill');
          if (window.syncBillSegUI) setTimeout(() => window.syncBillSegUI(document.getElementById('bill-exp-type')?.value || 'advance'), 0);
          // Auto-generate token for new bills
          const billTokenEl = document.getElementById('bill-token');
          const billBadge = document.getElementById('bill-token-badge');
          if (billTokenEl && !document.getElementById('edit-bill-id').value) {
            const billExpType = document.getElementById('bill-exp-type')?.value || 'advance';
            const tok = app.generateToken(billExpType === 'advance' ? 'advance_bill' : 'hospital_bill');
            billTokenEl.value = tok;
            if (billBadge) billBadge.innerText = tok;
          } else if (billBadge && billTokenEl) {
            billBadge.innerText = billTokenEl.value || 'AUTO';
          }
        } else if (dialogId === 'dialog-deposit-add') {
          app.attachments.clearStagedFile('deposit');
        } else if (dialogId === 'dialog-settings') {
          document.getElementById('input-opening-advance').value = app.state.openingAdvanceCash;
          document.getElementById('input-opening-hospital').value = app.state.openingHospitalCash;
        } else if (dialogId === 'dialog-transfer-add') {
          // Trigger initial validation
          document.getElementById('transfer-amount').value = '';
          const type = document.getElementById('transfer-type').value;
          const limit = type === 'imprest' ? app.state.advanceBillsPending : app.state.hospitalBillsPending;
          document.getElementById('transfer-pending-limit-display').innerText = app.ui.formatCurrency(limit);
          document.getElementById('transfer-amount-error-help').classList.add('hidden');
          document.querySelector('#form-transfer-add button[type="submit"]').disabled = false;
        }

        dialog.showModal();
      }
    },

    /**
     * Close modal dialog.
     */
    closeModal(dialogId) {
      const dialog = document.getElementById(dialogId);
      if (dialog) {
        dialog.close();
        // Reset form inside dialog if it exists
        const form = dialog.querySelector('form');
        if (form) form.reset();
        
        // Reset staged files & edit states
        if (dialogId === 'dialog-advance-add') {
          document.getElementById('edit-advance-id').value = '';
          document.getElementById('dialog-advance-title').innerText = 'Add Muhasib Cash Entry';
          app.attachments.clearStagedFile('slip');
        } else if (dialogId === 'dialog-hospital-add') {
          document.getElementById('edit-hospital-id').value = '';
          document.getElementById('dialog-hospital-title').innerText = 'Add Hospital Cash Collection';
        } else if (dialogId === 'dialog-deposit-add') {
          document.getElementById('edit-deposit-id').value = '';
          document.getElementById('dialog-deposit-title').innerText = 'Add Hospital Cash Deposit';
          app.attachments.clearStagedFile('deposit');
        } else if (dialogId === 'dialog-slip-add') {
          document.getElementById('edit-slip-id').value = '';
          document.getElementById('dialog-slip-title').innerText = 'Add Temporary Slip';
          app.attachments.clearStagedFile('slip');
          const slipTokenEl = document.getElementById('slip-token');
          if (slipTokenEl) slipTokenEl.value = '';
          const slipBadge = document.getElementById('slip-token-badge');
          if (slipBadge) slipBadge.innerText = 'AUTO';
        } else if (dialogId === 'dialog-bill-add') {
          document.getElementById('edit-bill-id').value = '';
          document.getElementById('dialog-bill-title').innerText = 'Add Direct Bill';
          app.attachments.clearStagedFile('bill');
          if (window.syncBillSegUI) window.syncBillSegUI('advance');
          const billTokenEl = document.getElementById('bill-token');
          if (billTokenEl) billTokenEl.value = '';
          const billBadge = document.getElementById('bill-token-badge');
          if (billBadge) billBadge.innerText = 'AUTO';
        } else if (dialogId === 'dialog-transfer-add') {
          document.getElementById('edit-transfer-id').value = '';
          document.getElementById('dialog-transfer-title').innerText = 'Record Verification Transfer';
        } else if (dialogId === 'dialog-accounts-add') {
          document.getElementById('edit-accounts-id').value = '';
          document.getElementById('dialog-accounts-title').innerText = 'Send To Accounts Department';
          document.getElementById('btn-accounts-save').innerText = 'Send to Accounts';
        } else if (dialogId === 'dialog-slip-convert') {
          app.attachments.clearStagedFile('convert');
        }
      }
    },

    async initiateEdit(storeName, id) {
      try {
        const records = await app.db.getAll(storeName);
        const record = records.find(r => r.id === id);
        if (!record) {
          app.ui.showToast('Record not found.', 'error');
          return;
        }

        app.attachments.activeViewedStore = storeName;
        app.attachments.activeViewedRecord = record;

        if (storeName === 'advance_cash') {
          document.getElementById('edit-advance-id').value = id;
          document.getElementById('dialog-advance-title').innerText = 'Edit Muhasib Cash Entry';
          document.getElementById('adv-date').value = record.date;
          document.getElementById('adv-amount').value = record.amount;
          document.getElementById('adv-remarks').value = record.remarks;
          app.ui.openModal('dialog-advance-add');

        } else if (storeName === 'hospital_cash') {
          document.getElementById('edit-hospital-id').value = id;
          document.getElementById('dialog-hospital-title').innerText = 'Edit Hospital Cash Collection';
          document.getElementById('hosp-date').value = record.date;
          document.getElementById('hosp-source').value = record.source;
          document.getElementById('hosp-amount').value = record.amount;
          document.getElementById('hosp-remarks').value = record.remarks || '';
          app.ui.openModal('dialog-hospital-add');

        } else if (storeName === 'hospital_deposits') {
          document.getElementById('edit-deposit-id').value = id;
          document.getElementById('dialog-deposit-title').innerText = 'Edit Hospital Cash Deposit';
          document.getElementById('dep-date').value = record.date;
          document.getElementById('dep-receipt').value = record.receiptNumber;
          document.getElementById('dep-amount').value = record.amount;
          document.getElementById('dep-remarks').value = record.remarks || '';
          
          app.ui.setupEditAttachment('deposit', record);
          app.ui.openModal('dialog-deposit-add');

        } else if (storeName === 'temporary_slips') {
          document.getElementById('edit-slip-id').value = id;
          document.getElementById('dialog-slip-title').innerText = 'Edit Temporary Slip';
          document.getElementById('slip-date').value = record.date;
          document.getElementById('slip-vendor').value = record.vendor;
          document.getElementById('slip-amount').value = record.amount;
          document.getElementById('slip-exp-type').value = record.expenseType;
          document.getElementById('slip-remarks').value = record.remarks || '';
          const slipTokenEl = document.getElementById('slip-token');
          if (slipTokenEl) slipTokenEl.value = record.tokenNumber || '';
          const slipBadge = document.getElementById('slip-token-badge');
          if (slipBadge) slipBadge.innerText = record.tokenNumber || 'AUTO';
          
          app.ui.setupEditAttachment('slip', record);
          app.ui.openModal('dialog-slip-add');

        } else if (storeName === 'bills') {
          document.getElementById('edit-bill-id').value = id;
          document.getElementById('dialog-bill-title').innerText = 'Edit Direct Bill';
          document.getElementById('bill-date').value = record.date;
          document.getElementById('bill-number').value = record.billNumber;
          document.getElementById('bill-vendor').value = record.vendor;
          document.getElementById('bill-amount').value = record.amount;
          document.getElementById('bill-exp-type').value = record.expenseType;
          if (window.syncBillSegUI) window.syncBillSegUI(record.expenseType);
          document.getElementById('bill-category').value = record.category;
          document.getElementById('bill-remarks').value = record.remarks || '';
          const billTokenEl = document.getElementById('bill-token');
          if (billTokenEl) billTokenEl.value = record.tokenNumber || '';
          const billBadge = document.getElementById('bill-token-badge');
          if (billBadge) billBadge.innerText = record.tokenNumber || 'AUTO';
          
          app.ui.setupEditAttachment('bill', record);
          app.ui.openModal('dialog-bill-add');

        } else if (storeName === 'transfers') {
          document.getElementById('edit-transfer-id').value = id;
          document.getElementById('dialog-transfer-title').innerText = 'Edit Verification Transfer';
          document.getElementById('transfer-date').value = record.date;
          document.getElementById('transfer-type').value = record.type;
          document.getElementById('transfer-amount').value = record.amount;
          document.getElementById('transfer-remarks').value = record.remarks;
          
          const limit = record.type === 'imprest' ? app.state.advanceBillsPending : app.state.hospitalBillsPending;
          const adjustedLimit = limit + record.amount;
          document.getElementById('transfer-pending-limit-display').innerText = app.ui.formatCurrency(adjustedLimit);
          
          app.ui.openModal('dialog-transfer-add');
        } else if (storeName === 'accounts_register') {
          document.getElementById('edit-accounts-id').value = id;
          document.getElementById('dialog-accounts-title').innerText = 'Edit Sent To Accounts Batch';
          document.getElementById('btn-accounts-save').innerText = 'Save Changes';
          document.getElementById('accounts-date').value = record.dateSent;
          document.getElementById('accounts-bill-type').value = record.billType;
          document.getElementById('accounts-amount').value = record.amount;
          document.getElementById('accounts-ref').value = record.referenceNo || '';
          document.getElementById('accounts-remarks').value = record.remarks || '';
          
          const limit = record.billType === 'advance' ? app.state.advanceAvailableToSend : app.state.hospitalAvailableToSend;
          const adjustedLimit = limit + record.amount;
          document.getElementById('accounts-pending-amount').innerText = app.ui.formatCurrency(adjustedLimit);
          document.getElementById('accounts-amount').max = adjustedLimit;
          document.getElementById('btn-accounts-save').disabled = false;
          
          app.ui.openModal('dialog-accounts-add');
        }
      } catch (err) {
        console.error(err);
        app.ui.showToast('Failed to load record for editing.', 'error');
      }
    },

    setupEditAttachment(prefix, record) {
      app.attachments.clearStagedFile(prefix);
      
      const gdriveUrlInput = document.getElementById(`${prefix}-gdrive-url`);
      const previewZone = document.getElementById(`${prefix}-upload-preview`);
      const uploadZone = document.getElementById(`${prefix}-upload-zone`);
      
      if (record.attachmentUrl) {
        if (record.fileType === 'url/gdrive' || record.attachmentUrl.includes('drive.google.com')) {
          app.attachments.setUploadSource(prefix, 'gdrive');
          if (gdriveUrlInput) gdriveUrlInput.value = record.attachmentUrl;
        } else {
          app.attachments.setUploadSource(prefix, 'supabase');
          if (uploadZone) uploadZone.classList.add('hidden');
          if (previewZone) {
            previewZone.classList.remove('hidden');
            let mediaHtml = '';
            if (record.fileType && record.fileType.startsWith('image/')) {
              const url = (record.pendingUpload || record.attachmentUrl === 'local') ? record.localAttachmentData : record.attachmentUrl;
              mediaHtml = `<img src="${url}" alt="Preview" class="preview-thumbnail">`;
            } else {
              mediaHtml = `
                <div class="preview-file-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
                </div>
              `;
            }
            previewZone.innerHTML = `
              <div class="preview-info">
                ${mediaHtml}
                <div class="preview-details">
                  <span class="preview-name">${record.fileName || 'Attachment'}</span>
                  <div class="preview-size-status">
                    <span class="preview-status synced">${record.pendingUpload ? 'Local Cache' : 'Synced'}</span>
                  </div>
                </div>
              </div>
              <div class="preview-actions">
                <button type="button" class="btn btn-secondary btn-sm" onclick="app.attachments.triggerReplace('${prefix}')">Replace</button>
                <button type="button" class="btn btn-secondary btn-sm text-error" onclick="app.attachments.clearStagedFile('${prefix}')">Remove</button>
              </div>
            `;
          }
        }
      } else {
        app.attachments.setUploadSource(prefix, 'supabase');
      }
    },

    /**
     * Set Application Theme (Light / Dark).
     */
    updateDriveFolderUI() {
      const updateLink = (id, url, label) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (url) el.href = url;
        if (label) {
          const span = el.querySelector('span');
          if (span) span.textContent = label;
        }
      };
      updateLink('slip-gdrive-folder-link', app.state.gdriveTempSlips);
      const billExpType = document.getElementById('bill-exp-type')?.value;
      updateLink(
        'bill-gdrive-folder-link',
        billExpType === 'hospital' ? app.state.gdriveHospitalBills : app.state.gdriveAdvanceBills,
        billExpType === 'hospital' ? 'Open Hospital Bills Folder' : 'Open Advance Bills Folder'
      );
      const convertExpType = document.getElementById('convert-slip-exptype')?.value;
      updateLink(
        'convert-gdrive-folder-link',
        convertExpType === 'hospital' ? app.state.gdriveHospitalBills : app.state.gdriveAdvanceBills,
        convertExpType === 'hospital' ? 'Open Hospital Bills Folder' : 'Open Advance Bills Folder'
      );
      updateLink('deposit-gdrive-folder-link', app.state.gdriveMuhasibDeposits);
    },

    setTheme(themeName, saveSetting = true) {
      document.documentElement.setAttribute('data-theme', themeName);
      app.state.theme = themeName;
      if (saveSetting) {
        app.db.setSetting('theme', themeName);
      }

      const lightBtn = document.getElementById('theme-light-btn');
      const darkBtn = document.getElementById('theme-dark-btn');
      const mobThemeBtn = document.getElementById('mobile-theme-btn');

      if (themeName === 'light') {
        if (lightBtn) lightBtn.classList.add('active');
        if (darkBtn) darkBtn.classList.remove('active');
        if (mobThemeBtn) {
          const sun = mobThemeBtn.querySelector('.theme-icon-sun');
          const moon = mobThemeBtn.querySelector('.theme-icon-moon');
          if (sun) sun.style.display = 'none';
          if (moon) moon.style.display = 'block';
        }
      } else {
        if (lightBtn) lightBtn.classList.remove('active');
        if (darkBtn) darkBtn.classList.add('active');
        if (mobThemeBtn) {
          const sun = mobThemeBtn.querySelector('.theme-icon-sun');
          const moon = mobThemeBtn.querySelector('.theme-icon-moon');
          if (sun) sun.style.display = 'block';
          if (moon) moon.style.display = 'none';
        }
      }

      // Redraw charts to update text/border colors dynamically
      if (typeof app.ui.renderCharts === 'function') {
        app.ui.renderCharts();
      }
    },

    /**
     * Formats floating number to Indian Rupees format (e.g. ₹4,500.00).
     */
    formatCurrency(val) {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR'
      }).format(val);
    },

    /**
     * Formats date string to standard readable format.
     */
    formatDate(val) {
      if (!val) return '-';
      const d = new Date(val);
      if (isNaN(d.getTime())) return val;
      const dd = String(d.getDate()).padStart(2,'0');
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const yyyy = d.getFullYear();
      return `${dd}-${mm}-${yyyy}`;
    },

    /**
     * Safely escapes HTML special characters to prevent XSS injection or rendering bugs.
     */
    escapeHTML(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    filterTable(tableId, query) {
      const map={'table-advance':'advance','table-hospital':'hospital','table-deposits':'deposits','table-slips':'slips','table-bills':'bills','table-accounts':'accounts','table-transfers':'transfers'};
      const page=map[tableId];
      if(page) app.ui.applyFilter(page,{search:query});
      else{
        const table=document.getElementById(tableId); if(!table) return;
        const rows=table.querySelectorAll('tbody tr'); const q=(query||'').toLowerCase();
        rows.forEach(row=>{ const t=row.innerText.toLowerCase(); row.classList.toggle('hidden', !t.includes(q)); });
      }
    },

    /**
     * Renders Toast Notifications.
     */
    showToast(message, type = 'success') {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      
      const successIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
      const errorIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/></svg>`;
      const icon = type === 'success' ? successIcon : errorIcon;

      toast.innerHTML = `
        <div class="toast-icon">${icon}</div>
        <div class="toast-message">${message}</div>
      `;
      
      container.appendChild(toast);
      
      // Auto dismiss
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(8px) scale(0.95)';
        toast.style.transition = 'all 0.2s ease';
        setTimeout(() => toast.remove(), 200);
      }, 3000);
    },

    /**
     * Displays a custom confirmation overlay modal.
     */
    showConfirm(title, message, onYes) {
      const dialog = document.getElementById('dialog-confirm');
      document.getElementById('confirm-title').innerText = title;
      document.getElementById('confirm-message').innerText = message;
      
      const yesBtn = document.getElementById('confirm-yes-btn');
      const cancelBtn = document.getElementById('confirm-cancel-btn');

      const cleanup = () => {
        dialog.close();
        yesBtn.replaceWith(yesBtn.cloneNode(true));
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
      };

      document.getElementById('confirm-cancel-btn').addEventListener('click', cleanup);
      document.getElementById('confirm-yes-btn').addEventListener('click', () => {
        onYes();
        cleanup();
      });

      dialog.showModal();
    },

    /**
     * UI conversion triggers.
     */
    initiateSlipConversion(id, vendor, amount, expenseType) {
      document.getElementById('convert-slip-id').value = id;
      const targetExp = 'hospital'; // Converted slips go to Hospital Bills by default
      if (document.getElementById('convert-slip-exptype')) {
        document.getElementById('convert-slip-exptype').value = targetExp;
      }
      if (document.getElementById('convert-bill-exptype')) {
        document.getElementById('convert-bill-exptype').value = targetExp;
      }
      const convertTokenEl = document.getElementById('convert-bill-token');
      if (convertTokenEl) {
        convertTokenEl.value = app.generateToken(targetExp === 'advance' ? 'advance_bill' : 'hospital_bill');
      }
      document.getElementById('convert-slip-vendor-display').innerText = vendor;
      document.getElementById('convert-slip-amount-display').innerText = app.ui.formatCurrency(amount);
      
      // Pre-populate final bill inputs
      document.getElementById('convert-bill-amount').value = amount;
      document.getElementById('convert-bill-number').value = '';
      if (document.getElementById('convert-bill-date')) {
        document.getElementById('convert-bill-date').value = new Date().toISOString().split('T')[0];
      }
      
      // Clear staged convert attachment
      app.attachments.stagedConvertAttachment = null;
      
      // Pre-populate existing attachment if present
      const slip = app.state.temporarySlips.find(s => s.id === id);
      const convertPreview = document.getElementById('convert-upload-preview');
      const convertZone = document.getElementById('convert-upload-zone');
      
      if (slip && slip.attachmentUrl) {
        convertZone.classList.add('hidden');
        convertPreview.classList.remove('hidden');
        
        let mediaHtml = '';
        if (slip.fileType && slip.fileType.startsWith('image/')) {
          const url = (slip.pendingUpload || slip.attachmentUrl === 'local') ? slip.localAttachmentData : slip.attachmentUrl;
          mediaHtml = `<img src="${url}" alt="Preview" class="preview-thumbnail">`;
        } else {
          mediaHtml = `
            <div class="preview-file-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
            </div>
          `;
        }
        
        convertPreview.innerHTML = `
          <div class="preview-info">
            ${mediaHtml}
            <div class="preview-details">
              <span class="preview-name">${slip.fileName || 'Original Attachment'}</span>
              <div class="preview-size-status">
                <span class="preview-status synced">Carried from Slip</span>
              </div>
            </div>
          </div>
          <div class="preview-actions">
            <button type="button" class="btn btn-secondary btn-sm" onclick="app.attachments.triggerReplace('convert')">Replace</button>
            <button type="button" class="btn btn-secondary btn-sm text-error" onclick="app.attachments.clearStagedFile('convert')">Remove</button>
          </div>
        `;
      } else {
        convertZone.classList.remove('hidden');
        convertPreview.classList.add('hidden');
        convertPreview.innerHTML = '';
      }
      
      app.ui.openModal('dialog-slip-convert');
    },

    /**
     * Renders all data list tables, metric text, and cards.
     */
    renderAll() {
      const setSafeText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
      };
      const setSafeVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
      };

      // 1. Dashboard summary cards values
      setSafeText('dash-advance-cash', app.ui.formatCurrency(app.state.advanceCashAvailable));
      setSafeText('dash-hospital-cash', app.ui.formatCurrency(app.state.hospitalCashAvailable));
      setSafeText('dash-total-cash-me', app.ui.formatCurrency(app.state.totalCashWithMe));
      
      setSafeText('dash-total-advance-received', app.ui.formatCurrency(app.state.totalAdvanceCashReceived));
      setSafeText('dash-total-hospital-collected', app.ui.formatCurrency(app.state.totalHospitalCashCollected));
      
      setSafeText('dash-advance-bills-pending', app.ui.formatCurrency(app.state.advanceBillsPending));
      setSafeText('dash-hospital-bills-pending', app.ui.formatCurrency(app.state.hospitalBillsPending));
      setSafeText('dash-total-pending-bills', app.ui.formatCurrency(app.state.totalPendingBills));

      setSafeText('dash-amanat-received', app.ui.formatCurrency(app.state.amanatReceived));
      setSafeText('dash-imprest-received', app.ui.formatCurrency(app.state.imprestReceived));
      setSafeText('dash-total-hospital-deposited', app.ui.formatCurrency(app.state.totalHospitalDeposited));
      setSafeText('dash-total-transferred', app.ui.formatCurrency(app.state.totalTransferred));
      setSafeText('dash-total-sent-to-accounts', app.ui.formatCurrency(app.state.totalSentToAccounts));
      setSafeText('dash-awaiting-transfer', app.ui.formatCurrency(app.state.totalAwaitingTransfer));
      
      setSafeText('dash-temp-slips-total', app.ui.formatCurrency(app.state.temporarySlipsPendingAmount));
      
      const slipBadgeVal = `${app.state.temporarySlipsPending} slip${app.state.temporarySlipsPending !== 1 ? 's' : ''}`;
      setSafeText('dash-temp-slips-badge', slipBadgeVal);

      setSafeText('sidebar-temp-slips-badge', app.state.temporarySlipsPending);
      setSafeText('sidebar-bills-badge', app.state.bills.filter(b => b.expenseType==='hospital').length);
      setSafeText('sidebar-advance-bills-badge', app.state.bills.filter(b => b.expenseType==='advance').length);
      const bb=document.getElementById('bottom-nav-bills-badge'); if(bb) bb.textContent=app.state.bills.filter(b=>b.expenseType==='hospital').length;
      const ab=document.getElementById('bottom-nav-advance-bills-badge'); if(ab) ab.textContent=app.state.bills.filter(b=>b.expenseType==='advance').length;

      // Position math block updates
      setSafeText('math-total-cash', app.ui.formatCurrency(app.state.totalCashWithMe));
      setSafeText('math-adv-cash', app.ui.formatCurrency(app.state.advanceCashAvailable));
      setSafeText('math-hosp-cash', app.ui.formatCurrency(app.state.hospitalCashAvailable));

      setSafeText('math-total-pending', app.ui.formatCurrency(app.state.totalPendingBills));
      setSafeText('math-adv-pending', app.ui.formatCurrency(app.state.advanceBillsPending));
      setSafeText('math-hosp-pending', app.ui.formatCurrency(app.state.hospitalBillsPending));

      setSafeText('math-total-transferred', app.ui.formatCurrency(app.state.totalTransferred));
      setSafeText('math-total-transferred-sub', app.ui.formatCurrency(app.state.totalTransferred));
      setSafeText('math-total-awaiting', app.ui.formatCurrency(app.state.totalAwaitingTransfer));
      setSafeText('math-total-sent-accounts', app.ui.formatCurrency(app.state.totalSentToAccounts));
      setSafeText('math-amanat', app.ui.formatCurrency(app.state.amanatReceived));
      setSafeText('math-imprest', app.ui.formatCurrency(app.state.imprestReceived));

      // Startup configuration displays
      setSafeText('opening-adv-val', app.ui.formatCurrency(app.state.openingAdvanceCash));
      setSafeText('opening-hosp-val', app.ui.formatCurrency(app.state.openingHospitalCash));
      
      // Update configuration panel fields values
      setSafeVal('setting-opening-advance', app.state.openingAdvanceCash);
      setSafeVal('setting-opening-hospital', app.state.openingHospitalCash);
      setSafeVal('setting-gdrive-hosp-bills', app.state.gdriveHospitalBills || '');
      setSafeVal('setting-gdrive-adv-bills', app.state.gdriveAdvanceBills || '');
      setSafeVal('setting-gdrive-slips', app.state.gdriveTempSlips || '');
      setSafeVal('setting-gdrive-deposits', app.state.gdriveMuhasibDeposits || '');

      app.ui.renderAdvanceTable();
      app.ui.renderHospitalTable();
      app.ui.renderDepositsTable();
      app.ui.renderSlipsTable();
      app.ui.renderAdvanceBillsTable();
      app.ui.renderBillsTable();
      app.ui.renderAccountsTable();
      app.ui.renderTransfersTable();

      // 3. Render Balance Sheet Panel
      app.ui.renderBalanceSheet();

      // 4. Render Visual Charts
      app.ui.renderCharts();

      // 5. Render Mobile Card Views
      app.mobile.renderAllMobileCards();

      // 6. Sync Hero UI metrics
      if (window.syncHeroUI) window.syncHeroUI();
      window.dispatchEvent(new CustomEvent('app:rendered'));
    },

    renderAdvanceTable() {
      const list = document.getElementById('list-advance');
      if(!list) return;
      const filtered = app.ui.getFiltered(app.state.advanceCashEntries,'advance');
      const total = filtered.reduce((s,e)=>s+e.amount,0);
      const totEl=document.getElementById('total-advance'); if(totEl) totEl.textContent=`Total: ${app.ui.formatCurrency(total)} (${filtered.length})`;
      if(!filtered.length){
        const f=app.ui.filters.advance; const isFiltered=f.search||f.from||f.to;
        list.innerHTML=`<tr><td colspan="5" class="text-center text-muted">${isFiltered?'No records match filter.':'No cash entry records found.'}</td></tr>`;
        return;
      }
      const sorted=[...filtered].sort((a,b)=> new Date(a.date)-new Date(b.date));
      let running=app.state.openingAdvanceCash;
      const sortMode=app.ui.filters.advance.sort;
      const displayList = (sortMode==='amount_desc'||sortMode==='amount_asc'||sortMode.startsWith('alpha')) ? filtered : sorted;
      if(!sortMode.startsWith('alpha') && sortMode!=='amount_desc' && sortMode!=='amount_asc'){
        running=app.state.openingAdvanceCash;
        displayList.forEach(e=>{ running+=e.amount; e._run=running; });
        if(sortMode==='date_desc') displayList.reverse();
      }
      list.innerHTML = displayList.map(entry => {
        const run = entry._run!==undefined ? entry._run : '';
        const runTxt = run!=='' ? app.ui.formatCurrency(run) : '-';
        return `
          <tr>
            <td class="num-val">${app.ui.formatDate(entry.date)}</td>
            <td class="num-val text-bold text-success">+${app.ui.formatCurrency(entry.amount)}</td>
            <td>${app.ui.escapeHTML(entry.remarks||'-')}</td>
            <td class="num-val text-bold">${runTxt}</td>
            <td class="text-center">
              <div class="flex gap-2 justify-center">
                <button class="btn btn-secondary btn-sm btn-edit-action" onclick="app.ui.initiateEdit('advance_cash', ${entry.id})">Edit</button>
                <button class="btn btn-secondary btn-sm text-error" onclick="app.db.promptDelete('advance_cash', ${entry.id})">Delete</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    },

    renderHospitalTable() {
      const list = document.getElementById('list-hospital');
      if(!list) return;
      const filtered = app.ui.getFiltered(app.state.hospitalCashEntries,'hospital');
      const total = filtered.reduce((s,e)=>s+e.amount,0);
      const totEl=document.getElementById('total-hospital'); if(totEl) totEl.textContent=`Total: ${app.ui.formatCurrency(total)} (${filtered.length})`;
      if(!filtered.length){
        const f=app.ui.filters.hospital; const isF=f.search||f.from||f.to;
        list.innerHTML=`<tr><td colspan="6" class="text-center text-muted">${isF?'No records match filter.':'No collections recorded yet.'}</td></tr>`;
        return;
      }
      const sorted=[...filtered].sort((a,b)=> new Date(a.date)-new Date(b.date));
      let running=app.state.openingHospitalCash;
      const sortMode=app.ui.filters.hospital.sort;
      const displayList = (sortMode==='amount_desc'||sortMode==='amount_asc'||sortMode.startsWith('alpha')) ? filtered : sorted;
      if(!sortMode.startsWith('alpha') && sortMode!=='amount_desc' && sortMode!=='amount_asc'){
        running=app.state.openingHospitalCash;
        displayList.forEach(e=>{ running+=e.amount; e._run=running; });
        if(sortMode==='date_desc') displayList.reverse();
      }
      list.innerHTML = displayList.map(entry => {
        const run = entry._run!==undefined ? entry._run : '-';
        const runTxt = run!=='-'?app.ui.formatCurrency(run):'-';
        return `
          <tr>
            <td class="num-val">${app.ui.formatDate(entry.date)}</td>
            <td><span class="source-tag">${app.ui.escapeHTML(entry.source)}</span></td>
            <td class="num-val text-bold text-success">+${app.ui.formatCurrency(entry.amount)}</td>
            <td>${app.ui.escapeHTML(entry.remarks || '-')}</td>
            <td class="num-val text-bold">${runTxt}</td>
            <td class="text-center"><div class="flex gap-2 justify-center"><button class="btn btn-secondary btn-sm btn-edit-action" onclick="app.ui.initiateEdit('hospital_cash', ${entry.id})">Edit</button><button class="btn btn-secondary btn-sm text-error" onclick="app.db.promptDelete('hospital_cash', ${entry.id})">Delete</button></div></td>
          </tr>
        `;
      }).join('');
    },

    renderDepositsTable() {
      const list = document.getElementById('list-deposits');
      if (!list) return;
      const filtered = app.ui.getFiltered(app.state.hospitalDeposits,'deposits');
      const total = filtered.reduce((s,e)=>s+e.amount,0);
      const totEl=document.getElementById('total-deposits'); if(totEl) totEl.textContent=`Total: ${app.ui.formatCurrency(total)} (${filtered.length})`;
      if(!filtered.length){
        const f=app.ui.filters.deposits; const isF=f.search||f.from||f.to;
        list.innerHTML=`<tr><td colspan="6" class="text-center text-muted">${isF?'No records match filter.':'No deposits to Muhasib recorded.'}</td></tr>`;
        return;
      }
      list.innerHTML = filtered.map(deposit => {
        let attachmentHtml = '-';
        if (deposit.attachmentUrl) {
          const syncClass = deposit.pendingUpload ? 'pending-sync' : '';
          const label = deposit.pendingUpload ? '⏳ Syncing' : (deposit.fileType === 'application/pdf' ? '📄 PDF Attached' : '📷 Image Attached');
          attachmentHtml = `<span class="attachment-badge ${syncClass}" onclick="app.attachments.viewAttachment('hospital_deposits', ${deposit.id})">${label}</span>`;
        }
        return `
          <tr>
            <td class="num-val">${app.ui.escapeHTML(deposit.date)}</td>
            <td class="num-val text-bold">${app.ui.escapeHTML(deposit.receiptNumber)}</td>
            <td class="num-val text-bold text-error">-${app.ui.formatCurrency(deposit.amount)}</td>
            <td>${attachmentHtml}</td>
            <td>${app.ui.escapeHTML(deposit.remarks || '-')}</td>
            <td class="text-center"><div class="flex gap-2 justify-center"><button class="btn btn-secondary btn-sm btn-edit-action" onclick="app.ui.initiateEdit('hospital_deposits', ${deposit.id})">Edit</button><button class="btn btn-secondary btn-sm text-error" onclick="app.db.promptDelete('hospital_deposits', ${deposit.id})">Delete</button></div></td>
          </tr>
        `;
      }).join('');
    },

    renderSlipsTable() {
      const list = document.getElementById('list-slips');
      if(!list) return;
      // Filter out converted slips so they are removed from the temporary slips list
      const activeSlips = app.getActiveTemporarySlips();
      const filtered = app.ui.getFiltered(activeSlips,'slips');
      const total = filtered.reduce((s,e)=>s+e.amount,0);
      const totEl=document.getElementById('total-slips'); if(totEl) totEl.textContent=`Total: ${app.ui.formatCurrency(total)} (${filtered.length})`;
      if(!filtered.length){
        const f=app.ui.filters.slips; const isF=f.search||f.from||f.to;
        list.innerHTML=`<tr><td colspan="9" class="text-center text-muted">${isF?'No records match filter.':'No pending temporary slips registered.'}</td></tr>`;
        return;
      }
      list.innerHTML = filtered.map(slip => {
        const statusClass = slip.status === 'pending' ? 'pending' : 'converted';
        const typeLabel = slip.expenseType === 'advance' ? 'Muhasib Cash' : 'Hospital Cash';
        
        let actionBtn = '';
        if (slip.status === 'pending') {
          actionBtn = `
            <div class="flex gap-2 justify-center">
              <button class="btn btn-secondary btn-sm btn-edit-action" onclick="app.ui.initiateEdit('temporary_slips', ${slip.id})">
                Edit
              </button>
              <button class="btn btn-secondary btn-sm" onclick="app.ui.initiateSlipConversion(${slip.id}, '${slip.vendor.replace(/'/g, "\\'")}', ${slip.amount}, '${slip.expenseType}')">
                Convert
              </button>
              <button class="btn btn-secondary btn-sm text-error" onclick="app.db.promptDelete('temporary_slips', ${slip.id})">
                Delete
              </button>
            </div>
          `;
        } else {
          actionBtn = `
            <div class="flex gap-2 justify-center items-center">
              <span class="text-muted text-sm">Converted</span>
              <button class="btn btn-secondary btn-sm btn-edit-action" onclick="app.ui.initiateEdit('temporary_slips', ${slip.id})">
                Edit
              </button>
              <button class="btn btn-secondary btn-sm text-error" onclick="app.db.promptDelete('temporary_slips', ${slip.id})">
                Delete
              </button>
            </div>
          `;
        }
 
        let attachmentHtml = '-';
        if (slip.attachmentUrl) {
          const syncClass = slip.pendingUpload ? 'pending-sync' : '';
          const label = slip.pendingUpload ? '⏳ Syncing' : (slip.fileType === 'application/pdf' ? '📄 PDF Attached' : '📷 Image Attached');
          attachmentHtml = `<span class="attachment-badge ${syncClass}" onclick="app.attachments.viewAttachment('temporary_slips', ${slip.id})">${label}</span>`;
        }

        return `
          <tr>
            <td class="num-val">${app.ui.formatDate(slip.date)}</td>
            <td><span class="source-tag font-mono" style="font-size:0.72rem;letter-spacing:0.5px">${slip.tokenNumber || '-'}</span></td>
            <td class="text-bold">${slip.vendor}</td>
            <td class="num-val text-bold text-error">-${app.ui.formatCurrency(slip.amount)}</td>
            <td><span class="source-tag">${typeLabel}</span></td>
            <td><span class="status-pill ${statusClass}">${slip.status}</span></td>
            <td>${attachmentHtml}</td>
            <td>${slip.remarks || '-'}</td>
            <td class="text-center">${actionBtn}</td>
          </tr>
        `;
      }).join('');
    },

    renderAdvanceBillsTable() {
      const list=document.getElementById('list-advance-bills');
      if(!list) return;
      const allFiltered=app.ui.getFiltered(app.state.bills,'advance-bills');
      let filtered=allFiltered.filter(b=>String(b.expenseType||'').toLowerCase().trim()==='advance');
      if(!filtered.length && app.state.bills.length){
        const raw=app.state.bills.filter(b=>String(b.expenseType||'').toLowerCase().trim()==='advance');
        if(raw.length && !app.ui.filters['advance-bills'].search && !app.ui.filters['advance-bills'].from && !app.ui.filters['advance-bills'].to) filtered=raw;
        else if(raw.length && !filtered.length) filtered=raw;
      }
      const total=filtered.reduce((s,e)=>s+e.amount,0);
      const totEl=document.getElementById('total-advance-bills'); if(totEl) totEl.textContent=`Total: ${app.ui.formatCurrency(total)} (${filtered.length})`;
      if(!filtered.length){
        const f=app.ui.filters['advance-bills']; const isF=f.search||f.from||f.to;
        list.innerHTML=`<tr><td colspan="9" class="text-center text-muted">${isF?'No records match filter.':'No muhasib bills found.'}</td></tr>`;
        return;
      }
      list.innerHTML = filtered.map(bill=>{
        const isDirect=!bill.slipId;
        const note=isDirect?'Direct':'From Slip';
        let attachmentHtml='-';
        if(bill.attachmentUrl){
          const syncClass=bill.pendingUpload?'pending-sync':'';
          const label=bill.pendingUpload?'⏳ Syncing':(bill.fileType==='application/pdf'?'📄 PDF Attached':'📷 Image Attached');
          attachmentHtml=`<span class="attachment-badge ${syncClass}" onclick="app.attachments.viewAttachment('bills', ${bill.id})">${label}</span>`;
        }
        return `<tr><td class="num-val">${app.ui.formatDate(bill.date)}</td><td><span class="source-tag font-mono" style="font-size:0.72rem;letter-spacing:0.5px">${bill.tokenNumber || '-'}</span></td><td class="num-val text-bold">${bill.billNumber}</td><td>${bill.vendor}</td><td class="num-val text-bold text-error">-${app.ui.formatCurrency(bill.amount)}</td><td><span class="source-tag">${bill.category}</span><span class="text-muted text-xs block" style="display:block;font-size:0.7rem;">${note}</span></td><td>${attachmentHtml}</td><td>${bill.remarks||'-'}</td><td class="text-center"><div class="flex gap-2 justify-center"><button class="btn btn-secondary btn-sm" title="Convert to Hospital Bill" onclick="app.ui.convertBill(${bill.id})">→ Hosp</button><button class="btn btn-secondary btn-sm btn-edit-action" onclick="app.ui.initiateEdit('bills', ${bill.id})">Edit</button><button class="btn btn-secondary btn-sm text-error" onclick="app.db.promptDelete('bills', ${bill.id})">Delete</button></div></td></tr>`;
      }).join('');
    },
    async convertBill(id){
      const bill=app.state.bills.find(b=>b.id===id);
      if(!bill){ app.ui.showToast('Bill not found','error'); return; }
      const toHospital=bill.expenseType==='advance';
      const targetType=toHospital?'hospital':'advance';
      const targetLabel=toHospital?'Hospital Bill':'Muhasib Bill';
      const sourceLabel=toHospital?'Muhasib Bill':'Hospital Bill';
      app.ui.showConfirm('Convert Bill',`${sourceLabel} #${bill.billNumber} (${app.ui.formatCurrency(bill.amount)}) ko ${targetLabel} me convert karna hai? Ye bill ${sourceLabel} se hat kar ${targetLabel} me chala jayega.`, async()=>{
        try{
          bill.expenseType=targetType;
          bill.tokenNumber = app.generateToken(toHospital ? 'hospital_bill' : 'advance_bill');
          await app.db.put('bills',bill.id,bill);
          app.ui.showToast(`Converted to ${targetLabel}! Token: ${bill.tokenNumber}`);
          app.syncState();
        }catch(e){ app.ui.showToast('Convert failed: '+(e.message||e),'error'); }
      });
    },
    renderBillsTable() {
      const list=document.getElementById('list-bills');
      if(!list) return;
      const allFiltered=app.ui.getFiltered(app.state.bills,'bills');
      let filtered=allFiltered.filter(b=>String(b.expenseType||'').toLowerCase().trim()==='hospital');
      if(!filtered.length && app.state.bills.length){
        const raw=app.state.bills.filter(b=>String(b.expenseType||'').toLowerCase().trim()==='hospital');
        if(raw.length && !app.ui.filters.bills.search && !app.ui.filters.bills.from && !app.ui.filters.bills.to) filtered=raw;
        else if(raw.length && !filtered.length) filtered=raw;
      }
      const total=filtered.reduce((s,e)=>s+e.amount,0);
      const totEl=document.getElementById('total-bills'); if(totEl) totEl.textContent=`Total: ${app.ui.formatCurrency(total)} (${filtered.length})`;
      if(!filtered.length){
        const f=app.ui.filters.bills; const isF=f.search||f.from||f.to;
        list.innerHTML=`<tr><td colspan="9" class="text-center text-muted">${isF?'No records match filter.':'No hospital bills found.'}</td></tr>`;
        return;
      }
      list.innerHTML = filtered.map(bill=>{
        const isDirect=!bill.slipId;
        const note=isDirect?'Direct':'From Slip';
        let attachmentHtml='-';
        if(bill.attachmentUrl){
          const syncClass=bill.pendingUpload?'pending-sync':'';
          const label=bill.pendingUpload?'⏳ Syncing':(bill.fileType==='application/pdf'?'📄 PDF Attached':'📷 Image Attached');
          attachmentHtml=`<span class="attachment-badge ${syncClass}" onclick="app.attachments.viewAttachment('bills', ${bill.id})">${label}</span>`;
        }
        return `<tr><td class="num-val">${app.ui.formatDate(bill.date)}</td><td><span class="source-tag font-mono" style="font-size:0.72rem;letter-spacing:0.5px">${bill.tokenNumber || '-'}</span></td><td class="num-val text-bold">${bill.billNumber}</td><td>${bill.vendor}</td><td class="num-val text-bold text-error">-${app.ui.formatCurrency(bill.amount)}</td><td><span class="source-tag">${bill.category}</span><span class="text-muted text-xs block" style="display:block;font-size:0.7rem;">${note}</span></td><td>${attachmentHtml}</td><td>${bill.remarks||'-'}</td><td class="text-center"><div class="flex gap-2 justify-center"><button class="btn btn-secondary btn-sm" title="Convert to Muhasib Bill" onclick="app.ui.convertBill(${bill.id})">→ Muhasib</button><button class="btn btn-secondary btn-sm btn-edit-action" onclick="app.ui.initiateEdit('bills', ${bill.id})">Edit</button><button class="btn btn-secondary btn-sm text-error" onclick="app.db.promptDelete('bills', ${bill.id})">Delete</button></div></td></tr>`;
      }).join('');
    },

    openAccountsModal() {
      document.getElementById('edit-accounts-id').value = '';
      document.getElementById('dialog-accounts-title').innerText = 'Send To Accounts Department';
      document.getElementById('btn-accounts-save').innerText = 'Send to Accounts';
      
      document.getElementById('accounts-date').value = new Date().toISOString().split('T')[0];
      document.getElementById('accounts-bill-type').value = '';
      document.getElementById('accounts-amount').value = '';
      document.getElementById('accounts-ref').value = '';
      document.getElementById('accounts-remarks').value = '';

      app.ui.calculateAccountsBatch();
      app.ui.openModal('dialog-accounts-add');
    },

    calculateAccountsBatch() {
      const type = document.getElementById('accounts-bill-type').value;
      const amountInput = document.getElementById('accounts-amount');
      const submitBtn = document.getElementById('btn-accounts-save');
      
      if (!type) {
        document.getElementById('accounts-pending-amount').innerText = app.ui.formatCurrency(0);
        amountInput.value = '';
        amountInput.max = 0;
        submitBtn.disabled = true;
        return;
      }
      
      let maxAvailable = type === 'advance' ? app.state.advanceAvailableToSend : app.state.hospitalAvailableToSend;
      const editId = document.getElementById('edit-accounts-id').value;
      
      if (editId && app.attachments.activeViewedRecord && app.attachments.activeViewedRecord.billType === type) {
        maxAvailable += app.attachments.activeViewedRecord.amount;
      }
      
      document.getElementById('accounts-pending-amount').innerText = app.ui.formatCurrency(maxAvailable);
      amountInput.max = maxAvailable;
      
      if (maxAvailable > 0) {
        if (!editId) {
          amountInput.value = maxAvailable;
        } else if (app.attachments.activeViewedRecord && app.attachments.activeViewedRecord.billType !== type) {
          amountInput.value = maxAvailable;
        } else if (app.attachments.activeViewedRecord && app.attachments.activeViewedRecord.billType === type) {
          amountInput.value = app.attachments.activeViewedRecord.amount;
        }
        submitBtn.disabled = false;
      } else {
        amountInput.value = '';
        submitBtn.disabled = editId ? false : true;
      }
    },

    renderAccountsTable() {
      const list = document.getElementById('list-accounts');
      if (!list) return;
      list.innerHTML = '';
      const filtered = app.ui.getFiltered(app.state.accountsRegister,'accounts');
      const total = filtered.reduce((s,e)=>s+e.amount,0);
      const totEl=document.getElementById('total-accounts'); if(totEl) totEl.textContent=`Total: ${app.ui.formatCurrency(total)} (${filtered.length})`;
      if(!filtered.length){
        const f=app.ui.filters.accounts; const isF=f.search||f.from||f.to;
        list.innerHTML=`<tr><td colspan="6" class="text-center text-muted">${isF?'No records match filter.':'No batches sent to accounts.'}</td></tr>`;
        return;
      }
      list.innerHTML = filtered.map(acc => {
        const typeBadge = acc.billType === 'advance' 
          ? `<span class="badge badge-primary">Advance</span>` 
          : `<span class="badge badge-secondary">Hospital</span>`;
          
        return `
          <tr>
            <td>${app.ui.formatDate(acc.dateSent)}</td>
            <td>${typeBadge}</td>
            <td class="font-bold">${app.ui.formatCurrency(acc.amount)}</td>
            <td>${app.ui.escapeHTML(acc.referenceNo || '-')}</td>
            <td>${app.ui.escapeHTML(acc.remarks || '-')}</td>
            <td class="text-center">
              <div class="flex gap-2 justify-center">
                <button class="btn btn-secondary btn-sm btn-edit-action" onclick="app.ui.initiateEdit('accounts_register', ${acc.id})">
                  Edit
                </button>
                <button class="btn btn-secondary btn-sm text-error" onclick="app.db.promptDelete('accounts_register', ${acc.id})">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    },

    renderTransfersTable() {
      const list = document.getElementById('list-transfers');
      if(!list) return;
      const filtered = app.ui.getFiltered(app.state.transfers,'transfers');
      const total = filtered.reduce((s,e)=>s+e.amount,0);
      const totEl=document.getElementById('total-transfers'); if(totEl) totEl.textContent=`Total: ${app.ui.formatCurrency(total)} (${filtered.length})`;
      if(!filtered.length){
        const f=app.ui.filters.transfers; const isF=f.search||f.from||f.to;
        list.innerHTML=`<tr><td colspan="5" class="text-center text-muted">${isF?'No records match filter.':'No transfers recorded.'}</td></tr>`;
        return;
      }
      list.innerHTML = filtered.map(trans => {
        const typeLabel = trans.type === 'amanat' ? 'Amanat Noor Hospital' : 'Imprest Noor Hospital';
        return `
          <tr>
            <td class="num-val">${app.ui.formatDate(trans.date)}</td>
            <td class="text-bold">${typeLabel}</td>
            <td class="num-val text-bold text-success">${app.ui.formatCurrency(trans.amount)}</td>
            <td>${trans.remarks}</td>
            <td class="text-center">
              <div class="flex gap-2 justify-center">
                <button class="btn btn-secondary btn-sm btn-edit-action" onclick="app.ui.initiateEdit('transfers', ${trans.id})">
                  Edit
                </button>
                <button class="btn btn-secondary btn-sm text-error" onclick="app.db.promptDelete('transfers', ${trans.id})">
                  Delete
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    },

    renderBalanceSheet() {
      // Set date display
      const bsDateEl = document.getElementById('balance-sheet-date-display');
      if (bsDateEl) {
        bsDateEl.innerText = `As on: ${app.ui.formatDate(new Date().toISOString().split('T')[0])}`;
      }
      
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.innerText = app.ui.formatCurrency(val);
      };

      // Update values
      setVal('bs-advance-cash', app.state.advanceCashAvailable);
      setVal('bs-hospital-cash', app.state.hospitalCashAvailable);
      setVal('bs-total-cash', app.state.totalCashWithMe);

      setVal('bs-advance-bills', app.state.advanceBillsPending);
      setVal('bs-hospital-bills', app.state.hospitalBillsPending);
      setVal('bs-total-pending', app.state.totalPendingBills);

      setVal('bs-amanat', app.state.amanatReceived);
      setVal('bs-imprest', app.state.imprestReceived);
      setVal('bs-total-transferred', app.state.totalTransferred);

      setVal('bs-summary-cash', app.state.totalCashWithMe);
      setVal('bs-summary-pending', app.state.totalPendingBills);
      setVal('bs-summary-transferred', app.state.totalTransferred);

      // Render comprehensive detailed statement table
      if (app.reports && app.reports.renderBalanceSheetStatementTable) {
        app.reports.renderBalanceSheetStatementTable();
      }
    },

    /**
     * Renders Chart.js visuals or HTML/CSS/conic-gradient fallbacks if Chart.js is not loaded.
     */
    renderCharts() {
      const dashPanel = document.getElementById('panel-dashboard');
      if (!dashPanel || !dashPanel.classList.contains('active')) {
        return;
      }

      // Helper to format values as currency without symbol for charts
      const rawVal = (val) => Math.round(val * 100) / 100;

      // Extract colors from theme css variables
      const styles = window.getComputedStyle(document.documentElement);
      const textColor = styles.getPropertyValue('--text-main').trim() || '#fafafa';
      const mutedColor = styles.getPropertyValue('--text-muted').trim() || '#a1a1aa';
      const borderColor = styles.getPropertyValue('--border-color').trim() || '#27272a';
      const primaryColor = styles.getPropertyValue('--primary').trim() || '#10b981';
      const secondaryColor = styles.getPropertyValue('--secondary').trim() || '#6366f1';
      const accentColor = styles.getPropertyValue('--accent').trim() || '#f59e0b';
      const errorColor = styles.getPropertyValue('--error').trim() || '#ef4444';

      const dataPosition = {
        cash: rawVal(app.state.totalCashWithMe),
        pending: rawVal(app.state.totalPendingBills),
        amanat: rawVal(app.state.amanatReceived),
        imprest: rawVal(app.state.imprestReceived)
      };

      const dataSources = {
        advance: rawVal(app.state.totalAdvanceCashReceived),
        hospital: rawVal(app.state.totalHospitalCashCollected)
      };

      const dataStatus = {
        advancePending: rawVal(app.state.advanceBillsPending),
        hospitalPending: rawVal(app.state.hospitalBillsPending),
        transferred: rawVal(app.state.totalTransferred)
      };

      // Check if Chart.js is loaded
      const hasChartJs = typeof Chart !== 'undefined';

      if (hasChartJs) {
        // Show canvases, hide fallbacks
        document.getElementById('chart-financial-position').classList.remove('hidden');
        document.getElementById('fallback-financial-position').classList.add('hidden');
        document.getElementById('chart-cash-sources').classList.remove('hidden');
        document.getElementById('fallback-cash-sources').classList.add('hidden');
        document.getElementById('chart-bills-status').classList.remove('hidden');
        document.getElementById('fallback-bills-status').classList.add('hidden');

        // If chart instances already exist, update datasets in-place without rebuilding
        if (app.charts.position && app.charts.sources && app.charts.status) {
          app.charts.position.data.datasets[0].data = [dataPosition.cash, dataPosition.pending, dataPosition.amanat, dataPosition.imprest];
          app.charts.position.update('none');

          app.charts.sources.data.datasets[0].data = [dataSources.advance, dataSources.hospital];
          app.charts.sources.update('none');

          app.charts.status.data.datasets[0].data = [dataStatus.advancePending, dataStatus.hospitalPending, dataStatus.transferred];
          app.charts.status.update('none');
          return;
        }

        // Destroy any partial instance before first full initialization
        if (app.charts.position) { app.charts.position.destroy(); app.charts.position = null; }
        if (app.charts.sources) { app.charts.sources.destroy(); app.charts.sources = null; }
        if (app.charts.status) { app.charts.status.destroy(); app.charts.status = null; }

        // Font settings
        const fontConfig = {
          family: styles.getPropertyValue('--font-sans').trim() || 'Plus Jakarta Sans',
          size: 11
        };

        // Common Chart Options
        const chartOptions = {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function(context) {
                  return ' ' + context.dataset.label + ': ₹' + context.raw.toLocaleString('en-IN', { minimumFractionDigits: 2 });
                }
              }
            }
          }
        };

        // 1. Financial Position Chart (Horizontal Bar Chart)
        const ctxPosition = document.getElementById('chart-financial-position').getContext('2d');
        app.charts.position = new Chart(ctxPosition, {
          type: 'bar',
          data: {
            labels: ['Cash With Me', 'Total Pending Bills', 'Amanat Received', 'Imprest Received'],
            datasets: [{
              label: 'Amount',
              data: [dataPosition.cash, dataPosition.pending, dataPosition.amanat, dataPosition.imprest],
              backgroundColor: [primaryColor, accentColor, secondaryColor, 'rgba(99, 102, 241, 0.65)'],
              borderColor: [primaryColor, accentColor, secondaryColor, 'rgba(99, 102, 241, 0.65)'],
              borderWidth: 1,
              borderRadius: 6
            }]
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: function(context) {
                    return ' ' + context.label + ': ₹' + context.raw.toLocaleString('en-IN', { minimumFractionDigits: 2 });
                  }
                }
              }
            },
            scales: {
              x: {
                grid: { color: borderColor },
                ticks: {
                  color: mutedColor,
                  font: fontConfig,
                  callback: function(value) {
                    return '₹' + value.toLocaleString('en-IN');
                  }
                }
              },
              y: {
                grid: { display: false },
                ticks: {
                  color: textColor,
                  font: { ...fontConfig, weight: 'bold' }
                }
              }
            }
          }
        });

        // 2. Cash Sources Chart (Doughnut Chart)
        const ctxSources = document.getElementById('chart-cash-sources').getContext('2d');
        app.charts.sources = new Chart(ctxSources, {
          type: 'doughnut',
          data: {
            labels: ['Total Muhasib Cash Received', 'Total Hospital Cash Collected'],
            datasets: [{
              label: 'Sources',
              data: [dataSources.advance, dataSources.hospital],
              backgroundColor: [primaryColor, secondaryColor],
              borderColor: styles.getPropertyValue('--bg-card').trim() || '#18181b',
              borderWidth: 2
            }]
          },
          options: {
            ...chartOptions,
            plugins: {
              legend: {
                display: true,
                position: 'bottom',
                labels: {
                  color: textColor,
                  font: fontConfig,
                  boxWidth: 12,
                  padding: 15
                }
              },
              tooltip: {
                callbacks: {
                  label: function(context) {
                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                    const pct = total > 0 ? ((context.raw / total) * 100).toFixed(1) + '%' : '0%';
                    return ' ' + context.label + ': ₹' + context.raw.toLocaleString('en-IN') + ' (' + pct + ')';
                  }
                }
              }
            },
            cutout: '65%'
          }
        });

        // 3. Bills Status Chart (Doughnut Chart)
        const ctxStatus = document.getElementById('chart-bills-status').getContext('2d');
        app.charts.status = new Chart(ctxStatus, {
          type: 'doughnut',
          data: {
            labels: ['Advance Bills Pending', 'Hospital Bills Pending', 'Total Transferred Back'],
            datasets: [{
              label: 'Status',
              data: [dataStatus.advancePending, dataStatus.hospitalPending, dataStatus.transferred],
              backgroundColor: [accentColor, errorColor, primaryColor],
              borderColor: styles.getPropertyValue('--bg-card').trim() || '#18181b',
              borderWidth: 2
            }]
          },
          options: {
            ...chartOptions,
            plugins: {
              legend: {
                display: true,
                position: 'bottom',
                labels: {
                  color: textColor,
                  font: fontConfig,
                  boxWidth: 12,
                  padding: 15
                }
              },
              tooltip: {
                callbacks: {
                  label: function(context) {
                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                    const pct = total > 0 ? ((context.raw / total) * 100).toFixed(1) + '%' : '0%';
                    return ' ' + context.label + ': ₹' + context.raw.toLocaleString('en-IN') + ' (' + pct + ')';
                  }
                }
              }
            },
            cutout: '65%'
          }
        });

      } else {
        // Fallback Mode (Offline & script did not load)
        console.warn('Chart.js library not loaded. Rendering HTML fallback visualization.');

        // Hide canvases, show fallback divs
        document.getElementById('chart-financial-position').classList.add('hidden');
        document.getElementById('fallback-financial-position').classList.remove('hidden');
        document.getElementById('chart-cash-sources').classList.add('hidden');
        document.getElementById('fallback-cash-sources').classList.remove('hidden');
        document.getElementById('chart-bills-status').classList.add('hidden');
        document.getElementById('fallback-bills-status').classList.remove('hidden');

        // Render Fallback 1: Financial Position Bar List
        const maxVal = Math.max(dataPosition.cash, dataPosition.pending, dataPosition.amanat, dataPosition.imprest, 1);
        const getPct = (val) => Math.min(100, Math.max(5, (val / maxVal) * 100)) + '%';
        const formattedVal = (val) => '₹' + val.toLocaleString('en-IN', { minimumFractionDigits: 2 });

        document.getElementById('fallback-financial-position').innerHTML = `
          <div class="fallback-bar-list">
            <div class="fallback-bar-item">
              <div class="fallback-bar-info">
                <span>Cash With Me</span>
                <strong>${formattedVal(dataPosition.cash)}</strong>
              </div>
              <div class="fallback-bar-track">
                <div class="fallback-bar-fill" style="width: ${getPct(dataPosition.cash)}; background-color: var(--primary);"></div>
              </div>
            </div>
            <div class="fallback-bar-item">
              <div class="fallback-bar-info">
                <span>Total Pending Bills</span>
                <strong>${formattedVal(dataPosition.pending)}</strong>
              </div>
              <div class="fallback-bar-track">
                <div class="fallback-bar-fill" style="width: ${getPct(dataPosition.pending)}; background-color: var(--accent);"></div>
              </div>
            </div>
            <div class="fallback-bar-item">
              <div class="fallback-bar-info">
                <span>Amanat Received</span>
                <strong>${formattedVal(dataPosition.amanat)}</strong>
              </div>
              <div class="fallback-bar-track">
                <div class="fallback-bar-fill" style="width: ${getPct(dataPosition.amanat)}; background-color: var(--secondary);"></div>
              </div>
            </div>
            <div class="fallback-bar-item">
              <div class="fallback-bar-info">
                <span>Imprest Received</span>
                <strong>${formattedVal(dataPosition.imprest)}</strong>
              </div>
              <div class="fallback-bar-track">
                <div class="fallback-bar-fill" style="width: ${getPct(dataPosition.imprest)}; background-color: rgba(99, 102, 241, 0.65);"></div>
              </div>
            </div>
          </div>
        `;

        // Render Fallback 2: Cash Sources Doughnut (Conic-Gradient)
        const sourcesTotal = dataSources.advance + dataSources.hospital;
        let sPct1 = 50, sPct2 = 50;
        if (sourcesTotal > 0) {
          sPct1 = (dataSources.advance / sourcesTotal) * 100;
          sPct2 = 100 - sPct1;
        }
        
        document.getElementById('fallback-cash-sources').innerHTML = `
          <div class="fallback-doughnut-container">
            <div class="fallback-doughnut-circle" style="background: conic-gradient(var(--primary) 0% ${sPct1}%, var(--secondary) ${sPct1}% 100%);">
              <div class="fallback-doughnut-inner"></div>
            </div>
            <div class="fallback-legend">
              <div class="legend-item">
                <span class="legend-dot" style="background-color: var(--primary);"></span>
                <span class="legend-text">Advance:</span>
                <span>${sPct1.toFixed(1)}% (${formattedVal(dataSources.advance)})</span>
              </div>
              <div class="legend-item">
                <span class="legend-dot" style="background-color: var(--secondary);"></span>
                <span class="legend-text">Hospital:</span>
                <span>${sPct2.toFixed(1)}% (${formattedVal(dataSources.hospital)})</span>
              </div>
            </div>
          </div>
        `;

        // Render Fallback 3: Bills Status Doughnut (Conic-Gradient)
        const statusTotal = dataStatus.advancePending + dataStatus.hospitalPending + dataStatus.transferred;
        let p1 = 33.3, p2 = 33.3, p3 = 33.4;
        if (statusTotal > 0) {
          p1 = (dataStatus.advancePending / statusTotal) * 100;
          p2 = (dataStatus.hospitalPending / statusTotal) * 100;
          p3 = 100 - (p1 + p2);
        }

        document.getElementById('fallback-bills-status').innerHTML = `
          <div class="fallback-doughnut-container">
            <div class="fallback-doughnut-circle" style="background: conic-gradient(var(--accent) 0% ${p1}%, var(--error) ${p1}% ${p1+p2}%, var(--primary) ${p1+p2}% 100%);">
              <div class="fallback-doughnut-inner"></div>
            </div>
            <div class="fallback-legend">
              <div class="legend-item">
                <span class="legend-dot" style="background-color: var(--accent);"></span>
                <span class="legend-text">Adv Pending:</span>
                <span>${p1.toFixed(1)}% (${formattedVal(dataStatus.advancePending)})</span>
              </div>
              <div class="legend-item">
                <span class="legend-dot" style="background-color: var(--error);"></span>
                <span class="legend-text">Hosp Pending:</span>
                <span>${p2.toFixed(1)}% (${formattedVal(dataStatus.hospitalPending)})</span>
              </div>
              <div class="legend-item">
                <span class="legend-dot" style="background-color: var(--primary);"></span>
                <span class="legend-text">Transferred:</span>
                <span>${p3.toFixed(1)}% (${formattedVal(dataStatus.transferred)})</span>
              </div>
            </div>
          </div>
        `;
      }
    }
  },

  // ==========================================
  // REPORTS CENTRE & PRINT/EXPORT PIPELINES
  // ==========================================
  reports: {
    /**
     * Generates itemized accounting rows for the Comprehensive Statement of Cash Flows & Reconciled Balances.
     * Itemizes all inflows (collections, float additions) and outflows (hospital bills, muhasib bills,
     * active temporary slips, deposits, accounts transfers) and calculates the net closing balance.
     */
    generateBalanceSheetTableRows(options = {}) {
      const filterStart = options.startDate || '';
      const filterEnd = options.endDate || '';
      const inRange = (d) => {
        if (!d) return true;
        if (filterStart && d < filterStart) return false;
        if (filterEnd && d > filterEnd) return false;
        return true;
      };

      let html = '';

      // ----------------------------------------------------
      // PART I: CASH INFLOWS & RECEIPTS (Dr)
      // ----------------------------------------------------
      html += `
        <tr class="bs-part-header" style="background:var(--bg-secondary); font-weight:800; border-top:2px solid var(--border-color); border-bottom:1px solid var(--border-color);">
          <td colspan="2" style="color:var(--primary); padding:9px 12px; font-size:0.84rem; letter-spacing:0.04em;">
            <span style="display:inline-block; width:8px; height:8px; background:var(--primary); border-radius:50%; margin-right:6px;"></span>
            PART I: CASH INFLOWS & RECEIPTS (Dr)
          </td>
          <td class="text-right" style="color:var(--primary); font-weight:800; padding:9px 12px;">Inflow Dr (+)</td>
          <td class="text-right" style="color:var(--text-muted); font-weight:800; padding:9px 12px;">-</td>
        </tr>
      `;

      // 1. Opening Cash Floats
      html += `
        <tr style="background:var(--bg-app);">
          <td style="padding-left:18px;"><strong>Opening Muhasib Float</strong> (Initial Imprest Float)</td>
          <td><span class="source-tag">Opening Float</span></td>
          <td class="num-val text-right text-success">+${app.ui.formatCurrency(app.state.openingAdvanceCash)}</td>
          <td class="num-val text-right text-muted">-</td>
        </tr>
        <tr style="background:var(--bg-app);">
          <td style="padding-left:18px;"><strong>Opening Hospital Cash</strong> (Initial Till Float)</td>
          <td><span class="source-tag">Opening Float</span></td>
          <td class="num-val text-right text-success">+${app.ui.formatCurrency(app.state.openingHospitalCash)}</td>
          <td class="num-val text-right text-muted">-</td>
        </tr>
      `;

      // 2. Hospital Collections (Itemized)
      const hospEntries = (app.state.hospitalCashEntries || [])
        .filter(e => inRange(e.date))
        .sort((a,b) => new Date(a.date) - new Date(b.date));
      let subtotalHospColl = hospEntries.reduce((s,e) => s + (e.amount || 0), 0);

      html += `
        <tr class="bs-section-subhead" style="font-weight:700; color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; background:rgba(16,185,129,0.06);">
          <td colspan="4" style="padding:6px 12px 6px 18px;">Hospital Cash Collections (${hospEntries.length} entries)</td>
        </tr>
      `;
      if (hospEntries.length === 0) {
        html += `<tr><td colspan="4" style="padding-left:26px; color:var(--text-muted); font-size:0.75rem;">No hospital collections recorded in period.</td></tr>`;
      } else {
        hospEntries.forEach(e => {
          html += `
            <tr>
              <td style="padding-left:26px;">
                <span class="num-val" style="margin-right:8px; color:var(--text-muted);">${app.ui.formatDate(e.date)}</span>
                Hospital Collection: ${e.remarks || 'Daily collections'}
              </td>
              <td><span class="source-tag">${e.source || 'Hospital'}</span></td>
              <td class="num-val text-right text-success">+${app.ui.formatCurrency(e.amount)}</td>
              <td class="num-val text-right text-muted">-</td>
            </tr>
          `;
        });
      }
      html += `
        <tr class="bs-subtotal-row" style="background:var(--bg-card); font-weight:700; border-top:1px dashed var(--border-color);">
          <td colspan="2" style="padding-left:18px; color:var(--text-muted);">Subtotal: Hospital Collections</td>
          <td class="num-val text-right text-success">+${app.ui.formatCurrency(subtotalHospColl)}</td>
          <td class="num-val text-right text-muted">-</td>
        </tr>
      `;

      // 3. Muhasib Float Additions (Itemized)
      const advEntries = (app.state.advanceCashEntries || [])
        .filter(e => inRange(e.date))
        .sort((a,b) => new Date(a.date) - new Date(b.date));
      let subtotalAdvAdd = advEntries.reduce((s,e) => s + (e.amount || 0), 0);

      html += `
        <tr class="bs-section-subhead" style="font-weight:700; color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; background:rgba(99,102,241,0.06);">
          <td colspan="4" style="padding:6px 12px 6px 18px;">Muhasib Cash Float Additions (${advEntries.length} entries)</td>
        </tr>
      `;
      if (advEntries.length === 0) {
        html += `<tr><td colspan="4" style="padding-left:26px; color:var(--text-muted); font-size:0.75rem;">No additional float additions recorded in period.</td></tr>`;
      } else {
        advEntries.forEach(e => {
          html += `
            <tr>
              <td style="padding-left:26px;">
                <span class="num-val" style="margin-right:8px; color:var(--text-muted);">${app.ui.formatDate(e.date)}</span>
                Float Received: ${e.remarks || 'Muhasib top-up'}
              </td>
              <td><span class="source-tag">Muhasib Float</span></td>
              <td class="num-val text-right text-success">+${app.ui.formatCurrency(e.amount)}</td>
              <td class="num-val text-right text-muted">-</td>
            </tr>
          `;
        });
      }
      html += `
        <tr class="bs-subtotal-row" style="background:var(--bg-card); font-weight:700; border-top:1px dashed var(--border-color);">
          <td colspan="2" style="padding-left:18px; color:var(--text-muted);">Subtotal: Muhasib Float Additions</td>
          <td class="num-val text-right text-success">+${app.ui.formatCurrency(subtotalAdvAdd)}</td>
          <td class="num-val text-right text-muted">-</td>
        </tr>
      `;

      const grossInflows = (app.state.openingAdvanceCash || 0) + (app.state.openingHospitalCash || 0) + subtotalHospColl + subtotalAdvAdd;
      html += `
        <tr class="bs-grandtotal-row" style="background:var(--bg-secondary); font-weight:800; border-top:2px solid var(--border-color); border-bottom:2px solid var(--border-color);">
          <td colspan="2" style="font-size:0.86rem; color:var(--text-main);">TOTAL GROSS CASH INFLOWS (PART I)</td>
          <td class="num-val text-right text-success" style="font-size:0.92rem;">+${app.ui.formatCurrency(grossInflows)}</td>
          <td class="num-val text-right text-muted">-</td>
        </tr>
      `;

      // ----------------------------------------------------
      // PART II: DISBURSEMENTS & CASH OUTFLOWS (Cr)
      // ----------------------------------------------------
      html += `
        <tr class="bs-part-header" style="background:var(--bg-secondary); font-weight:800; border-top:2px solid var(--border-color); border-bottom:1px solid var(--border-color);">
          <td colspan="2" style="color:var(--error); padding:9px 12px; font-size:0.84rem; letter-spacing:0.04em;">
            <span style="display:inline-block; width:8px; height:8px; background:var(--error); border-radius:50%; margin-right:6px;"></span>
            PART II: CASH OUTFLOWS & DISBURSEMENTS (Cr)
          </td>
          <td class="text-right" style="color:var(--text-muted); font-weight:800; padding:9px 12px;">-</td>
          <td class="text-right" style="color:var(--error); font-weight:800; padding:9px 12px;">Outflow Cr (-)</td>
        </tr>
      `;

      // 1. Hospital Direct Bills
      const hospBills = (app.state.bills || [])
        .filter(b => b.expenseType === 'hospital' && inRange(b.date))
        .sort((a,b) => new Date(a.date) - new Date(b.date));
      let subtotalHospBills = hospBills.reduce((s,b) => s + (b.amount || 0), 0);

      html += `
        <tr class="bs-section-subhead" style="font-weight:700; color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; background:rgba(239,68,68,0.06);">
          <td colspan="4" style="padding:6px 12px 6px 18px;">Hospital Purchase Bills Paid (${hospBills.length} bills)</td>
        </tr>
      `;
      if (hospBills.length === 0) {
        html += `<tr><td colspan="4" style="padding-left:26px; color:var(--text-muted); font-size:0.75rem;">No hospital bills recorded in period.</td></tr>`;
      } else {
        hospBills.forEach(b => {
          html += `
            <tr>
              <td style="padding-left:26px;">
                <span class="num-val" style="margin-right:8px; color:var(--text-muted);">${app.ui.formatDate(b.date)}</span>
                Bill #${b.billNumber || '-'}: ${b.vendor || '-'} ${b.remarks ? '('+b.remarks+')' : ''}
              </td>
              <td><span class="source-tag">${b.category || 'Hospital'}</span></td>
              <td class="num-val text-right text-muted">-</td>
              <td class="num-val text-right text-error">-${app.ui.formatCurrency(b.amount)}</td>
            </tr>
          `;
        });
      }
      html += `
        <tr class="bs-subtotal-row" style="background:var(--bg-card); font-weight:700; border-top:1px dashed var(--border-color);">
          <td colspan="2" style="padding-left:18px; color:var(--text-muted);">Subtotal: Hospital Bills</td>
          <td class="num-val text-right text-muted">-</td>
          <td class="num-val text-right text-error">-${app.ui.formatCurrency(subtotalHospBills)}</td>
        </tr>
      `;

      // 2. Muhasib Bills
      const advBills = (app.state.bills || [])
        .filter(b => b.expenseType === 'advance' && inRange(b.date))
        .sort((a,b) => new Date(a.date) - new Date(b.date));
      let subtotalAdvBills = advBills.reduce((s,b) => s + (b.amount || 0), 0);

      html += `
        <tr class="bs-section-subhead" style="font-weight:700; color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; background:rgba(245,158,11,0.06);">
          <td colspan="4" style="padding:6px 12px 6px 18px;">Muhasib Advance Bills Paid (${advBills.length} bills)</td>
        </tr>
      `;
      if (advBills.length === 0) {
        html += `<tr><td colspan="4" style="padding-left:26px; color:var(--text-muted); font-size:0.75rem;">No Muhasib bills recorded in period.</td></tr>`;
      } else {
        advBills.forEach(b => {
          html += `
            <tr>
              <td style="padding-left:26px;">
                <span class="num-val" style="margin-right:8px; color:var(--text-muted);">${app.ui.formatDate(b.date)}</span>
                Bill #${b.billNumber || '-'}: ${b.vendor || '-'} ${b.remarks ? '('+b.remarks+')' : ''}
              </td>
              <td><span class="source-tag">${b.category || 'Advance'}</span></td>
              <td class="num-val text-right text-muted">-</td>
              <td class="num-val text-right text-error">-${app.ui.formatCurrency(b.amount)}</td>
            </tr>
          `;
        });
      }
      html += `
        <tr class="bs-subtotal-row" style="background:var(--bg-card); font-weight:700; border-top:1px dashed var(--border-color);">
          <td colspan="2" style="padding-left:18px; color:var(--text-muted);">Subtotal: Muhasib Bills</td>
          <td class="num-val text-right text-muted">-</td>
          <td class="num-val text-right text-error">-${app.ui.formatCurrency(subtotalAdvBills)}</td>
        </tr>
      `;

      // 3. Active Temporary Slips (Float Committed/In Circulation)
      const activeSlips = app.getActiveTemporarySlips()
        .filter(s => inRange(s.date))
        .sort((a,b) => new Date(a.date) - new Date(b.date));
      let subtotalActiveSlips = activeSlips.reduce((s,sItem) => s + (sItem.amount || 0), 0);

      html += `
        <tr class="bs-section-subhead" style="font-weight:700; color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; background:rgba(217,119,6,0.06);">
          <td colspan="4" style="padding:6px 12px 6px 18px;">Active Temporary Slips (Float Committed) (${activeSlips.length} slips)</td>
        </tr>
      `;
      if (activeSlips.length === 0) {
        html += `<tr><td colspan="4" style="padding-left:26px; color:var(--text-muted); font-size:0.75rem;">No pending temporary slips currently outstanding.</td></tr>`;
      } else {
        activeSlips.forEach(s => {
          html += `
            <tr>
              <td style="padding-left:26px;">
                <span class="num-val" style="margin-right:8px; color:var(--text-muted);">${app.ui.formatDate(s.date)}</span>
                Slip #${s.slipNumber || '-'}: ${s.vendor || '-'} ${s.remarks ? '('+s.remarks+')' : ''}
              </td>
              <td><span class="source-tag">${s.expenseType === 'advance' ? 'Adv Slip' : 'Hosp Slip'}</span></td>
              <td class="num-val text-right text-muted">-</td>
              <td class="num-val text-right text-error">-${app.ui.formatCurrency(s.amount)}</td>
            </tr>
          `;
        });
      }
      html += `
        <tr class="bs-subtotal-row" style="background:var(--bg-card); font-weight:700; border-top:1px dashed var(--border-color);">
          <td colspan="2" style="padding-left:18px; color:var(--text-muted);">Subtotal: Active Temporary Slips</td>
          <td class="num-val text-right text-muted">-</td>
          <td class="num-val text-right text-error">-${app.ui.formatCurrency(subtotalActiveSlips)}</td>
        </tr>
      `;

      // 4. Hospital Cash Deposits to Muhasib
      const deps = (app.state.hospitalDeposits || [])
        .filter(d => inRange(d.date))
        .sort((a,b) => new Date(a.date) - new Date(b.date));
      let subtotalDeps = deps.reduce((s,d) => s + (d.amount || 0), 0);

      html += `
        <tr class="bs-section-subhead" style="font-weight:700; color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; background:rgba(99,102,241,0.06);">
          <td colspan="4" style="padding:6px 12px 6px 18px;">Hospital Cash Deposits to Muhasib (${deps.length} deposits)</td>
        </tr>
      `;
      if (deps.length === 0) {
        html += `<tr><td colspan="4" style="padding-left:26px; color:var(--text-muted); font-size:0.75rem;">No hospital deposits recorded in period.</td></tr>`;
      } else {
        deps.forEach(d => {
          html += `
            <tr>
              <td style="padding-left:26px;">
                <span class="num-val" style="margin-right:8px; color:var(--text-muted);">${app.ui.formatDate(d.date)}</span>
                Deposit: Rcpt #${d.receiptNumber || '-'} ${d.remarks ? '('+d.remarks+')' : ''}
              </td>
              <td><span class="source-tag">Muhasib Remittance</span></td>
              <td class="num-val text-right text-muted">-</td>
              <td class="num-val text-right text-error">-${app.ui.formatCurrency(d.amount)}</td>
            </tr>
          `;
        });
      }
      html += `
        <tr class="bs-subtotal-row" style="background:var(--bg-card); font-weight:700; border-top:1px dashed var(--border-color);">
          <td colspan="2" style="padding-left:18px; color:var(--text-muted);">Subtotal: Deposits Remitted</td>
          <td class="num-val text-right text-muted">-</td>
          <td class="num-val text-right text-error">-${app.ui.formatCurrency(subtotalDeps)}</td>
        </tr>
      `;

      // 5. Sent to Accounts Department
      const accHospital = (app.state.accountsRegister || [])
        .filter(a => a.billType === 'hospital' && inRange(a.dateSent || a.date))
        .sort((a,b) => new Date(a.dateSent || a.date) - new Date(b.dateSent || b.date));
      let subtotalAcc = accHospital.reduce((s,a) => s + (a.amount || 0), 0);

      html += `
        <tr class="bs-section-subhead" style="font-weight:700; color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; background:rgba(14,165,233,0.06);">
          <td colspan="4" style="padding:6px 12px 6px 18px;">Transferred to Accounts Department (${accHospital.length} entries)</td>
        </tr>
      `;
      if (accHospital.length === 0) {
        html += `<tr><td colspan="4" style="padding-left:26px; color:var(--text-muted); font-size:0.75rem;">No records sent to Accounts Department in period.</td></tr>`;
      } else {
        accHospital.forEach(a => {
          html += `
            <tr>
              <td style="padding-left:26px;">
                <span class="num-val" style="margin-right:8px; color:var(--text-muted);">${app.ui.formatDate(a.dateSent || a.date)}</span>
                Accounts Reg: Ref #${a.referenceNo || '-'} ${a.remarks ? '('+a.remarks+')' : ''}
              </td>
              <td><span class="source-tag">Accounts Reg</span></td>
              <td class="num-val text-right text-muted">-</td>
              <td class="num-val text-right text-error">-${app.ui.formatCurrency(a.amount)}</td>
            </tr>
          `;
        });
      }
      html += `
        <tr class="bs-subtotal-row" style="background:var(--bg-card); font-weight:700; border-top:1px dashed var(--border-color);">
          <td colspan="2" style="padding-left:18px; color:var(--text-muted);">Subtotal: Sent to Accounts Dept</td>
          <td class="num-val text-right text-muted">-</td>
          <td class="num-val text-right text-error">-${app.ui.formatCurrency(subtotalAcc)}</td>
        </tr>
      `;

      const grossOutflows = subtotalHospBills + subtotalAdvBills + subtotalActiveSlips + subtotalDeps + subtotalAcc;
      html += `
        <tr class="bs-grandtotal-row" style="background:var(--bg-secondary); font-weight:800; border-top:2px solid var(--border-color); border-bottom:2px solid var(--border-color);">
          <td colspan="2" style="font-size:0.86rem; color:var(--text-main);">TOTAL GROSS CASH OUTFLOWS (PART II)</td>
          <td class="num-val text-right text-muted">-</td>
          <td class="num-val text-right text-error" style="font-size:0.92rem;">-${app.ui.formatCurrency(grossOutflows)}</td>
        </tr>
      `;

      // ----------------------------------------------------
      // PART III: NET RECONCILED CASH CLOSING & AUDIT POSITION
      // ----------------------------------------------------
      html += `
        <tr class="bs-part-header" style="background:var(--bg-secondary); font-weight:800; border-top:2px solid var(--border-color); border-bottom:1px solid var(--border-color);">
          <td colspan="2" style="color:var(--secondary); padding:9px 12px; font-size:0.84rem; letter-spacing:0.04em;">
            <span style="display:inline-block; width:8px; height:8px; background:var(--secondary); border-radius:50%; margin-right:6px;"></span>
            PART III: NET CLOSING & RECONCILED AUDIT POSITION
          </td>
          <td class="text-right" style="color:var(--text-muted); font-weight:800; padding:9px 12px;">-</td>
          <td class="text-right" style="color:var(--secondary); font-weight:800; padding:9px 12px;">Net Balance</td>
        </tr>
      `;

      html += `
        <tr style="background:var(--bg-app); font-weight:700;">
          <td style="padding-left:18px;">Muhasib Cash Float in Hand Available</td>
          <td><span class="source-tag">Cash In Hand</span></td>
          <td class="num-val text-right text-muted">-</td>
          <td class="num-val text-right">${app.ui.formatCurrency(app.state.advanceCashAvailable)}</td>
        </tr>
        <tr style="background:var(--bg-app); font-weight:700;">
          <td style="padding-left:18px;">Hospital Cash Collections in Hand Available</td>
          <td><span class="source-tag">Cash In Hand</span></td>
          <td class="num-val text-right text-muted">-</td>
          <td class="num-val text-right">${app.ui.formatCurrency(app.state.hospitalCashAvailable)}</td>
        </tr>
        <tr class="bs-grandtotal-row" style="background:rgba(16,185,129,0.12); font-weight:900; border-top:2px solid var(--border-color); border-bottom:2px solid var(--border-color);">
          <td colspan="2" style="font-size:0.92rem; color:var(--text-main);">
            NET RECONCILED CASH WITH ME (IN HAND) [PART I - PART II]
          </td>
          <td class="num-val text-right text-muted">-</td>
          <td class="num-val text-right text-success" style="font-size:1.05rem;">
            ${app.ui.formatCurrency(app.state.totalCashWithMe)}
          </td>
        </tr>
        <tr style="background:var(--bg-app);">
          <td style="padding-left:18px; color:var(--text-muted);">Total Outstanding Bills Pending Settlement (Advance + Hospital)</td>
          <td><span class="status-pill pending">Pending Settlement</span></td>
          <td class="num-val text-right text-muted">-</td>
          <td class="num-val text-right text-warning">${app.ui.formatCurrency(app.state.totalPendingBills)}</td>
        </tr>
        <tr style="background:var(--bg-app);">
          <td style="padding-left:18px; color:var(--text-muted);">Total Settled via Verification Transfers (Amanat + Imprest)</td>
          <td><span class="status-pill verified">Settled</span></td>
          <td class="num-val text-right text-muted">-</td>
          <td class="num-val text-right text-success">${app.ui.formatCurrency(app.state.totalTransferred)}</td>
        </tr>
      `;

      return html;
    },

    /**
     * Renders statement table into the specified tbody element.
     */
    renderBalanceSheetStatementTable(targetTbodyId = 'bs-statement-tbody') {
      const tbody = document.getElementById(targetTbodyId);
      if (!tbody) return;
      tbody.innerHTML = app.reports.generateBalanceSheetTableRows();
    },

    /**
     * Renders filtered datasets inside the Reports Centre viewport.
     */
    renderReportView() {
      const type = document.getElementById('report-select-type').value;
      const startVal = document.getElementById('report-date-start').value;
      const endVal = document.getElementById('report-date-end').value;

      const titleDisplay = document.getElementById('report-title-display');
      const metaDisplay = document.getElementById('report-meta-display');
      const thead = document.getElementById('report-thead');
      const tbody = document.getElementById('report-tbody');
      const bsPlaceholder = document.getElementById('report-balance-sheet-placeholder');

      // Date Range Filter Logic
      const filterByDateRange = (list) => {
        return list.filter(item => {
          if (!item.date) return true;
          if (startVal && item.date < startVal) return false;
          if (endVal && item.date > endVal) return false;
          return true;
        });
      };

      // Set ranges meta text
      let dateMetaText = 'All Records';
      if (startVal || endVal) {
        dateMetaText = `Range: ${startVal || 'Start'} to ${endVal || 'End'}`;
      }
      metaDisplay.innerText = dateMetaText;

      // Hide balance sheet print layout by default
      bsPlaceholder.classList.add('hidden');
      thead.classList.remove('hidden');
      tbody.classList.remove('hidden');

      if (type === 'advance') {
        titleDisplay.innerText = 'Muhasib Cash Ledger Report';
        thead.innerHTML = `
          <tr>
            <th>Date</th>
            <th>Amount</th>
            <th>Remarks</th>
            <th class="text-right">Running Balance</th>
          </tr>
        `;
        tbody.innerHTML = '';
        
        let running = app.state.openingAdvanceCash;
        const sorted = [...app.state.advanceCashEntries].sort((a,b) => new Date(a.date) - new Date(b.date));
        
        // Since running balance is calculation-sensitive, we must compute running balance BEFORE filtering, 
        // but only render elements within range
        sorted.forEach(entry => {
          running += entry.amount;
          if (startVal && entry.date < startVal) return;
          if (endVal && entry.date > endVal) return;

          tbody.innerHTML += `
            <tr>
              <td class="num-val">${app.ui.formatDate(entry.date)}</td>
              <td class="num-val text-success">+${app.ui.formatCurrency(entry.amount)}</td>
              <td>${entry.remarks}</td>
              <td class="num-val text-right">${app.ui.formatCurrency(running)}</td>
            </tr>
          `;
        });
        if (!tbody.children.length) {
          tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No records found.</td></tr>`;
        }

      } else if (type === 'hospital') {
        titleDisplay.innerText = 'Hospital Cash Collection Report';
        thead.innerHTML = `
          <tr>
            <th>Date</th>
            <th>Source</th>
            <th>Amount</th>
            <th>Remarks</th>
            <th class="text-right">Running Balance</th>
          </tr>
        `;
        tbody.innerHTML = '';

        let running = app.state.openingHospitalCash;
        const sorted = [...app.state.hospitalCashEntries].sort((a,b) => new Date(a.date) - new Date(b.date));

        sorted.forEach(entry => {
          running += entry.amount;
          if (startVal && entry.date < startVal) return;
          if (endVal && entry.date > endVal) return;

          tbody.innerHTML += `
            <tr>
              <td class="num-val">${app.ui.formatDate(entry.date)}</td>
              <td><span class="source-tag">${entry.source}</span></td>
              <td class="num-val text-success">+${app.ui.formatCurrency(entry.amount)}</td>
              <td>${entry.remarks || '-'}</td>
              <td class="num-val text-right">${app.ui.formatCurrency(running)}</td>
            </tr>
          `;
        });
        if (!tbody.children.length) {
          tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No records found.</td></tr>`;
        }

      } else if (type === 'slips') {
        titleDisplay.innerText = 'Temporary Slips Report';
        thead.innerHTML = `
          <tr>
            <th>Date</th>
            <th>Token No</th>
            <th>Vendor / Person</th>
            <th>Amount</th>
            <th>Expense Type</th>
            <th>Status</th>
            <th>Attachment Available</th>
            <th>Attachment File Name</th>
            <th>Remarks</th>
          </tr>
        `;
        
        const filtered = filterByDateRange(app.getActiveTemporarySlips());
        tbody.innerHTML = '';
        
        filtered.forEach(slip => {
          const typeLabel = slip.expenseType === 'advance' ? 'Advance Expense' : 'Hospital Expense';
          const attachAvailable = slip.attachmentUrl ? 'Yes' : 'No';
          const attachName = slip.attachmentUrl ? (slip.fileName || 'document') : '-';
          
          tbody.innerHTML += `
            <tr>
              <td class="num-val">${app.ui.formatDate(slip.date)}</td>
              <td><span class="source-tag font-mono" style="font-size:0.72rem;letter-spacing:0.5px">${slip.tokenNumber || '-'}</span></td>
              <td>${slip.vendor}</td>
              <td class="num-val text-error">-${app.ui.formatCurrency(slip.amount)}</td>
              <td><span class="source-tag">${typeLabel}</span></td>
              <td><span class="status-pill ${slip.status}">${slip.status}</span></td>
              <td>${attachAvailable}</td>
              <td class="font-mono text-xs">${attachName}</td>
              <td>${slip.remarks || '-'}</td>
            </tr>
          `;
        });
        if (!filtered.length) {
          tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">No records found.</td></tr>`;
        }

      } else if (type === 'muhasib_bills') {
        titleDisplay.innerText = 'Muhasib Bill Report';
        thead.innerHTML = `
          <tr>
            <th>Date</th>
            <th>Token No</th>
            <th>Bill Number</th>
            <th>Vendor Name</th>
            <th>Amount</th>
            <th>Category</th>
            <th>Attachment Available</th>
            <th>Attachment File Name</th>
            <th>Remarks</th>
          </tr>
        `;
        const filtered = filterByDateRange(app.state.bills.filter(b=>b.expenseType==='advance'));
        tbody.innerHTML = '';
        filtered.forEach(bill => {
          const attachAvailable = bill.attachmentUrl ? 'Yes' : 'No';
          const attachName = bill.attachmentUrl ? (bill.fileName || 'document') : '-';
          tbody.innerHTML += `
            <tr>
              <td class="num-val">${app.ui.formatDate(bill.date)}</td>
              <td><span class="source-tag font-mono" style="font-size:0.72rem;letter-spacing:0.5px">${bill.tokenNumber || '-'}</span></td>
              <td class="num-val">${bill.billNumber}</td>
              <td>${bill.vendor}</td>
              <td class="num-val text-error">-${app.ui.formatCurrency(bill.amount)}</td>
              <td><span class="source-tag">${bill.category}</span></td>
              <td>${attachAvailable}</td>
              <td class="font-mono text-xs">${attachName}</td>
              <td>${bill.remarks || '-'}</td>
            </tr>
          `;
        });
        if (!filtered.length) {
          tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">No records found.</td></tr>`;
        }
      } else if (type === 'hospital_bills') {
        titleDisplay.innerText = 'Hospital Bill Report';
        thead.innerHTML = `
          <tr>
            <th>Date</th>
            <th>Token No</th>
            <th>Bill Number</th>
            <th>Vendor Name</th>
            <th>Amount</th>
            <th>Category</th>
            <th>Attachment Available</th>
            <th>Attachment File Name</th>
            <th>Remarks</th>
          </tr>
        `;
        const filtered = filterByDateRange(app.state.bills.filter(b=>b.expenseType==='hospital'));
        tbody.innerHTML = '';
        filtered.forEach(bill => {
          const attachAvailable = bill.attachmentUrl ? 'Yes' : 'No';
          const attachName = bill.attachmentUrl ? (bill.fileName || 'document') : '-';
          tbody.innerHTML += `
            <tr>
              <td class="num-val">${app.ui.formatDate(bill.date)}</td>
              <td><span class="source-tag font-mono" style="font-size:0.72rem;letter-spacing:0.5px">${bill.tokenNumber || '-'}</span></td>
              <td class="num-val">${bill.billNumber}</td>
              <td>${bill.vendor}</td>
              <td class="num-val text-error">-${app.ui.formatCurrency(bill.amount)}</td>
              <td><span class="source-tag">${bill.category}</span></td>
              <td>${attachAvailable}</td>
              <td class="font-mono text-xs">${attachName}</td>
              <td>${bill.remarks || '-'}</td>
            </tr>
          `;
        });
        if (!filtered.length) {
          tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">No records found.</td></tr>`;
        }
      } else if (type === 'bills') {
        titleDisplay.innerText = 'All Bills Report';
        thead.innerHTML = `
          <tr>
            <th>Date</th>
            <th>Token No</th>
            <th>Bill Number</th>
            <th>Vendor Name</th>
            <th>Amount</th>
            <th>Expense Type</th>
            <th>Category</th>
            <th>Attachment Available</th>
            <th>Attachment File Name</th>
            <th>Remarks</th>
          </tr>
        `;
        
        const filtered = filterByDateRange(app.state.bills);
        tbody.innerHTML = '';

        filtered.forEach(bill => {
          const typeLabel = bill.expenseType === 'advance' ? 'Advance Expense' : 'Hospital Expense';
          const attachAvailable = bill.attachmentUrl ? 'Yes' : 'No';
          const attachName = bill.attachmentUrl ? (bill.fileName || 'document') : '-';
          
          tbody.innerHTML += `
            <tr>
              <td class="num-val">${app.ui.formatDate(bill.date)}</td>
              <td><span class="source-tag font-mono" style="font-size:0.72rem;letter-spacing:0.5px">${bill.tokenNumber || '-'}</span></td>
              <td class="num-val">${bill.billNumber}</td>
              <td>${bill.vendor}</td>
              <td class="num-val text-error">-${app.ui.formatCurrency(bill.amount)}</td>
              <td><span class="source-tag">${typeLabel}</span></td>
              <td><span class="source-tag">${bill.category}</span></td>
              <td>${attachAvailable}</td>
              <td class="font-mono text-xs">${attachName}</td>
              <td>${bill.remarks || '-'}</td>
            </tr>
          `;
        });
        if (!filtered.length) {
          tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">No records found.</td></tr>`;
        }

      } else if (type === 'accounts_register') {
        titleDisplay.innerText = 'Accounts Department Register Report';
        thead.innerHTML = `
          <tr>
            <th>Date Sent</th>
            <th>Bill Type</th>
            <th>Amount</th>
            <th>Reference No</th>
            <th>Remarks</th>
          </tr>
        `;
        
        const filtered = filterByDateRange(app.state.accountsRegister);
        tbody.innerHTML = '';

        filtered.forEach(acc => {
          const typeLabel = acc.billType === 'advance' ? 'Muhasib Cash Bills' : 'Hospital Cash Bills';
          tbody.innerHTML += `
            <tr>
              <td class="num-val">${app.ui.formatDate(acc.dateSent)}</td>
              <td>${typeLabel}</td>
              <td class="num-val text-error">${app.ui.formatCurrency(acc.amount)}</td>
              <td>${acc.referenceNo || '-'}</td>
              <td>${acc.remarks || '-'}</td>
            </tr>
          `;
        });
        if (!filtered.length) {
          tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No records found.</td></tr>`;
        }

      } else if (type === 'transfers') {
        titleDisplay.innerText = 'Verification & Transfer Report';
        thead.innerHTML = `
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Amount</th>
            <th>Remarks</th>
          </tr>
        `;
        
        const filtered = filterByDateRange(app.state.transfers);
        tbody.innerHTML = '';

        filtered.forEach(trans => {
          const typeLabel = trans.type === 'amanat' ? 'Amanat Noor Hospital' : 'Imprest Noor Hospital';
          tbody.innerHTML += `
            <tr>
              <td class="num-val">${app.ui.formatDate(trans.date)}</td>
              <td>${typeLabel}</td>
              <td class="num-val text-success">${app.ui.formatCurrency(trans.amount)}</td>
              <td>${trans.remarks}</td>
            </tr>
          `;
        });
        if (!filtered.length) {
          tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No records found.</td></tr>`;
        }

      } else if (type === 'deposit_history') {
        titleDisplay.innerText = 'Hospital Cash Deposits Report';
        thead.innerHTML = `
          <tr>
            <th>Date</th>
            <th>Receipt / Voucher No</th>
            <th>Amount</th>
            <th>Attachment Available</th>
            <th>Attachment File Name</th>
            <th>Remarks</th>
          </tr>
        `;
        
        const filtered = filterByDateRange(app.state.hospitalDeposits);
        tbody.innerHTML = '';
        let totalDeposited = 0;

        filtered.forEach(dep => {
          totalDeposited += dep.amount;
          const attachAvailable = dep.attachmentUrl ? 'Yes' : 'No';
          const attachName = dep.attachmentUrl ? (dep.fileName || 'receipt') : '-';
          
          tbody.innerHTML += `
            <tr>
              <td class="num-val">${app.ui.formatDate(dep.date)}</td>
              <td class="num-val text-bold">${dep.receiptNumber}</td>
              <td class="num-val text-error">-${app.ui.formatCurrency(dep.amount)}</td>
              <td>${attachAvailable}</td>
              <td class="font-mono text-xs">${attachName}</td>
              <td>${dep.remarks || '-'}</td>
            </tr>
          `;
        });

        if (filtered.length) {
          tbody.innerHTML += `
            <tr class="total-row" style="font-weight:bold; border-top: 2px solid var(--border-color);">
              <td colspan="2">Total Deposited</td>
              <td class="num-val text-error">-${app.ui.formatCurrency(totalDeposited)}</td>
              <td colspan="3"></td>
            </tr>
          `;
        } else {
          tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No records found.</td></tr>`;
        }

      } else if (type === 'monthly_deposit_summary') {
        titleDisplay.innerText = 'Monthly Hospital Deposits Summary';
        thead.innerHTML = `
          <tr>
            <th>Month</th>
            <th>Number of Deposits</th>
            <th class="text-right">Total Deposited</th>
          </tr>
        `;

        const filtered = filterByDateRange(app.state.hospitalDeposits);
        tbody.innerHTML = '';

        // Group by Month-Year (YYYY-MM)
        const groups = {};
        filtered.forEach(dep => {
          if (!dep.date) return;
          const month = dep.date.substring(0, 7); // "YYYY-MM"
          if (!groups[month]) {
            groups[month] = { count: 0, sum: 0 };
          }
          groups[month].count += 1;
          groups[month].sum += dep.amount;
        });

        const sortedMonths = Object.keys(groups).sort().reverse(); // descending order of months
        let grandTotal = 0;

        sortedMonths.forEach(month => {
          const group = groups[month];
          grandTotal += group.sum;
          
          // Format month to more readable format, e.g. June 2026
          let formattedMonth = month;
          try {
            const date = new Date(month + '-02'); // Avoid local timezone shift day drop
            formattedMonth = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
          } catch(e) {}

          tbody.innerHTML += `
            <tr>
              <td class="text-bold">${formattedMonth}</td>
              <td class="num-val">${group.count}</td>
              <td class="num-val text-right text-error">-${app.ui.formatCurrency(group.sum)}</td>
            </tr>
          `;
        });

        if (sortedMonths.length) {
          tbody.innerHTML += `
            <tr class="total-row" style="font-weight:bold; border-top: 2px solid var(--border-color);">
              <td>Grand Total</td>
              <td class="num-val">${filtered.length}</td>
              <td class="num-val text-right text-error">-${app.ui.formatCurrency(grandTotal)}</td>
            </tr>
          `;
        } else {
          tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">No records found.</td></tr>`;
        }

      } else if (type === 'advance_bills') {
        titleDisplay.innerText = 'Muhasib Cash + Advance Bills Report (Against Muhasib Cash)';
        thead.classList.add('hidden');
        tbody.classList.add('hidden');
        bsPlaceholder.classList.remove('hidden');
        const advList = filterByDateRange(app.state.advanceCashEntries);
        const billList = filterByDateRange(app.state.bills.filter(b => b.expenseType === 'advance'));
        const combined = [];
        advList.forEach(e => combined.push({ date: e.date, type: 'cash', remarks: e.remarks || '-', dr: e.amount, cr: 0, sortDate: e.date }));
        billList.forEach(b => combined.push({ date: b.date, type: 'bill', remarks: `${b.vendor || '-'}${b.billNumber ? ' ('+b.billNumber+')' : ''}${b.category ? ' - '+b.category : ''}`, dr: 0, cr: b.amount, sortDate: b.date }));
        combined.sort((a,b) => new Date(a.sortDate) - new Date(b.sortDate));
        let runningBal = app.state.openingAdvanceCash;
        let totalDr = 0;
        let totalCr = 0;
        let rowsHtml = `<tr style="background:var(--bg-secondary); font-weight:700;"><td class="num-val">-</td><td>Opening Balance (Muhasib Cash)</td><td class="num-val text-right"></td><td class="num-val text-right"></td><td class="num-val text-right">${app.ui.formatCurrency(runningBal)}</td></tr>`;
        combined.forEach(row => {
          if(row.dr) { totalDr += row.dr; runningBal += row.dr; }
          if(row.cr) { totalCr += row.cr; runningBal -= row.cr; }
          const drTxt = row.dr ? app.ui.formatCurrency(row.dr) : '-';
          const crTxt = row.cr ? app.ui.formatCurrency(row.cr) : '-';
          const badge = row.type==='cash' ? '<span class="source-tag" style="background:var(--success-light);color:var(--success)">Cash Received</span>' : '<span class="source-tag" style="background:var(--error-light);color:var(--error)">Bill Expense</span>';
          rowsHtml += `<tr><td class="num-val">${app.ui.formatDate(row.date)}</td><td>${row.remarks} ${badge}</td><td class="num-val text-right ${row.dr?'text-success':''}">${drTxt}</td><td class="num-val text-right ${row.cr?'text-error':''}">${crTxt}</td><td class="num-val text-right" style="font-weight:600">${app.ui.formatCurrency(runningBal)}</td></tr>`;
        });
        if(!combined.length) rowsHtml += `<tr><td colspan="5" class="text-center text-muted">No records in selected date range.</td></tr>`;
        const closingBal = app.state.openingAdvanceCash + totalDr - totalCr;
        rowsHtml += `<tr class="total-row" style="font-weight:800; border-top:2px solid var(--border-color); background:var(--bg-secondary);"><td colspan="2">TOTAL</td><td class="num-val text-right text-success">${app.ui.formatCurrency(totalDr)}</td><td class="num-val text-right text-error">${app.ui.formatCurrency(totalCr)}</td><td class="num-val text-right">${app.ui.formatCurrency(closingBal)}</td></tr>`;
        bsPlaceholder.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:1rem; padding:1rem 0;">
            <div class="card" style="padding:0; overflow:hidden;">
              <div style="padding:0.85rem 1.1rem; border-bottom:1px solid var(--border-color); font-weight:800; background:var(--bg-secondary); display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                <span>Muhasib Cash - Dr / Cr Ledger</span><span style="font-size:12px; font-weight:600; color:var(--text-muted)">Dr = Cash In &nbsp;|&nbsp; Cr = Bills Against Advance &nbsp;|&nbsp; Balance = Running</span>
              </div>
              <div style="overflow-x:auto;">
                <table class="data-table"><thead><tr><th>Date</th><th>Particulars</th><th class="text-right">Dr (Cash In)</th><th class="text-right">Cr (Bill Exp)</th><th class="text-right">Balance</th></tr></thead><tbody>${rowsHtml}</tbody></table>
              </div>
            </div>
            <div class="card" style="padding:1rem 1.1rem; background:var(--bg-secondary); display:flex; flex-wrap:wrap; gap:1.25rem; justify-content:space-between; font-weight:700; font-size:13px;">
              <span>Opening: ${app.ui.formatCurrency(app.state.openingAdvanceCash)}</span>
              <span>Total Dr: <span class="text-success">${app.ui.formatCurrency(totalDr)}</span></span>
              <span>Total Cr: <span class="text-error">${app.ui.formatCurrency(totalCr)}</span></span>
              <span>Closing Balance: ${app.ui.formatCurrency(closingBal)}</span>
            </div>
          </div>
        `;
      } else if (type === 'hospital_combined') {
        titleDisplay.innerText = 'Hospital Cash Ledger';
        thead.classList.add('hidden');
        tbody.classList.add('hidden');
        bsPlaceholder.classList.remove('hidden');
        const hospCashList = filterByDateRange(app.state.hospitalCashEntries);
        const hospBillList = filterByDateRange(app.state.bills.filter(b => b.expenseType === 'hospital'));
        const hospSlipList = filterByDateRange(app.getActiveTemporarySlips().filter(s => s.expenseType === 'hospital'));
        const depList = filterByDateRange(app.state.hospitalDeposits);
        const accList = app.state.accountsRegister.filter(a => {
          if (a.billType !== 'hospital') return false;
          const d = a.dateSent || a.date || '';
          if (startVal && d < startVal) return false;
          if (endVal && d > endVal) return false;
          return true;
        });
        const combined = [];
        const totalCashAmt = hospCashList.reduce((s,x)=>s+x.amount,0);
        if(hospCashList.length) combined.push({ date: hospCashList[hospCashList.length-1].date, remarks: `Total Cash Collection (${hospCashList.length} entries)`, dr: totalCashAmt, cr: 0, sortDate: hospCashList[hospCashList.length-1].date, badge: 'Cash Collection - Total', badgeColor: 'var(--primary)' });
        const totalBillAmt = hospBillList.reduce((s,x)=>s+x.amount,0);
        if(hospBillList.length) combined.push({ date: hospBillList[hospBillList.length-1].date, remarks: `Total Hospital Bills (${hospBillList.length} bills)`, dr: 0, cr: totalBillAmt, sortDate: hospBillList[hospBillList.length-1].date, badge: 'Hospital Bills - Total', badgeColor: 'var(--error)' });
        const totalSlipAmt = hospSlipList.reduce((s,x)=>s+x.amount,0);
        if(hospSlipList.length) combined.push({ date: hospSlipList[hospSlipList.length-1].date, remarks: `Total Temp Slips (${hospSlipList.length} slips)`, dr: 0, cr: totalSlipAmt, sortDate: hospSlipList[hospSlipList.length-1].date, badge: 'Temp Slips - Total', badgeColor: 'var(--accent)' });
        const totalDepAmt = depList.reduce((s,x)=>s+x.amount,0);
        if(depList.length) combined.push({ date: depList[depList.length-1].date, remarks: `Total Deposited to Muhasib (${depList.length} deposits)`, dr: 0, cr: totalDepAmt, sortDate: depList[depList.length-1].date, badge: 'Deposits - Total', badgeColor: 'var(--secondary)' });
        const totalAccAmt = accList.reduce((s,x)=>s+x.amount,0);
        if(accList.length) combined.push({ date: accList[accList.length-1].dateSent || accList[accList.length-1].date, remarks: `Total Sent To Accounts (${accList.length} entries)`, dr: 0, cr: totalAccAmt, sortDate: accList[accList.length-1].dateSent || accList[accList.length-1].date, badge: 'Accounts Dept - Total', badgeColor: 'var(--primary)' });
        combined.sort((a,b) => new Date(a.sortDate) - new Date(b.sortDate));
        let runningBal = app.state.openingHospitalCash;
        let totalDr = 0;
        let totalCr = 0;
        let rowsHtml = `<tr style="background:var(--bg-elevated); font-weight:700;"><td class="num-val" style="color:var(--text-muted);">-</td><td style="color:var(--text-main); font-weight:700;">Opening Balance (Hospital Cash)</td><td class="num-val text-right"></td><td class="num-val text-right"></td><td class="num-val text-right" style="color:var(--text-main); font-weight:700;">${app.ui.formatCurrency(runningBal)}</td></tr>`;
        combined.forEach(row => {
          if(row.dr) { totalDr += row.dr; runningBal += row.dr; }
          if(row.cr) { totalCr += row.cr; runningBal -= row.cr; }
          const drTxt = row.dr ? app.ui.formatCurrency(row.dr) : '-';
          const crTxt = row.cr ? app.ui.formatCurrency(row.cr) : '-';
          const badge = `<span class="source-tag" style="background:var(--bg-input);color:${row.badgeColor};border-color:${row.badgeColor};font-weight:700;">${row.badge}</span>`;
          rowsHtml += `<tr><td class="num-val" style="color:var(--text-muted); font-weight:600;">${app.ui.formatDate(row.date)}</td><td style="color:var(--text-main); font-weight:600;">${row.remarks} ${badge}</td><td class="num-val text-right ${row.dr?'text-success':''}" style="${!row.dr?'color:var(--text-muted);':''}">${drTxt}</td><td class="num-val text-right ${row.cr?'text-error':''}" style="${!row.cr?'color:var(--text-muted);':''}">${crTxt}</td><td class="num-val text-right" style="font-weight:700; color:var(--text-main);">${app.ui.formatCurrency(runningBal)}</td></tr>`;
        });
        if(!combined.length) rowsHtml += `<tr><td colspan="5" class="text-center text-muted" style="padding:20px; color:var(--text-muted);">No records in selected date range.</td></tr>`;
        const closingBal = app.state.openingHospitalCash + totalDr - totalCr;
        rowsHtml += `<tr class="total-row" style="font-weight:800; border-top:2px solid var(--border-color); background:var(--bg-elevated); color:var(--text-main);"><td colspan="2" style="color:var(--text-main); font-weight:800;">TOTAL</td><td class="num-val text-right text-success" style="font-weight:800;">${app.ui.formatCurrency(totalDr)}</td><td class="num-val text-right text-error" style="font-weight:800;">${app.ui.formatCurrency(totalCr)}</td><td class="num-val text-right" style="color:var(--primary); font-weight:800;">${app.ui.formatCurrency(closingBal)}</td></tr>`;
        bsPlaceholder.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:1rem; padding:1rem 0;">
            <div class="card" style="padding:0; overflow:hidden; border:1px solid var(--border-color);">
              <div style="padding:0.85rem 1.1rem; border-bottom:1px solid var(--border-color); font-weight:800; background:var(--bg-elevated); display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; color:var(--text-main);">
                <span style="color:var(--text-main); font-size:14px;">Hospital Cash Ledger</span><span style="font-size:12px; font-weight:600; color:var(--text-muted);">Dr = Collections &nbsp;|&nbsp; Cr = Bills / Slips / Deposits / Accounts &nbsp;|&nbsp; Balance = Running</span>
              </div>
              <div style="overflow-x:auto;">
                <table class="data-table"><thead><tr><th style="color:var(--text-muted);">Date</th><th style="color:var(--text-muted);">Particulars</th><th class="text-right" style="color:var(--text-muted);">Dr (Collection)</th><th class="text-right" style="color:var(--text-muted);">Cr (Expense/Deposit)</th><th class="text-right" style="color:var(--text-muted);">Balance</th></tr></thead><tbody>${rowsHtml}</tbody></table>
              </div>
            </div>
            <div class="card" style="padding:1rem 1.1rem; background:var(--bg-card); border:1px solid var(--border-color); display:flex; flex-wrap:wrap; gap:1.25rem; justify-content:space-between; font-weight:700; font-size:13px; color:var(--text-main);">
              <span>Opening: <strong style="color:var(--text-main);">${app.ui.formatCurrency(app.state.openingHospitalCash)}</strong></span>
              <span>Total Dr: <strong class="text-success">${app.ui.formatCurrency(totalDr)}</strong></span>
              <span>Total Cr: <strong class="text-error">${app.ui.formatCurrency(totalCr)}</strong></span>
              <span>Closing Balance: <strong style="color:var(--primary);">${app.ui.formatCurrency(closingBal)}</strong></span>
            </div>
          </div>
        `;
      } else if (type === 'balance_sheet') {
        titleDisplay.innerText = 'Cash Balance Sheet Statement';
        thead.classList.add('hidden');
        tbody.classList.add('hidden');
        bsPlaceholder.classList.remove('hidden');
        
        const statementRows = app.reports.generateBalanceSheetTableRows({
          startDate: startVal,
          endDate: endVal
        });

        bsPlaceholder.innerHTML = `
          <div class="balance-sheet-container" style="padding: 1rem 0; width: 100%;">
            <div class="balance-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin-bottom: 1.25rem;">
              
              <div class="card" style="padding: 14px; background: var(--bg-card); border: 1px solid var(--border-color);">
                <h3 style="font-size: 0.9rem; font-weight: 800; color: var(--text-main); border-bottom: 1px solid var(--border-color); padding-bottom: 6px; margin-bottom: 8px;">Cash Position</h3>
                <div class="balance-item" style="display:flex; justify-content:space-between; padding:5px 0; font-size:0.85rem;">
                  <span>Muhasib Cash Available</span>
                  <span class="num-val">${app.ui.formatCurrency(app.state.advanceCashAvailable)}</span>
                </div>
                <div class="balance-item border-bottom-subtle" style="display:flex; justify-content:space-between; padding:5px 0; font-size:0.85rem; border-bottom:1px dashed var(--border-color);">
                  <span>Hospital Cash Available</span>
                  <span class="num-val">${app.ui.formatCurrency(app.state.hospitalCashAvailable)}</span>
                </div>
                <div class="balance-item total-item" style="display:flex; justify-content:space-between; padding:7px 0 2px; font-size:0.95rem; font-weight:800; color:var(--primary);">
                  <span>Total Cash With Me</span>
                  <span class="num-val">${app.ui.formatCurrency(app.state.totalCashWithMe)}</span>
                </div>
              </div>

              <div class="card" style="padding: 14px; background: var(--bg-card); border: 1px solid var(--border-color);">
                <h3 style="font-size: 0.9rem; font-weight: 800; color: var(--text-main); border-bottom: 1px solid var(--border-color); padding-bottom: 6px; margin-bottom: 8px;">Bills Position</h3>
                <div class="balance-item" style="display:flex; justify-content:space-between; padding:5px 0; font-size:0.85rem;">
                  <span>Advance Bills Pending</span>
                  <span class="num-val">${app.ui.formatCurrency(app.state.advanceBillsPending)}</span>
                </div>
                <div class="balance-item border-bottom-subtle" style="display:flex; justify-content:space-between; padding:5px 0; font-size:0.85rem; border-bottom:1px dashed var(--border-color);">
                  <span>Hospital Bills Pending</span>
                  <span class="num-val">${app.ui.formatCurrency(app.state.hospitalBillsPending)}</span>
                </div>
                <div class="balance-item total-item" style="display:flex; justify-content:space-between; padding:7px 0 2px; font-size:0.95rem; font-weight:800; color:var(--warning);">
                  <span>Total Pending Bills</span>
                  <span class="num-val">${app.ui.formatCurrency(app.state.totalPendingBills)}</span>
                </div>
              </div>

              <div class="card" style="padding: 14px; background: var(--bg-card); border: 1px solid var(--border-color);">
                <h3 style="font-size: 0.9rem; font-weight: 800; color: var(--text-main); border-bottom: 1px solid var(--border-color); padding-bottom: 6px; margin-bottom: 8px;">Transfer Position</h3>
                <div class="balance-item" style="display:flex; justify-content:space-between; padding:5px 0; font-size:0.85rem;">
                  <span>Amanat Received</span>
                  <span class="num-val">${app.ui.formatCurrency(app.state.amanatReceived)}</span>
                </div>
                <div class="balance-item border-bottom-subtle" style="display:flex; justify-content:space-between; padding:5px 0; font-size:0.85rem; border-bottom:1px dashed var(--border-color);">
                  <span>Imprest Received</span>
                  <span class="num-val">${app.ui.formatCurrency(app.state.imprestReceived)}</span>
                </div>
                <div class="balance-item total-item" style="display:flex; justify-content:space-between; padding:7px 0 2px; font-size:0.95rem; font-weight:800; color:var(--secondary);">
                  <span>Total Transferred</span>
                  <span class="num-val">${app.ui.formatCurrency(app.state.totalTransferred)}</span>
                </div>
              </div>
            </div>

            </div>
          </div>
        `;
      }
    },

    /**
     * Export reports dynamically as Multi-Tab Excel Book.
     */
    exportToExcel() {
      if (typeof XLSX === 'undefined') {
        app.ui.showToast('Excel exporter library loading...', 'error');
        return;
      }

      const selType = document.getElementById('report-select-type') ? document.getElementById('report-select-type').value : '';
      const sVal = document.getElementById('report-date-start') ? document.getElementById('report-date-start').value : '';
      const eVal = document.getElementById('report-date-end') ? document.getElementById('report-date-end').value : '';
      const inRange = (d) => { if(!d) return true; if(sVal && d < sVal) return false; if(eVal && d > eVal) return false; return true; };
      if (selType === 'advance_bills') {
        const wbSingle = XLSX.utils.book_new();
        const rows = [
          ['Noor Hospital - Muhasib Cash Dr / Cr Ledger (Against Advance)'],
          ['Report Date Range', sVal || 'Start', 'to', eVal || 'End'],
          ['Generated On', new Date().toLocaleString('en-IN')],
          ['Opening Muhasib Cash Balance', app.state.openingAdvanceCash],
          [],
          ['Date', 'Particulars', 'Voucher Type', 'Dr - Cash In (₹)', 'Cr - Bill Expense (₹)', 'Balance (₹)']
        ];
        let bal = app.state.openingAdvanceCash;
        const comb = [];
        app.state.advanceCashEntries.filter(e=>inRange(e.date)).forEach(e=>comb.push({date:e.date, particulars:e.remarks||'-', vType:'Cash Received', dr:e.amount, cr:0}));
        app.state.bills.filter(b=>b.expenseType==='advance' && inRange(b.date)).forEach(b=>comb.push({date:b.date, particulars:`${b.vendor||'-'}${b.billNumber?' ('+b.billNumber+')':''}${b.category?' - '+b.category:''}`, vType:'Advance Bill', dr:0, cr:b.amount}));
        comb.sort((a,b)=> new Date(a.date)-new Date(b.date));
        rows.push(['', 'Opening Balance', '', '', '', bal]);
        comb.forEach(r=>{ if(r.dr) bal+=r.dr; if(r.cr) bal-=r.cr; rows.push([app.ui.formatDate(r.date), r.particulars, r.vType, r.dr||'', r.cr||'', bal]); });
        if(!comb.length) rows.push(['', 'No records in selected range', '', '', '', '']);
        const tDr = comb.reduce((s,r)=>s+r.dr,0);
        const tCr = comb.reduce((s,r)=>s+r.cr,0);
        rows.push([]);
        rows.push(['TOTAL', '', '', tDr, tCr, app.state.openingAdvanceCash + tDr - tCr]);
        const wsSingle = XLSX.utils.aoa_to_sheet(rows);
        wsSingle['!cols'] = [{wch:13},{wch:44},{wch:16},{wch:18},{wch:18},{wch:18}];
        wsSingle['!merges'] = [{s:{r:0,c:0},e:{r:0,c:5}}];
        wsSingle['!autofilter'] = { ref: `A6:F6` };
        wsSingle['!freeze'] = { xSplit: 0, ySplit: 6, topLeftCell: 'A7', activePane: 'bottomLeft' };
        const rangeS = XLSX.utils.decode_range(wsSingle['!ref']);
        for(let C=rangeS.s.c; C<=rangeS.e.c; ++C){ const addr = XLSX.utils.encode_cell({r:5,c:C}); if(wsSingle[addr]) wsSingle[addr].s = { font:{bold:true, color:{rgb:"FFFFFF"}}, fill:{fgColor:{rgb:"1F4E79"}}, alignment:{horizontal:"center", vertical:"center", wrapText:true}, border:{top:{style:"thin",color:{rgb:"000000"}},bottom:{style:"thin",color:{rgb:"000000"}},left:{style:"thin",color:{rgb:"000000"}},right:{style:"thin",color:{rgb:"000000"}}} }; }
        wsSingle['A1'].s = { font:{bold:true, sz:14, color:{rgb:"1F4E79"}}, alignment:{horizontal:"center", vertical:"center"} };
        XLSX.utils.book_append_sheet(wbSingle, wsSingle, 'Adv DrCr Ledger');
        XLSX.writeFile(wbSingle, `NoorHospital_Adv_DrCr_${sVal||'all'}_to_${eVal||'all'}.xlsx`);
        app.ui.showToast('Dr/Cr Advance Ledger exported (filtered).');
        return;
      }
      if (selType === 'hospital_combined') {
        const wbSingle = XLSX.utils.book_new();
        const rows = [
          ['Noor Hospital - Hospital Cash Ledger'],
          ['Report Date Range', sVal || 'Start', 'to', eVal || 'End'],
          ['Generated On', new Date().toLocaleString('en-IN')],
          ['Opening Hospital Cash Balance', app.state.openingHospitalCash],
          [],
          ['Date', 'Particulars', 'Voucher Type', 'Dr - Collection (₹)', 'Cr - Expense/Deposit (₹)', 'Balance (₹)']
        ];
        let bal = app.state.openingHospitalCash;
        const comb = [];
        const _hCash = app.state.hospitalCashEntries.filter(e=>inRange(e.date));
        if(_hCash.length) comb.push({date:_hCash[_hCash.length-1].date, particulars:`Total Cash Collection (${_hCash.length} entries)`, vType:'Cash Collection - Total', dr:_hCash.reduce((s,x)=>s+x.amount,0), cr:0});
        const _hBills = app.state.bills.filter(b=>b.expenseType==='hospital' && inRange(b.date));
        if(_hBills.length) comb.push({date:_hBills[_hBills.length-1].date, particulars:`Total Hospital Bills (${_hBills.length} bills)`, vType:'Hospital Bills - Total', dr:0, cr:_hBills.reduce((s,x)=>s+x.amount,0)});
        const _hSlips = app.getActiveTemporarySlips().filter(s=>s.expenseType==='hospital' && inRange(s.date));
        if(_hSlips.length) comb.push({date:_hSlips[_hSlips.length-1].date, particulars:`Total Active Temp Slips (${_hSlips.length} slips)`, vType:'Temp Slips - Total', dr:0, cr:_hSlips.reduce((s,x)=>s+x.amount,0)});
        const _hDeps = app.state.hospitalDeposits.filter(d=>inRange(d.date));
        if(_hDeps.length) comb.push({date:_hDeps[_hDeps.length-1].date, particulars:`Total Deposited to Muhasib (${_hDeps.length} deposits)`, vType:'Deposits - Total', dr:0, cr:_hDeps.reduce((s,x)=>s+x.amount,0)});
        const _inAccRange = (a) => { if (a.billType !== 'hospital') return false; const d = a.dateSent || a.date || ''; if(sVal && d < sVal) return false; if(eVal && d > eVal) return false; return true; };
        const _hAcc = app.state.accountsRegister.filter(a=>_inAccRange(a));
        if(_hAcc.length) comb.push({date:_hAcc[_hAcc.length-1].dateSent || _hAcc[_hAcc.length-1].date, particulars:`Total Sent To Accounts (${_hAcc.length} entries)`, vType:'Accounts Dept - Total', dr:0, cr:_hAcc.reduce((s,x)=>s+x.amount,0)});
        comb.sort((a,b)=> new Date(a.date)-new Date(b.date));
        rows.push(['', 'Opening Balance', '', '', '', bal]);
        comb.forEach(r=>{ if(r.dr) bal+=r.dr; if(r.cr) bal-=r.cr; rows.push([app.ui.formatDate(r.date), r.particulars, r.vType, r.dr||'', r.cr||'', bal]); });
        if(!comb.length) rows.push(['', 'No records in selected range', '', '', '', '']);
        const tDr = comb.reduce((s,r)=>s+r.dr,0);
        const tCr = comb.reduce((s,r)=>s+r.cr,0);
        rows.push([]);
        rows.push(['TOTAL', '', '', tDr, tCr, app.state.openingHospitalCash + tDr - tCr]);
        const wsSingle = XLSX.utils.aoa_to_sheet(rows);
        wsSingle['!cols'] = [{wch:13},{wch:44},{wch:18},{wch:18},{wch:18},{wch:18}];
        wsSingle['!merges'] = [{s:{r:0,c:0},e:{r:0,c:5}}];
        wsSingle['!autofilter'] = { ref: `A6:F6` };
        wsSingle['!freeze'] = { xSplit: 0, ySplit: 6, topLeftCell: 'A7', activePane: 'bottomLeft' };
        const rangeH = XLSX.utils.decode_range(wsSingle['!ref']);
        for(let C=rangeH.s.c; C<=rangeH.e.c; ++C){ const addr = XLSX.utils.encode_cell({r:5,c:C}); if(wsSingle[addr]) wsSingle[addr].s = { font:{bold:true, color:{rgb:"FFFFFF"}}, fill:{fgColor:{rgb:"1F4E79"}}, alignment:{horizontal:"center", vertical:"center", wrapText:true}, border:{top:{style:"thin",color:{rgb:"000000"}},bottom:{style:"thin",color:{rgb:"000000"}},left:{style:"thin",color:{rgb:"000000"}},right:{style:"thin",color:{rgb:"000000"}}} }; }
        wsSingle['A1'].s = { font:{bold:true, sz:14, color:{rgb:"1F4E79"}}, alignment:{horizontal:"center", vertical:"center"} };
        XLSX.utils.book_append_sheet(wbSingle, wsSingle, 'Hosp DrCr Ledger');
        XLSX.writeFile(wbSingle, `NoorHospital_Hosp_DrCr_${sVal||'all'}_to_${eVal||'all'}.xlsx`);
        app.ui.showToast('Dr/Cr Hospital Ledger exported (filtered).');
        return;
      }
      if(selType==='muhasib_bills' || selType==='hospital_bills' || selType==='bills'){
        const isMu=selType==='muhasib_bills', isHosp=selType==='hospital_bills';
        const filterBills = isMu ? app.state.bills.filter(b=>b.expenseType==='advance'&&inRange(b.date)) : isHosp ? app.state.bills.filter(b=>b.expenseType==='hospital'&&inRange(b.date)) : app.state.bills.filter(b=>inRange(b.date));
        const title = isMu ? 'Muhasib Bill Report' : isHosp ? 'Hospital Bill Report' : 'All Bills Report';
        const wbS=XLSX.utils.book_new();
        const rows=[ [title], ['Date Range', sVal||'Start','to',eVal||'End'], ['Generated On', new Date().toLocaleString('en-IN')], [], ['Date','Token No','Bill Number','Vendor','Amount','Category','Expense Type','Remarks'] ];
        filterBills.forEach(b=> rows.push([app.ui.formatDate(b.date), b.tokenNumber||'-', b.billNumber, b.vendor, b.amount, b.category, b.expenseType==='advance'?'Muhasib':'Hospital', b.remarks||'-']));
        if(!filterBills.length) rows.push(['No records in selected range','','','','','','','']);
        rows.push([]); rows.push(['Total Bills', filterBills.length, '', '', filterBills.reduce((s,b)=>s+b.amount,0)]);
        const ws=XLSX.utils.aoa_to_sheet(rows); ws['!cols']=[{wch:13},{wch:14},{wch:16},{wch:20},{wch:14},{wch:16},{wch:14},{wch:30}]; ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:7}}]; ws['A1'].s={font:{bold:true,sz:13,color:{rgb:"1F4E79"}},alignment:{horizontal:"center"}};
        XLSX.utils.book_append_sheet(wbS, ws, title.substring(0,31));
        XLSX.writeFile(wbS, `NoorHospital_${selType}_${sVal||'all'}_to_${eVal||'all'}.xlsx`);
        app.ui.showToast(title+' exported!');
        return;
      }
      const wb = XLSX.utils.book_new();

      // 1. Sheet: Dashboard Summary
      const dashRows = [
        ['Noor Hospital Cash Management System - Dashboard Overview'],
        ['Date Generated', app.ui.formatDate(new Date().toISOString().split('T')[0])],
        [],
        ['Indicator Title', 'Amount (₹)', 'Calculation Math / Description'],
        ['Muhasib Cash Available', app.state.advanceCashAvailable, 'Opening Advance + Advance Entries - Advance Expenses'],
        ['Hospital Cash Available', app.state.hospitalCashAvailable, 'Opening Hospital + Collections - Hospital Expenses - Deposits to Muhasib - Sent To Accounts (Hospital)'],
        ['Total Cash With Me', app.state.totalCashWithMe, 'Muhasib Cash Available + Hospital Cash Available'],
        [],
        ['Advance Bills Pending', app.state.advanceBillsPending, 'Advance Bills - Imprest Transfers'],
        ['Hospital Bills Pending', app.state.hospitalBillsPending, 'Hospital Bills - Amanat Transfers'],
        ['Total Pending Bills', app.state.totalPendingBills, 'Advance Bills Pending + Hospital Bills Pending'],
        [],
        ['Amanat Received', app.state.amanatReceived, 'Transferred / Settled Hospital Bills'],
        ['Imprest Received', app.state.imprestReceived, 'Transferred / Settled Advance Bills'],
        ['Total Transferred', app.state.totalTransferred, 'Amanat Received + Imprest Received'],
        [],
        ['Temporary Slips Pending Count', app.state.temporarySlipsPending, 'Emergency Slips awaiting final billing'],
        ['Temporary Slips Pending Amount', app.state.temporarySlipsPendingAmount, 'Emergency cash values outstanding']
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dashRows), 'Dashboard');

      // 2. Sheet: Muhasib Cash Ledger
      const advRows = [
        ['Muhasib Cash Ledger Inflows'],
        ['Opening Muhasib Cash Balance', app.state.openingAdvanceCash],
        [],
        ['Date', 'Cash Inflow Amount (₹)', 'Remarks', 'Running Balance']
      ];
      let runningAdv = app.state.openingAdvanceCash;
      [...app.state.advanceCashEntries].sort((a,b) => new Date(a.date) - new Date(b.date)).forEach(e => {
        runningAdv += e.amount;
        advRows.push([app.ui.formatDate(e.date), e.amount, e.remarks, runningAdv]);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(advRows), 'Muhasib Cash');

      // 3. Sheet: Hospital Cash Ledger
      const hospRows = [
        ['Hospital Cash collections Ledger'],
        ['Opening Hospital Cash Balance', app.state.openingHospitalCash],
        [],
        ['Date', 'Source Category', 'Collection Amount (₹)', 'Remarks', 'Running Balance']
      ];
      let runningHosp = app.state.openingHospitalCash;
      [...app.state.hospitalCashEntries].sort((a,b) => new Date(a.date) - new Date(b.date)).forEach(e => {
        runningHosp += e.amount;
        hospRows.push([app.ui.formatDate(e.date), e.source, e.amount, e.remarks, runningHosp]);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hospRows), 'Hospital Cash');

      // 4. Sheet: Temporary Slips
      const slipRows = [
        ['Temporary Slips Register'],
        [],
        ['Date', 'Vendor / Person', 'Amount (₹)', 'Expense Type', 'Status', 'Attachment Available', 'Attachment File Name', 'Remarks']
      ];
      app.state.temporarySlips.forEach(s => {
        const attachAvailable = s.attachmentUrl ? 'Yes' : 'No';
        const attachName = s.attachmentUrl ? (s.fileName || 'document') : '-';
        slipRows.push([
          app.ui.formatDate(s.date),
          s.vendor,
          s.amount,
          s.expenseType === 'advance' ? 'Muhasib Cash' : 'Hospital Cash',
          s.status,
          attachAvailable,
          attachName,
          s.remarks || ''
        ]);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(slipRows), 'Temporary Slips');

      // 5. Sheet: Bills
      const billRows = [
        ['Bills Register'],
        [],
        ['Date', 'Bill Number', 'Vendor Name', 'Amount (₹)', 'Expense Type', 'Category', 'Attachment Available', 'Attachment File Name', 'Remarks']
      ];
      app.state.bills.forEach(b => {
        const attachAvailable = b.attachmentUrl ? 'Yes' : 'No';
        const attachName = b.attachmentUrl ? (b.fileName || 'document') : '-';
        billRows.push([
          app.ui.formatDate(b.date),
          b.billNumber,
          b.vendor,
          b.amount,
          b.expenseType === 'advance' ? 'Muhasib Cash' : 'Hospital Cash',
          b.category,
          attachAvailable,
          attachName,
          b.remarks || ''
        ]);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(billRows), 'Bills');

      // 5.5 Sheet: Accounts Register
      const accRows = [
        ['Accounts Department Register'],
        [],
        ['Date Sent', 'Bill Type', 'Amount (₹)', 'Reference No', 'Remarks']
      ];
      app.state.accountsRegister.forEach(a => {
        accRows.push([
          app.ui.formatDate(a.dateSent),
          a.billType === 'advance' ? 'Muhasib Cash Bills' : 'Hospital Cash Bills',
          a.amount,
          a.referenceNo || '',
          a.remarks || ''
        ]);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(accRows), 'Accounts Register');

      // 6. Sheet: Transfers
      const transRows = [
        ['Verification & Transfers History'],
        [],
        ['Date', 'Transfer Type', 'Amount (₹)', 'Remarks']
      ];
      app.state.transfers.forEach(t => {
        transRows.push([app.ui.formatDate(t.date), t.type === 'imprest' ? 'Imprest Noor Hospital' : 'Amanat Noor Hospital', t.amount, t.remarks || '']);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(transRows), 'Transfers');

      // 7. Sheet: Balance Sheet
      const bsRows = [
        ['Noor Hospital Cash Balance Sheet Statement'],
        ['As of Date', app.ui.formatDate(new Date().toISOString().split('T')[0])],
        [],
        ['Section / Group', 'Item Name', 'Amount (₹)'],
        ['Cash Position', 'Muhasib Cash Available', app.state.advanceCashAvailable],
        ['Cash Position', 'Hospital Cash Available', app.state.hospitalCashAvailable],
        ['Cash Position', 'Total Cash With Me', app.state.totalCashWithMe],
        [],
        ['Bills Position', 'Advance Bills Pending', app.state.advanceBillsPending],
        ['Bills Position', 'Hospital Bills Pending', app.state.hospitalBillsPending],
        ['Bills Position', 'Total Pending Bills', app.state.totalPendingBills],
        [],
        ['Transfer Position', 'Amanat Received', app.state.amanatReceived],
        ['Transfer Position', 'Imprest Received', app.state.imprestReceived],
        ['Transfer Position', 'Total Transferred', app.state.totalTransferred]
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bsRows), 'Balance Sheet');

      // 8. Sheet: Hospital Deposits
      const depRows = [
        ['Hospital Cash Deposits to Muhasib Register'],
        [],
        ['Date', 'Receipt / Voucher No', 'Amount (₹)', 'Attachment Available', 'Attachment File Name', 'Remarks']
      ];
      app.state.hospitalDeposits.forEach(d => {
        const attachAvailable = d.attachmentUrl ? 'Yes' : 'No';
        const attachName = d.attachmentUrl ? (d.fileName || 'receipt') : '-';
        depRows.push([
          app.ui.formatDate(d.date),
          d.receiptNumber,
          d.amount,
          attachAvailable,
          attachName,
          d.remarks || ''
        ]);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(depRows), 'Hospital Deposits');

      const drCrRows = [
        ['Muhasib Cash - Dr / Cr Ledger (Against Muhasib Cash)'],
        ['Opening Muhasib Cash Balance', app.state.openingAdvanceCash],
        [],
        ['Date', 'Particulars', 'Voucher Type', 'Dr - Cash In (₹)', 'Cr - Bill Expense (₹)', 'Balance (₹)']
      ];
      let runningDrCr = app.state.openingAdvanceCash;
      const drCrCombined = [];
      app.state.advanceCashEntries.forEach(e => drCrCombined.push({ date: e.date, particulars: e.remarks || '-', vType: 'Cash Received', dr: e.amount, cr: 0 }));
      app.state.bills.filter(b => b.expenseType === 'advance').forEach(b => drCrCombined.push({ date: b.date, particulars: `${b.vendor || '-'}${b.billNumber ? ' ('+b.billNumber+')' : ''}${b.category ? ' - '+b.category : ''}`, vType: 'Advance Bill', dr: 0, cr: b.amount }));
      drCrCombined.sort((a,b) => new Date(a.date) - new Date(b.date));
      drCrCombined.forEach(r => {
        if (r.dr) runningDrCr += r.dr;
        if (r.cr) runningDrCr -= r.cr;
        drCrRows.push([app.ui.formatDate(r.date), r.particulars, r.vType, r.dr || '', r.cr || '', runningDrCr]);
      });
      const tDr = drCrCombined.reduce((s,r)=>s+r.dr,0);
      const tCr = drCrCombined.reduce((s,r)=>s+r.cr,0);
      drCrRows.push([]);
      drCrRows.push(['TOTAL', '', '', tDr, tCr, app.state.openingAdvanceCash + tDr - tCr]);
      const wsDrCr = XLSX.utils.aoa_to_sheet(drCrRows);
      wsDrCr['!cols'] = [{wch:13},{wch:44},{wch:16},{wch:18},{wch:18},{wch:18}];
      wsDrCr['!merges'] = [{s:{r:0,c:0},e:{r:0,c:5}}];
      wsDrCr['!autofilter'] = { ref: `A4:F4` };
      wsDrCr['!freeze'] = { xSplit: 0, ySplit: 4, topLeftCell: 'A5', activePane: 'bottomLeft' };
      try{ const rg = XLSX.utils.decode_range(wsDrCr['!ref']); for(let C=rg.s.c;C<=rg.e.c;++C){ const a=XLSX.utils.encode_cell({r:3,c:C}); if(wsDrCr[a]) wsDrCr[a].s={font:{bold:true,color:{rgb:"FFFFFF"}},fill:{fgColor:{rgb:"1F4E79"}},alignment:{horizontal:"center",vertical:"center",wrapText:true},border:{top:{style:"thin",color:{rgb:"000000"}},bottom:{style:"thin",color:{rgb:"000000"}},left:{style:"thin",color:{rgb:"000000"}},right:{style:"thin",color:{rgb:"000000"}}}}; } wsDrCr['A1'].s={font:{bold:true,sz:14,color:{rgb:"1F4E79"}},alignment:{horizontal:"center"}}; }catch(e){}
      XLSX.utils.book_append_sheet(wb, wsDrCr, 'Adv DrCr Ledger');

      // Trigger download
      XLSX.writeFile(wb, `NoorHospital_CashReport_${new Date().toISOString().split('T')[0]}.xlsx`);
      app.ui.showToast('Multi-sheet report downloaded.');
    },
    exportPage(page){
      if(typeof XLSX==='undefined'){ app.ui.showToast('Excel library loading...','error'); return; }
      const wb=XLSX.utils.book_new();
      let rows=[], sheetName=page, fileName=`NoorHospital_${page}_${new Date().toISOString().split('T')[0]}.xlsx`;
      const filtered=(list,pg)=>app.ui.getFiltered(list,pg);
      if(page==='advance'){
        const d=filtered(app.state.advanceCashEntries,'advance');
        rows=[['Muhasib Cash Ledger (Filtered)'],['Export Date',new Date().toLocaleString('en-IN')],['Total',d.reduce((s,e)=>s+e.amount,0),`Records: ${d.length}`],[],['Date','Amount (₹)','Remarks']];
        d.forEach(e=>rows.push([app.ui.formatDate(e.date),e.amount,e.remarks||'-']));
        if(!d.length) rows.push(['No records']);
        sheetName='Muhasib Cash';
      } else if(page==='hospital'){
        const d=filtered(app.state.hospitalCashEntries,'hospital');
        rows=[['Hospital Cash Collections (Filtered)'],['Export Date',new Date().toLocaleString('en-IN')],['Total',d.reduce((s,e)=>s+e.amount,0),`Records: ${d.length}`],[],['Date','Source','Amount (₹)','Remarks']];
        d.forEach(e=>rows.push([app.ui.formatDate(e.date),e.source,e.amount,e.remarks||'-']));
        if(!d.length) rows.push(['No records']);
        sheetName='Hospital Cash';
      } else if(page==='deposits'){
        const d=filtered(app.state.hospitalDeposits,'deposits');
        rows=[['Hospital Deposits (Filtered)'],['Export Date',new Date().toLocaleString('en-IN')],['Total',d.reduce((s,e)=>s+e.amount,0),`Records: ${d.length}`],[],['Date','Receipt No','Amount (₹)','Remarks']];
        d.forEach(e=>rows.push([app.ui.formatDate(e.date),e.receiptNumber,e.amount,e.remarks||'-']));
        sheetName='Deposits';
      } else if(page==='slips'){
        const d=filtered(app.getActiveTemporarySlips(),'slips');
        rows=[['Temporary Slips (Filtered)'],['Export Date',new Date().toLocaleString('en-IN')],['Total',d.reduce((s,e)=>s+e.amount,0),`Records: ${d.length}`],[],['Date','Token No','Vendor','Amount (₹)','Expense Type','Status','Remarks']];
        d.forEach(e=>rows.push([app.ui.formatDate(e.date),e.tokenNumber||'-',e.vendor,e.amount,e.expenseType,e.status,e.remarks||'-']));
        sheetName='Temp Slips';
      } else if(page==='advance-bills'){
        const d=filtered(app.state.bills,'advance-bills').filter(b=>b.expenseType==='advance');
        rows=[['Muhasib Bills (Advance) (Filtered)'],['Export Date',new Date().toLocaleString('en-IN')],['Total',d.reduce((s,e)=>s+e.amount,0),`Records: ${d.length}`],[],['Date','Token No','Bill No','Vendor','Amount (₹)','Category','Remarks']];
        d.forEach(e=>rows.push([app.ui.formatDate(e.date),e.tokenNumber||'-',e.billNumber,e.vendor,e.amount,e.category,e.remarks||'-']));
        sheetName='Muhasib Bills';
      } else if(page==='bills'){
        const d=filtered(app.state.bills,'bills').filter(b=>b.expenseType==='hospital');
        rows=[['Hospital Bills (Filtered)'],['Export Date',new Date().toLocaleString('en-IN')],['Total',d.reduce((s,e)=>s+e.amount,0),`Records: ${d.length}`],[],['Date','Token No','Bill No','Vendor','Amount (₹)','Category','Remarks']];
        d.forEach(e=>rows.push([app.ui.formatDate(e.date),e.tokenNumber||'-',e.billNumber,e.vendor,e.amount,e.category,e.remarks||'-']));
        sheetName='Hospital Bills';
      } else if(page==='accounts'){
        const d=filtered(app.state.accountsRegister,'accounts');
        rows=[['Accounts Register (Filtered)'],['Export Date',new Date().toLocaleString('en-IN')],['Total',d.reduce((s,e)=>s+e.amount,0),`Records: ${d.length}`],[],['Date Sent','Bill Type','Amount (₹)','Reference No','Remarks']];
        d.forEach(e=>rows.push([app.ui.formatDate(e.dateSent),e.billType,e.amount,e.referenceNo||'-',e.remarks||'-']));
        sheetName='Accounts';
      } else if(page==='transfers'){
        const d=filtered(app.state.transfers,'transfers');
        rows=[['Transfers (Filtered)'],['Export Date',new Date().toLocaleString('en-IN')],['Total',d.reduce((s,e)=>s+e.amount,0),`Records: ${d.length}`],[],['Date','Type','Amount (₹)','Remarks']];
        d.forEach(e=>rows.push([app.ui.formatDate(e.date),e.type,e.amount,e.remarks||'-']));
        sheetName='Transfers';
      }
      const ws=XLSX.utils.aoa_to_sheet(rows);
      ws['!cols']=rows[4]?rows[4].map(()=>({wch:18})): [{wch:18}];
      XLSX.utils.book_append_sheet(wb,ws,sheetName);
      XLSX.writeFile(wb,fileName);
      app.ui.showToast(`${sheetName} exported (${rows.length-5} rows)`);
    },

    _previewHtml: '',

    /**
     * Prints an HTML document using a hidden iframe.
     * Bypasses mobile popup blockers (iOS Safari, Android Chrome) and directly triggers
     * the system native print sheet / Save as PDF.
     */
    _printHtmlViaIframe(html) {
      if (!html) return;

      // Check if user is on iOS / Safari mobile
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      // Method A: Direct window print attempt if opened via direct preview tab
      let printSuccess = false;

      // Method B: Blob URL window for mobile devices (avoids iframe restrictions in Safari/Chrome Mobile)
      if (isIOS) {
        try {
          const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
          const blobUrl = URL.createObjectURL(blob);
          const printWindow = window.open(blobUrl, '_blank');
          if (printWindow) {
            printWindow.focus();
            setTimeout(() => {
              try {
                printWindow.print();
              } catch (e) {
                console.warn('Direct blob window print failed:', e);
              }
            }, 600);
            return;
          }
        } catch (e) {
          console.warn('Blob window creation failed:', e);
        }
      }

      // Method C: Robust hidden iframe with onload handler
      try {
        let iframe = document.getElementById('nh-report-print-frame');
        if (iframe) {
          try { iframe.remove(); } catch (_) {}
        }
        iframe = document.createElement('iframe');
        iframe.id = 'nh-report-print-frame';
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '10px';
        iframe.style.height = '10px';
        iframe.style.opacity = '0.01';
        iframe.style.border = '0';
        iframe.style.pointerEvents = 'none';
        iframe.title = 'Noor Hospital Report Print Frame';
        document.body.appendChild(iframe);

        const frameDoc = iframe.contentWindow.document;
        frameDoc.open();
        frameDoc.write(html);
        frameDoc.close();

        const triggerPrint = () => {
          if (printSuccess) return;
          printSuccess = true;
          try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
          } catch (err) {
            console.warn('Iframe print call failed, falling back to window.open:', err);
            try {
              const pWin = window.open('', '_blank');
              if (pWin) {
                pWin.document.write(html);
                pWin.document.close();
                pWin.focus();
                setTimeout(() => { pWin.print(); }, 400);
              } else {
                window.print();
              }
            } catch (_) {
              window.print();
            }
          }
        };

        iframe.onload = () => {
          setTimeout(triggerPrint, 300);
        };

        // Safety fallback timer
        setTimeout(triggerPrint, 600);
      } catch (err) {
        console.warn('Iframe print error, falling back to window.print():', err);
        window.print();
      }
    },

    /**
     * Generates a complete standalone printable/saveable HTML document for current report.
     */
    generateCurrentReportHtml() {
      const titleEl = document.getElementById('report-title-display');
      const metaEl = document.getElementById('report-meta-display');
      const container = document.getElementById('report-display-container');
      const title = titleEl ? titleEl.innerText : 'Report';
      const printTitle = title === 'Muhasib Cash + Advance Bills Report (Against Muhasib Cash)' ? 'Muhasib Adv Report' : title;
      const meta = metaEl ? metaEl.innerText : '';
      const now = new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' });
      const content = container ? container.innerHTML : '';
      const printContent = printTitle !== title ? content.split(title).join(printTitle) : content;
      const reportRef = 'NH-AUD-' + Date.now().toString().slice(-6);

      const styleBlock = `
        @page { size: A4 portrait; margin: 10mm 12mm 12mm 12mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        body { font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; background: #fff; font-size: 10.5px; line-height: 1.4; padding: 14px; }
        .hospital-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 12px; }
        .brand-left { display: flex; gap: 10px; align-items: center; }
        .hospital-emblem { width: 42px; height: 42px; border-radius: 8px; background: #0f172a; color: #38bdf8; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 20px; border: 1px solid #1e293b; }
        .brand-info h1 { font-size: 17px; font-weight: 900; color: #0f172a; letter-spacing: -0.01em; margin-bottom: 2px; text-transform: uppercase; }
        .brand-info .sub-dept { font-size: 9px; font-weight: 700; letter-spacing: 0.08em; color: #0284c7; text-transform: uppercase; }
        .brand-info .address { font-size: 8.5px; color: #64748b; margin-top: 1px; }
        .brand-right { text-align: right; font-size: 8.5px; color: #475569; }
        .voucher-pill { display: inline-block; padding: 3px 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 8.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; background: #f8fafc; color: #0f172a; margin-bottom: 4px; }
        .statement-meta-bar { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; margin-bottom: 14px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
        .meta-item { display: flex; flex-direction: column; gap: 2px; }
        .meta-label { font-size: 7.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
        .meta-val { font-size: 10px; font-weight: 700; color: #0f172a; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 9.5px; }
        thead th { background: #0f172a !important; color: #ffffff !important; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; font-size: 8px; padding: 6px 8px; border: 1px solid #0f172a; text-align: left; }
        tbody tr:nth-child(even) { background: #f8fafc; }
        tbody td { border: 1px solid #e2e8f0; padding: 5px 8px; vertical-align: middle; color: #1e293b; }
        .text-right { text-align: right; font-family: 'JetBrains Mono', SFMono-Regular, Consolas, monospace; font-variant-numeric: tabular-nums; font-weight: 600; }
        .source-tag { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 7.5px; font-weight: 700; border: 1px solid #cbd5e1; background: #f1f5f9; color: #334155; }
        .status-pill { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 7.5px; font-weight: 700; }
        .status-pill.verified { background: #ecfdf5; color: #059669; }
        .status-pill.pending { background: #fffbeb; color: #d97706; }
        .text-success { color: #059669 !important; }
        .text-error { color: #dc2626 !important; }
        .text-warning { color: #d97706 !important; }
        .text-muted { color: #64748b !important; }
        .audit-signatures { margin-top: 24px; padding-top: 10px; border-top: 1px solid #e2e8f0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; page-break-inside: avoid; }
        .sig-col { display: flex; flex-direction: column; align-items: center; text-align: center; }
        .sig-line { width: 80%; border-bottom: 1.5px solid #0f172a; height: 32px; margin-bottom: 5px; }
        .sig-title { font-size: 9px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.03em; }
        .sig-sub { font-size: 7.5px; color: #64748b; margin-top: 1px; }
        .report-footer { margin-top: 18px; border-top: 1px dashed #cbd5e1; padding-top: 6px; display: flex; justify-content: space-between; font-size: 7.5px; color: #94a3b8; }
        .report-header-preview { display: none !important; }
        .hidden { display: none !important; }
        @media print { body { padding: 0; } }
      `;

      const documentBody = `
        <div class="hospital-header">
          <div class="brand-left">
            <div class="hospital-emblem">+</div>
            <div class="brand-info">
              <h1>Noor Hospital</h1>
              <div class="sub-dept">Treasury & Accounts Reconciliation Division</div>
              <div class="address">Qadian, Punjab • Internal Financial Control & Audit</div>
            </div>
          </div>
          <div class="brand-right">
            <div class="voucher-pill">Official Ledger Voucher</div>
            <div><strong>Ref:</strong> ${reportRef}</div>
            <div><strong>Status:</strong> System Verified</div>
          </div>
        </div>

        <div class="statement-meta-bar">
          <div class="meta-item">
            <span class="meta-label">Document Title</span>
            <span class="meta-val">${printTitle}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Period / Filter</span>
            <span class="meta-val">${meta || 'Complete Ledger Records'}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Generated Timestamp</span>
            <span class="meta-val">${now}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Reporting Incharge</span>
            <span class="meta-val">Treasury Muhasib</span>
          </div>
        </div>

        <div class="report-content-body">
          ${printContent}
        </div>

        <div class="audit-signatures">
          <div class="sig-col">
            <div class="sig-line"></div>
            <div class="sig-title">Prepared By</div>
            <div class="sig-sub">Cashier / Muhasib Incharge</div>
          </div>
          <div class="sig-col">
            <div class="sig-line"></div>
            <div class="sig-title">Verified By</div>
            <div class="sig-sub">Internal Accounts Officer</div>
          </div>
          <div class="sig-col">
            <div class="sig-line"></div>
            <div class="sig-title">Approved By</div>
            <div class="sig-sub">Medical Superintendent / Director</div>
          </div>
        </div>

        <div class="report-footer">
          <span>Confidential — Internal Noor Hospital Financial Record. Unauthorized duplication is strictly prohibited.</span>
          <span>NH-CMS v2.4 • Offline Reconciled</span>
        </div>
      `;

      return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Noor Hospital - ${printTitle}</title><style>${styleBlock}</style></head><body>${documentBody}</body></html>`;
    },

    printCurrentReport() {
      const html = app.reports.generateCurrentReportHtml();
      app.reports._previewHtml = html;
      if (!html) {
        app.ui.showToast('No report content to print.', 'warning');
        return;
      }
      app.reports._printHtmlViaIframe(html);
    },

    doPrintFromPreview() {
      const html = app.reports._previewHtml || app.reports.generateCurrentReportHtml();
      if (!html) {
        app.ui.showToast('No report content to print.', 'warning');
        return;
      }
      app.reports._printHtmlViaIframe(html);
    },

    /**
     * Direct file download for reports. Saves standalone HTML file that can be opened
     * in any browser on mobile/desktop and saved to PDF or shared via WhatsApp/email.
     */
    downloadReportPdfFile(htmlContent, customName) {
      let html = htmlContent || app.reports._previewHtml;
      if (!html) {
        html = app.reports.generateCurrentReportHtml();
      }
      if (!html) {
        app.ui.showToast('No report content available to save.', 'warning');
        return;
      }
      const titleEl = document.getElementById('report-title-display');
      const baseName = (customName || (titleEl ? titleEl.innerText : 'Financial_Report')).replace(/[^a-zA-Z0-9_-]/g, '_');
      const dateStamp = new Date().toISOString().split('T')[0];
      const fileName = `NoorHospital_${baseName}_${dateStamp}.html`;

      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 200);
      app.ui.showToast(`Report saved as "${fileName}". Open to print or save as PDF!`, 'success');
    },

    /**
     * Generates a complete standalone printable/saveable HTML document for Cash Balance Sheet Statement.
     * Strictly matches what is shown on screen in the Cash Position Balance Sheet (nothing extra).
     */
    generateBalanceSheetPrintHtml() {
      const now = new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' });
      const todayDate = app.ui.formatDate(new Date().toISOString().split('T')[0]);
      const reportRef = 'NH-BS-' + Date.now().toString().slice(-6);

      const styleBlock = `
        @page { size: A4 portrait; margin: 12mm 14mm 12mm 14mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        body { font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; background: #fff; font-size: 11px; line-height: 1.4; padding: 12px; }
        .hospital-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 14px; }
        .brand-left { display: flex; gap: 10px; align-items: center; }
        .hospital-emblem { width: 44px; height: 44px; border-radius: 8px; background: #0f172a; color: #38bdf8; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 22px; border: 1px solid #1e293b; }
        .brand-info h1 { font-size: 18px; font-weight: 900; color: #0f172a; letter-spacing: -0.01em; margin-bottom: 2px; text-transform: uppercase; }
        .brand-info .sub-dept { font-size: 9.5px; font-weight: 700; letter-spacing: 0.08em; color: #0284c7; text-transform: uppercase; }
        .brand-info .address { font-size: 9px; color: #64748b; margin-top: 1px; }
        .brand-right { text-align: right; font-size: 9px; color: #475569; }
        .voucher-pill { display: inline-block; padding: 3px 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; background: #f8fafc; color: #0f172a; margin-bottom: 4px; }
        .statement-meta-bar { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; margin-bottom: 14px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
        .meta-item { display: flex; flex-direction: column; gap: 2px; }
        .meta-label { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
        .meta-val { font-size: 11px; font-weight: 700; color: #0f172a; }
        .bs-summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
        .bs-summary-card { border: 1.5px solid #cbd5e1; background: #f8fafc; border-radius: 8px; padding: 10px 12px; }
        .bs-summary-card h4 { font-size: 11px; font-weight: 800; color: #0f172a; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 5px; margin-bottom: 8px; text-transform: uppercase; }
        .bs-summary-card .row { display: flex; justify-content: space-between; font-size: 9.5px; margin-bottom: 5px; color: #334155; }
        .bs-summary-card .row .num-val { font-family: 'JetBrains Mono', monospace; font-weight: 700; }
        .bs-summary-card .row.total { font-weight: 800; font-size: 11px; border-top: 1.5px dashed #cbd5e1; padding-top: 6px; margin-top: 6px; color: #0284c7; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 10px; }
        thead th { background: #0f172a !important; color: #ffffff !important; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; font-size: 9px; padding: 8px 10px; border: 1px solid #0f172a; text-align: left; }
        tbody tr:nth-child(even) { background: #f8fafc; }
        tbody td { border: 1px solid #e2e8f0; padding: 7px 10px; vertical-align: middle; color: #1e293b; }
        .text-right { text-align: right; font-family: 'JetBrains Mono', SFMono-Regular, Consolas, monospace; font-variant-numeric: tabular-nums; font-weight: 600; }
        .text-success { color: #059669 !important; font-weight: 700; }
        .text-error { color: #dc2626 !important; font-weight: 700; }
        .text-warning { color: #d97706 !important; font-weight: 700; }
        .audit-signatures { margin-top: 30px; padding-top: 12px; border-top: 1px solid #e2e8f0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; page-break-inside: avoid; }
        .sig-col { display: flex; flex-direction: column; align-items: center; text-align: center; }
        .sig-line { width: 80%; border-bottom: 1.5px solid #0f172a; height: 36px; margin-bottom: 6px; }
        .sig-title { font-size: 9.5px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.03em; }
        .sig-sub { font-size: 8px; color: #64748b; margin-top: 2px; }
        .report-footer { margin-top: 22px; border-top: 1px dashed #cbd5e1; padding-top: 6px; display: flex; justify-content: space-between; font-size: 8px; color: #94a3b8; }
        @media print { body { padding: 0; } }
      `;

      return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Noor Hospital - Cash Balance Sheet Statement</title><style>${styleBlock}</style></head><body>
        <div class="hospital-header">
          <div class="brand-left">
            <div class="hospital-emblem">+</div>
            <div class="brand-info">
              <h1>Noor Hospital</h1>
              <div class="sub-dept">Treasury & Financial Audit Reconciliation Division</div>
              <div class="address">Qadian, Punjab • Cash Position Balance Sheet Statement</div>
            </div>
          </div>
          <div class="brand-right">
            <div class="voucher-pill">Audit Balance Sheet</div>
            <div><strong>Ref:</strong> ${reportRef}</div>
            <div><strong>Status:</strong> Reconciled & Verified</div>
          </div>
        </div>

        <div class="statement-meta-bar">
          <div class="meta-item">
            <span class="meta-label">Document Type</span>
            <span class="meta-val">Cash Position Balance Sheet</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">As On Date</span>
            <span class="meta-val">${todayDate}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Generated Timestamp</span>
            <span class="meta-val">${now}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Authorized Signatory</span>
            <span class="meta-val">Treasury Muhasib Incharge</span>
          </div>
        </div>

        <div class="bs-summary-grid">
          <div class="bs-summary-card">
            <h4>Cash Position</h4>
            <div class="row"><span>Muhasib Cash Float:</span><span class="num-val">${app.ui.formatCurrency(app.state.advanceCashAvailable)}</span></div>
            <div class="row"><span>Hospital Cash Collections:</span><span class="num-val">${app.ui.formatCurrency(app.state.hospitalCashAvailable)}</span></div>
            <div class="row total"><span>Total Cash With Me:</span><span class="num-val">${app.ui.formatCurrency(app.state.totalCashWithMe)}</span></div>
          </div>
          <div class="bs-summary-card">
            <h4>Bills Position</h4>
            <div class="row"><span>Advance Bills Pending:</span><span class="num-val">${app.ui.formatCurrency(app.state.advanceBillsPending)}</span></div>
            <div class="row"><span>Hospital Bills Pending:</span><span class="num-val">${app.ui.formatCurrency(app.state.hospitalBillsPending)}</span></div>
            <div class="row total" style="color:#d97706;"><span>Total Pending Bills:</span><span class="num-val">${app.ui.formatCurrency(app.state.totalPendingBills)}</span></div>
          </div>
          <div class="bs-summary-card">
            <h4>Transfer Position</h4>
            <div class="row"><span>Amanat Received:</span><span class="num-val">${app.ui.formatCurrency(app.state.amanatReceived)}</span></div>
            <div class="row"><span>Imprest Received:</span><span class="num-val">${app.ui.formatCurrency(app.state.imprestReceived)}</span></div>
            <div class="row total" style="color:#4f46e5;"><span>Total Settled:</span><span class="num-val">${app.ui.formatCurrency(app.state.totalTransferred)}</span></div>
          </div>
        </div>

        <table class="data-table" style="margin-top:10px;">
          <thead>
            <tr>
              <th style="width:32%;">Position Category</th>
              <th style="width:42%;">Treasury Metric / Register Breakdown</th>
              <th class="text-right" style="width:26%;">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            <!-- 1. Cash Position -->
            <tr style="background:#f8fafc; font-weight:800;">
              <td rowspan="3" style="vertical-align:middle; font-weight:800; border-right:1.5px solid #cbd5e1; background:#f8fafc; color:#0284c7; font-size:10.5px;">
                1. CASH IN HAND<br><span style="font-size:8px; font-weight:600; color:#64748b;">Physical Cash Float & Collections</span>
              </td>
              <td style="color:#334155; font-weight:600;">Muhasib Cash Float (Available in Hand)</td>
              <td class="text-right" style="font-weight:700;">${app.ui.formatCurrency(app.state.advanceCashAvailable)}</td>
            </tr>
            <tr style="background:#fff;">
              <td style="color:#334155; font-weight:600;">Hospital Cash Collections (Counter Cash in Hand)</td>
              <td class="text-right" style="font-weight:700;">${app.ui.formatCurrency(app.state.hospitalCashAvailable)}</td>
            </tr>
            <tr style="background:#f0fdfa; font-weight:800; border-top:1px dashed #cbd5e1;">
              <td style="color:#0f766e;">TOTAL CASH WITH ME</td>
              <td class="text-right text-success" style="font-size:11px; font-weight:800;">${app.ui.formatCurrency(app.state.totalCashWithMe)}</td>
            </tr>

            <!-- 2. Bills Position -->
            <tr style="background:#f8fafc; font-weight:800;">
              <td rowspan="3" style="vertical-align:middle; font-weight:800; border-right:1.5px solid #cbd5e1; background:#f8fafc; color:#d97706; font-size:10.5px;">
                2. BILLS POSITION<br><span style="font-size:8px; font-weight:600; color:#64748b;">Pending Verification & Settlement</span>
              </td>
              <td style="color:#334155; font-weight:600;">Advance / Muhasib Bills Pending</td>
              <td class="text-right" style="font-weight:700;">${app.ui.formatCurrency(app.state.advanceBillsPending)}</td>
            </tr>
            <tr style="background:#fff;">
              <td style="color:#334155; font-weight:600;">Hospital Purchase Bills Pending</td>
              <td class="text-right" style="font-weight:700;">${app.ui.formatCurrency(app.state.hospitalBillsPending)}</td>
            </tr>
            <tr style="background:#fffbeb; font-weight:800; border-top:1px dashed #cbd5e1;">
              <td style="color:#b45309;">TOTAL PENDING BILLS</td>
              <td class="text-right text-warning" style="font-size:11px; font-weight:800;">${app.ui.formatCurrency(app.state.totalPendingBills)}</td>
            </tr>

            <!-- 3. Transfer Position -->
            <tr style="background:#f8fafc; font-weight:800;">
              <td rowspan="3" style="vertical-align:middle; font-weight:800; border-right:1.5px solid #cbd5e1; background:#f8fafc; color:#4f46e5; font-size:10.5px;">
                3. SETTLEMENT POSITION<br><span style="font-size:8px; font-weight:600; color:#64748b;">Verified Internal Transfers</span>
              </td>
              <td style="color:#334155; font-weight:600;">Amanat Received (Hospital Collections Settled)</td>
              <td class="text-right" style="font-weight:700;">${app.ui.formatCurrency(app.state.amanatReceived)}</td>
            </tr>
            <tr style="background:#fff;">
              <td style="color:#334155; font-weight:600;">Imprest Received (Advance Float Recouped)</td>
              <td class="text-right" style="font-weight:700;">${app.ui.formatCurrency(app.state.imprestReceived)}</td>
            </tr>
            <tr style="background:#eef2ff; font-weight:800; border-top:1px dashed #cbd5e1;">
              <td style="color:#4338ca;">TOTAL SETTLED BY TRANSFERS</td>
              <td class="text-right" style="color:#4338ca; font-size:11px; font-weight:800;">${app.ui.formatCurrency(app.state.totalTransferred)}</td>
            </tr>

            <!-- Summary Footprint -->
            <tr style="background:#0f172a; color:#ffffff; font-weight:800; font-size:11px;">
              <td colspan="2" style="color:#ffffff; padding:10px 12px;">NET CASH BALANCE (Total Cash With Me - Pending Bills)</td>
              <td class="text-right" style="color:#38bdf8; font-size:13px; font-weight:800; padding:10px 12px;">${app.ui.formatCurrency(app.state.totalCashWithMe - app.state.totalPendingBills)}</td>
            </tr>
          </tbody>
        </table>

        <div class="audit-signatures">
          <div class="sig-col">
            <div class="sig-line"></div>
            <div class="sig-title">Prepared By</div>
            <div class="sig-sub">Cashier / Muhasib Incharge</div>
          </div>
          <div class="sig-col">
            <div class="sig-line"></div>
            <div class="sig-title">Verified By</div>
            <div class="sig-sub">Internal Accounts Officer</div>
          </div>
          <div class="sig-col">
            <div class="sig-line"></div>
            <div class="sig-title">Approved By</div>
            <div class="sig-sub">Medical Superintendent / Director</div>
          </div>
        </div>

        <div class="report-footer">
          <span>Official Treasury Statement • Confidential Noor Hospital Financial Record</span>
          <span>NH-CMS v2.4 • System Reconciled</span>
        </div>
      </body></html>`;
    },

    printCurrentReport() {
      const html = app.reports.generateCurrentReportHtml();
      app.reports._previewHtml = html;
      if (!html) {
        app.ui.showToast('No report content to print.', 'warning');
        return;
      }
      app.reports._printHtmlViaIframe(html);
    },

    printBalanceSheetStatement() {
      const html = app.reports.generateBalanceSheetPrintHtml();
      app.reports._previewHtml = html;
      if (!html) {
        app.ui.showToast('No balance sheet content to print.', 'warning');
        return;
      }
      app.reports._printHtmlViaIframe(html);
    },

    downloadBalanceSheetFile() {
      const html = app.reports.generateBalanceSheetPrintHtml();
      app.reports.downloadReportPdfFile(html, 'Cash_Balance_Sheet_Audit_Statement');
    },

    exportBalanceSheetExcel() {
      if (typeof XLSX === 'undefined') {
        app.ui.showToast('Excel exporter library loading...', 'error');
        return;
      }

      const wb = XLSX.utils.book_new();
      const dateStr = app.ui.formatDate(new Date().toISOString().split('T')[0]);
      const nowStr = new Date().toLocaleString('en-IN');

      const rows = [
        ['Noor Hospital - Comprehensive Cash Balance Sheet Statement'],
        ['As on Date', dateStr],
        ['Generated On', nowStr],
        [],
        ['1. TREASURY SUMMARY POSITION'],
        ['Category', 'Metric', 'Amount (₹)'],
        ['Cash Position', 'Muhasib Cash Available in Hand', app.state.advanceCashAvailable || 0],
        ['Cash Position', 'Hospital Cash Collections in Hand', app.state.hospitalCashAvailable || 0],
        ['Cash Position', 'Total Cash With Me', app.state.totalCashWithMe || 0],
        ['Bills Position', 'Advance Bills Pending Settlement', app.state.advanceBillsPending || 0],
        ['Bills Position', 'Hospital Bills Pending Settlement', app.state.hospitalBillsPending || 0],
        ['Bills Position', 'Total Pending Bills', app.state.totalPendingBills || 0],
        ['Settlement Position', 'Amanat Received (Hospital)', app.state.amanatReceived || 0],
        ['Settlement Position', 'Imprest Received (Advance)', app.state.imprestReceived || 0],
        ['Settlement Position', 'Total Settled by Transfers', app.state.totalTransferred || 0],
        [],
        ['2. DETAILED STATEMENT OF CASH FLOWS & RECONCILIATION'],
        ['Section', 'Accounting Particulars', 'Category / Store', 'Inflow Dr (+) (₹)', 'Outflow Cr (-) (₹)', 'Net Balance (₹)']
      ];

      // Part I Inflows
      rows.push(['PART I: INFLOWS', 'Opening Muhasib Cash Float', 'Opening Float', app.state.openingAdvanceCash || 0, '', '']);
      rows.push(['PART I: INFLOWS', 'Opening Hospital Cash Float', 'Opening Float', app.state.openingHospitalCash || 0, '', '']);
      
      (app.state.hospitalCashEntries || []).forEach(e => {
        rows.push(['PART I: INFLOWS', `Hospital Collection: ${e.remarks || 'Daily collections'}`, e.source || 'Hospital', e.amount || 0, '', '']);
      });
      const subtotalHosp = (app.state.hospitalCashEntries || []).reduce((s,e) => s + (e.amount || 0), 0);
      rows.push(['PART I: INFLOWS', 'Subtotal: Hospital Collections', '', subtotalHosp, '', '']);

      (app.state.advanceCashEntries || []).forEach(e => {
        rows.push(['PART I: INFLOWS', `Muhasib Float Addition: ${e.remarks || 'Cash Float'}`, 'Muhasib Float', e.amount || 0, '', '']);
      });
      const subtotalAdv = (app.state.advanceCashEntries || []).reduce((s,e) => s + (e.amount || 0), 0);
      rows.push(['PART I: INFLOWS', 'Subtotal: Muhasib Float Additions', '', subtotalAdv, '', '']);

      const totalInflows = (app.state.openingAdvanceCash || 0) + (app.state.openingHospitalCash || 0) + subtotalHosp + subtotalAdv;
      rows.push(['PART I: INFLOWS', 'TOTAL GROSS CASH INFLOWS (A)', '', totalInflows, '', '']);
      rows.push([]);

      // Part II Outflows
      const hospBills = (app.state.bills || []).filter(b => b.expenseType === 'hospital');
      hospBills.forEach(b => {
        rows.push(['PART II: OUTFLOWS', `Hospital Bill #${b.billNumber || '-'}: ${b.vendor || '-'}`, b.category || 'Hospital', '', b.amount || 0, '']);
      });
      const subtotalHospBills = hospBills.reduce((s,b) => s + (b.amount || 0), 0);
      rows.push(['PART II: OUTFLOWS', 'Subtotal: Hospital Bills Paid', '', '', subtotalHospBills, '']);

      const advBills = (app.state.bills || []).filter(b => b.expenseType === 'advance');
      advBills.forEach(b => {
        rows.push(['PART II: OUTFLOWS', `Muhasib Bill #${b.billNumber || '-'}: ${b.vendor || '-'}`, b.category || 'Advance', '', b.amount || 0, '']);
      });
      const subtotalAdvBills = advBills.reduce((s,b) => s + (b.amount || 0), 0);
      rows.push(['PART II: OUTFLOWS', 'Subtotal: Muhasib Bills Paid', '', '', subtotalAdvBills, '']);

      const activeSlips = app.getActiveTemporarySlips();
      activeSlips.forEach(s => {
        rows.push(['PART II: OUTFLOWS', `Active Temp Slip #${s.slipNumber || '-'}: ${s.vendor || '-'}`, s.expenseType === 'advance' ? 'Adv Slip' : 'Hosp Slip', '', s.amount || 0, '']);
      });
      const subtotalSlips = activeSlips.reduce((s,sItem) => s + (sItem.amount || 0), 0);
      rows.push(['PART II: OUTFLOWS', 'Subtotal: Active Temporary Slips', '', '', subtotalSlips, '']);

      (app.state.hospitalDeposits || []).forEach(d => {
        rows.push(['PART II: OUTFLOWS', `Deposit to Muhasib: Rcpt #${d.receiptNumber || '-'}`, 'Muhasib Remittance', '', d.amount || 0, '']);
      });
      const subtotalDeps = (app.state.hospitalDeposits || []).reduce((s,d) => s + (d.amount || 0), 0);
      rows.push(['PART II: OUTFLOWS', 'Subtotal: Deposits to Muhasib', '', '', subtotalDeps, '']);

      const accHospital = (app.state.accountsRegister || []).filter(a => a.billType === 'hospital');
      accHospital.forEach(a => {
        rows.push(['PART II: OUTFLOWS', `Transferred to Accounts: Ref #${a.referenceNo || '-'}`, 'Accounts Reg', '', a.amount || 0, '']);
      });
      const subtotalAcc = accHospital.reduce((s,a) => s + (a.amount || 0), 0);
      rows.push(['PART II: OUTFLOWS', 'Subtotal: Sent to Accounts Dept', '', '', subtotalAcc, '']);

      const totalOutflows = subtotalHospBills + subtotalAdvBills + subtotalSlips + subtotalDeps + subtotalAcc;
      rows.push(['PART II: OUTFLOWS', 'TOTAL GROSS CASH OUTFLOWS (B)', '', '', totalOutflows, '']);
      rows.push([]);

      // Part III Reconciliation
      rows.push(['PART III: NET POSITION', 'Muhasib Cash Float in Hand Available', 'Cash in Hand', '', '', app.state.advanceCashAvailable || 0]);
      rows.push(['PART III: NET POSITION', 'Hospital Cash Collections in Hand Available', 'Cash in Hand', '', '', app.state.hospitalCashAvailable || 0]);
      rows.push(['PART III: NET POSITION', 'NET RECONCILED CASH WITH ME (A - B)', 'Reconciled Cash', '', '', app.state.totalCashWithMe || 0]);
      rows.push(['PART III: NET POSITION', 'Total Outstanding Pending Bills', 'Pending Bills', '', '', app.state.totalPendingBills || 0]);
      rows.push(['PART III: NET POSITION', 'Total Settled via Verification Transfers', 'Transfers Settled', '', '', app.state.totalTransferred || 0]);

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{wch: 22}, {wch: 46}, {wch: 20}, {wch: 18}, {wch: 18}, {wch: 18}];
      ws['!merges'] = [{s:{r:0,c:0}, e:{r:0,c:5}}];
      XLSX.utils.book_append_sheet(wb, ws, 'Balance Sheet Statement');
      XLSX.writeFile(wb, `NoorHospital_BalanceSheet_Statement_${new Date().toISOString().split('T')[0]}.xlsx`);
      app.ui.showToast('Comprehensive Balance Sheet Statement exported to Excel!', 'success');
    }
  },

  // ==========================================
  // BILL ATTACHMENT SYSTEM
  // ==========================================
  attachments: {
    stagedSlipAttachment: null,
    stagedBillAttachment: null,
    stagedConvertAttachment: null,
    stagedDepositAttachment: null,
    activeViewedStore: null,
    activeViewedRecord: null,

    // Tracks 'supabase' or 'gdrive' per upload context
    activeSources: {
      slip: 'supabase',
      convert: 'supabase',
      bill: 'supabase',
      deposit: 'supabase'
    },

    /**
     * Toggle upload source between 'supabase' (file upload) and 'gdrive' (URL paste).
     */
    setUploadSource(prefix, source) {
      app.attachments.activeSources[prefix] = source;

      const supabaseBtn = document.getElementById(`${prefix}-source-supabase`);
      const gdriveBtn   = document.getElementById(`${prefix}-source-gdrive`);
      const uploadZone  = document.getElementById(`${prefix}-upload-zone`);
      const gdriveZone  = document.getElementById(`${prefix}-gdrive-zone`);
      const previewZone = document.getElementById(`${prefix}-upload-preview`);

      if (source === 'gdrive') {
        if (supabaseBtn) supabaseBtn.classList.remove('active');
        if (gdriveBtn)   gdriveBtn.classList.add('active');
        if (uploadZone)  uploadZone.classList.add('hidden');
        if (previewZone) previewZone.classList.add('hidden');
        if (gdriveZone)  gdriveZone.classList.remove('hidden');

        // Populate the "Open Folder" link from saved state
        let folderUrl;
        let folderLabel;
        if (prefix === 'bill') {
          const expType = document.getElementById('bill-exp-type')?.value;
          folderUrl = expType === 'hospital' ? app.state.gdriveHospitalBills : app.state.gdriveAdvanceBills;
          folderLabel = expType === 'hospital' ? 'Open Hospital Bills Folder' : 'Open Advance Bills Folder';
        } else if (prefix === 'convert') {
          const expType = document.getElementById('convert-slip-exptype')?.value;
          folderUrl = expType === 'hospital' ? app.state.gdriveHospitalBills : app.state.gdriveAdvanceBills;
          folderLabel = expType === 'hospital' ? 'Open Hospital Bills Folder' : 'Open Advance Bills Folder';
        } else if (prefix === 'slip') {
          folderUrl = app.state.gdriveTempSlips;
        } else if (prefix === 'deposit') {
          folderUrl = app.state.gdriveMuhasibDeposits;
        }
        const folderLink = document.getElementById(`${prefix}-gdrive-folder-link`);
        if (folderLink) {
          if (folderUrl) folderLink.href = folderUrl;
          if (folderLabel) {
            const span = folderLink.querySelector('span');
            if (span) span.textContent = folderLabel;
          }
        }
      } else {
        if (supabaseBtn) supabaseBtn.classList.add('active');
        if (gdriveBtn)   gdriveBtn.classList.remove('active');
        if (gdriveZone)  gdriveZone.classList.add('hidden');
        // Show upload zone only if no preview is staged
        const hasPreview = previewZone && !previewZone.classList.contains('hidden') && previewZone.innerHTML.trim() !== '';
        if (!hasPreview && uploadZone) uploadZone.classList.remove('hidden');
      }
    },

    /**
     * Retrieve Supabase configuration settings.
     */
    async getCredentials() {
      if (app.supabase.url && app.supabase.key && app.supabase.bucket) {
        return { 
          url: app.supabase.url, 
          key: app.supabase.key, 
          bucket: app.supabase.bucket 
        };
      }
      const url = localStorage.getItem('noor_supabase_url') || await app.db.getSetting('supabaseUrl', '');
      const key = localStorage.getItem('noor_supabase_key') || await app.db.getSetting('supabaseKey', '');
      const bucket = localStorage.getItem('noor_supabase_bucket') || await app.db.getSetting('supabaseBucket', '');
      if (url && key && bucket) {
        return { url, key, bucket };
      }
      return null;
    },

    /**
     * Client-side Image Optimization (max width 1600px, WebP format, 70% quality).
     */
    optimizeImage(file) {
      return new Promise((resolve) => {
        if (!file.type.startsWith('image/')) {
          resolve({ file, fileName: file.name, fileType: file.type });
          return;
        }
        const img = new Image();
        img.src = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(img.src);
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          if (width > 1600) {
            height = Math.round(height * (1600 / width));
            width = 1600;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            if (!blob) {
              resolve({ file, fileName: file.name, fileType: file.type });
              return;
            }
            let name = file.name;
            const lastDot = name.lastIndexOf('.');
            if (lastDot !== -1) {
              name = name.substring(0, lastDot) + '.webp';
            } else {
              name = name + '.webp';
            }
            resolve({
              file: blob,
              fileName: name,
              fileType: 'image/webp'
            });
          }, 'image/webp', 0.7);
        };
        img.onerror = () => {
          resolve({ file, fileName: file.name, fileType: file.type });
        };
      });
    },

    /**
     * Binds events to file inputs, camera triggers, and drag & drop zones.
     */
    bindUploadEvents(prefix) {
      const zone = document.getElementById(`${prefix}-upload-zone`);
      const fileInput = document.getElementById(`${prefix}-attachment-input`);
      const cameraInput = document.getElementById(`${prefix}-camera-input`);
      const fileTrigger = document.getElementById(`${prefix}-file-trigger`);
      const cameraTrigger = document.getElementById(`${prefix}-camera-trigger`);
      
      if (!zone || !fileInput) return;

      const handleFileSelection = async (file) => {
        const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
        if (!validTypes.includes(file.type)) {
          app.ui.showToast('Unsupported file type! Please upload JPG, PNG, WEBP, or PDF.', 'error');
          return;
        }

        if (file.type === 'application/pdf' && file.size > 2 * 1024 * 1024) {
          app.ui.showToast('PDF is larger than 2MB. Consider compressing for faster uploads.', 'warning');
        }
        
        app.ui.showToast('Processing file...', 'info');
        const optimized = await app.attachments.optimizeImage(file);
        
        const reader = new FileReader();
        reader.onload = (e) => {
          const staged = {
            file: optimized.file,
            fileName: optimized.fileName,
            fileType: optimized.fileType,
            dataUrl: e.target.result
          };
          if (prefix === 'slip') app.attachments.stagedSlipAttachment = staged;
          else if (prefix === 'convert') app.attachments.stagedConvertAttachment = staged;
          else if (prefix === 'bill') app.attachments.stagedBillAttachment = staged;
          else if (prefix === 'deposit') app.attachments.stagedDepositAttachment = staged;
          
          app.attachments.renderPreview(prefix, staged);
        };
        reader.readAsDataURL(optimized.file);
      };

      fileTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
      });

      cameraTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        cameraInput.click();
      });

      fileInput.addEventListener('change', () => {
        if (fileInput.files.length) handleFileSelection(fileInput.files[0]);
      });

      cameraInput.addEventListener('change', () => {
        if (cameraInput.files.length) handleFileSelection(cameraInput.files[0]);
      });

      // Drag and Drop
      ['dragenter', 'dragover'].forEach(name => {
        zone.addEventListener(name, (e) => {
          e.preventDefault();
          zone.classList.add('dragover');
        });
      });

      ['dragleave', 'drop'].forEach(name => {
        zone.addEventListener(name, (e) => {
          e.preventDefault();
          zone.classList.remove('dragover');
        });
      });

      zone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length) handleFileSelection(files[0]);
      });

      zone.addEventListener('click', (e) => {
        if (e.target !== cameraTrigger && !cameraTrigger.contains(e.target) &&
            e.target !== fileTrigger && !fileTrigger.contains(e.target)) {
          fileInput.click();
        }
      });
    },

    /**
     * Clear the staged attachment for a given form context.
     */
    clearStagedFile(prefix) {
      if (prefix === 'slip') app.attachments.stagedSlipAttachment = null;
      else if (prefix === 'convert') {
        app.attachments.stagedConvertAttachment = { removed: true };
      } else if (prefix === 'bill') app.attachments.stagedBillAttachment = null;
      else if (prefix === 'deposit') app.attachments.stagedDepositAttachment = null;

      const fileInput = document.getElementById(`${prefix}-attachment-input`);
      const cameraInput = document.getElementById(`${prefix}-camera-input`);
      if (fileInput) fileInput.value = '';
      if (cameraInput) cameraInput.value = '';

      app.attachments.renderPreview(prefix, null);
    },

    /**
     * Triggers replacement input programmatically.
     */
    triggerReplace(prefix) {
      const fileInput = document.getElementById(`${prefix}-attachment-input`);
      if (fileInput) fileInput.click();
    },

    /**
     * Render preview card inside modals.
     */
    renderPreview(prefix, staged) {
      const preview = document.getElementById(`${prefix}-upload-preview`);
      const zone = document.getElementById(`${prefix}-upload-zone`);
      if (!preview || !zone) return;

      if (!staged || staged.removed) {
        preview.innerHTML = '';
        preview.classList.add('hidden');
        zone.classList.remove('hidden');
        return;
      }

      zone.classList.add('hidden');
      preview.classList.remove('hidden');

      let mediaHtml = '';
      if (staged.fileType.startsWith('image/')) {
        mediaHtml = `<img src="${staged.dataUrl}" alt="Preview" class="preview-thumbnail">`;
      } else {
        mediaHtml = `
          <div class="preview-file-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
          </div>
        `;
      }

      const isOnline = navigator.onLine;
      const statusClass = isOnline ? 'synced' : 'pending';
      const statusLabel = isOnline ? 'Ready' : 'Pending';

      preview.innerHTML = `
        <div class="preview-info">
          ${mediaHtml}
          <div class="preview-details">
            <span class="preview-name">${staged.fileName}</span>
            <div class="preview-size-status">
              <span class="preview-size">${(staged.file.size / 1024).toFixed(1)} KB</span>
              <span class="preview-status ${statusClass}">${statusLabel}</span>
            </div>
          </div>
        </div>
        <div class="preview-actions">
          <button type="button" class="btn btn-secondary btn-sm" onclick="app.attachments.triggerReplace('${prefix}')">Replace</button>
          <button type="button" class="btn btn-secondary btn-sm text-error" onclick="app.attachments.clearStagedFile('${prefix}')">Remove</button>
        </div>
      `;
    },

    /**
     * Upload binary blob to Supabase Storage.
     */
    async uploadToSupabase(fileBlob, uniqueName, fileType, credentials) {
      const { url, key, bucket } = credentials;
      const uploadUrl = `${url.replace(/\/$/, '')}/storage/v1/object/${bucket}/${uniqueName}`;
      
      const headers = {
        'Authorization': `Bearer ${key}`,
        'apikey': key,
        'Content-Type': fileType
      };

      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: headers,
        body: fileBlob
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Supabase upload failed: ${response.statusText}. ${errorText}`);
      }

      return `${url.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/${uniqueName}`;
    },

    /**
     * Delete file from Supabase Storage.
     */
    async deleteFromSupabase(uniqueName, credentials) {
      const { url, key, bucket } = credentials;
      const deleteUrl = `${url.replace(/\/$/, '')}/storage/v1/object/${bucket}/${uniqueName}`;
      
      const headers = {
        'Authorization': `Bearer ${key}`,
        'apikey': key
      };

      const response = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: headers
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to delete from Supabase: ${errorText}`);
      }
    },

    /**
     * Delete attachment of a record from storage if exists.
     */
    async deleteRecordAttachment(record) {
      if (record && record.attachmentUrl && record.attachmentUrl !== 'local') {
        try {
          const credentials = await app.attachments.getCredentials();
          if (credentials) {
            const parts = record.attachmentUrl.split('/');
            const uniqueName = parts[parts.length - 1];
            await app.attachments.deleteFromSupabase(uniqueName, credentials);
          }
        } catch (err) {
          console.error('Failed to delete attachment from storage:', err);
        }
      }
    },

    /**
     * Handle attachment save process (local or supabase).
     */
    async processSave(staged) {
      const credentials = await app.attachments.getCredentials();
      const isOnline = navigator.onLine;
      if (isOnline && credentials) {
        try {
          const ext = staged.fileName.split('.').pop();
          const uniqueName = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${ext}`;
          const publicUrl = await app.attachments.uploadToSupabase(staged.file, uniqueName, staged.fileType, credentials);
          return {
            attachmentUrl: publicUrl,
            fileName: staged.fileName,
            fileType: staged.fileType,
            uploadDate: new Date().toISOString(),
            pendingUpload: false,
            localAttachmentData: null
          };
        } catch (err) {
          console.error(err);
          app.ui.showToast('Supabase upload failed, saving attachment locally.', 'warning');
        }
      }
      return {
        attachmentUrl: 'local',
        fileName: staged.fileName,
        fileType: staged.fileType,
        uploadDate: new Date().toISOString(),
        pendingUpload: true,
        localAttachmentData: staged.dataUrl
      };
    },

    /**
     * Open attachment in full-screen document viewer.
     * For Google Drive URLs, opens in a new tab directly instead of the viewer.
     */
    async viewAttachment(storeName, id) {
      try {
        const records = await app.db.getAll(storeName);
        const record = records.find(r => r.id === id);
        
        if (!record || !record.attachmentUrl) {
          app.ui.showToast('No attachment found.', 'error');
          return;
        }

        app.attachments.activeViewedStore = storeName;
        app.attachments.activeViewedRecord = record;

        // Google Drive links: open in new tab directly
        if (record.fileType === 'url/gdrive' || record.attachmentUrl.includes('drive.google.com') || record.attachmentUrl.includes('docs.google.com')) {
          window.open(record.attachmentUrl, '_blank', 'noopener,noreferrer');
          return;
        }
        
        const titleEl = document.getElementById('viewer-title');
        let viewerTitle = '';
        if (storeName === 'bills') {
          viewerTitle = `Bill Attachment (${record.billNumber || 'Direct'})`;
        } else if (storeName === 'temporary_slips') {
          viewerTitle = `Temporary Slip Attachment (${record.vendor})`;
        } else if (storeName === 'hospital_deposits') {
          viewerTitle = `Hospital Deposit Receipt (${record.receiptNumber})`;
        }
        titleEl.innerText = viewerTitle;
        
        const fileNameEl = document.getElementById('viewer-file-name');
        fileNameEl.innerText = record.fileName || 'attachment';
        
        const contentEl = document.getElementById('viewer-content');
        contentEl.innerHTML = '';
        
        const fileUrl = (record.pendingUpload || record.attachmentUrl === 'local') ? record.localAttachmentData : record.attachmentUrl;
        
        if (record.fileType && record.fileType.startsWith('image/')) {
          contentEl.innerHTML = `<img src="${fileUrl}" alt="Attachment Image" style="max-width:100%; max-height:70vh; object-fit:contain; border-radius:6px; border:1px solid var(--border-color);">`;
        } else if (record.fileType === 'application/pdf') {
          contentEl.innerHTML = `<iframe src="${fileUrl}" style="width:100%; height:70vh; border:none; border-radius:6px; background-color:white;"></iframe>`;
        } else {
          contentEl.innerHTML = `<div class="text-center text-muted">Preview not available. Click download to view.</div>`;
        }
        
        const downloadLink = document.getElementById('viewer-download-link');
        downloadLink.href = fileUrl;
        downloadLink.download = record.fileName || 'download';
        
        app.ui.openModal('dialog-viewer');
      } catch (err) {
        console.error(err);
        app.ui.showToast('Failed to load attachment: ' + err.message, 'error');
      }
    },

    /**
     * Helper to convert base64 Data URL to binary Blob.
     */
    dataURLtoBlob(dataurl) {
      const arr = dataurl.split(',');
      const mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new Blob([u8arr], { type: mime });
    },

    /**
     * Sync local attachments queue to Supabase when online.
     */
    async runSyncQueue() {
      const credentials = await app.attachments.getCredentials();
      if (!credentials) return;

      let syncedAny = false;
      const stores = ['temporary_slips', 'bills', 'hospital_deposits'];
      
      for (const storeName of stores) {
        try {
          const records = await app.db.getAll(storeName);
          const pending = records.filter(r => r.pendingUpload && r.localAttachmentData);
          
          for (const record of pending) {
            try {
              const fileBlob = app.attachments.dataURLtoBlob(record.localAttachmentData);
              const ext = record.fileName.split('.').pop();
              const uniqueName = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${ext}`;
              
              const publicUrl = await app.attachments.uploadToSupabase(fileBlob, uniqueName, record.fileType, credentials);
              
              record.attachmentUrl = publicUrl;
              record.pendingUpload = false;
              record.localAttachmentData = null;
              
              await app.db.put(storeName, record.id, record);
              syncedAny = true;
            } catch (err) {
              console.error(`Error syncing record ${record.id} in store ${storeName}:`, err);
            }
          }
        } catch (err) {
          console.error(`Error listing pending items in store ${storeName}:`, err);
        }
      }

      if (syncedAny) {
        app.ui.showToast('Pending attachments successfully synced to Supabase Storage!');
        app.syncState();
      }
    }
  },

  // ==========================================
  // MOBILE OPTIMIZATION MODULE
  // ==========================================
  mobile: {
    /**
     * Returns true if the viewport is mobile-sized.
     */
    isMobile() {
      return window.innerWidth <= 768;
    },

    /**
     * Initialize mobile-specific behaviors: bottom nav, submenu, resize.
     */
    init() {
      // Bottom Navigation Bar click handlers
      const bottomNavItems = document.querySelectorAll('.bottom-nav-item');
      bottomNavItems.forEach(btn => {
        btn.addEventListener('click', () => {
          const navTarget = btn.getAttribute('data-nav');
          app.mobile.handleBottomNav(navTarget);
        });
      });

      // Mobile Sub-Menu item handlers (delegated for robust click handling)
      document.addEventListener('click', (e) => {
        const itemBtn = e.target.closest('.mobile-submenu-item');
        if (itemBtn) {
          const panelId = itemBtn.getAttribute('data-panel');
          if (panelId) {
            app.ui.switchTab(panelId);
          }
        }
      });

      // Close submenus when tapping on overlay backdrop
      document.querySelectorAll('.mobile-submenu-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) {
            overlay.classList.remove('active');
          }
        });
      });

      // Close submenus when clicking outside
      document.addEventListener('click', (e) => {
        const ledgerSub = document.getElementById('mobile-ledger-submenu');
        const billsSub = document.getElementById('mobile-bills-submenu');
        const reportsSub = document.getElementById('mobile-reports-submenu');
        const ledgerBtn = document.querySelector('.bottom-nav-item[data-nav="ledgers"]');
        const billsBtn = document.querySelector('.bottom-nav-item[data-nav="bills"]');
        const reportsBtn = document.querySelector('.bottom-nav-item[data-nav="reports"]');

        if (ledgerSub && ledgerSub.classList.contains('active')) {
          if (!ledgerSub.querySelector('.mobile-submenu-card')?.contains(e.target) && !ledgerBtn?.contains(e.target)) {
            ledgerSub.classList.remove('active');
          }
        }
        if (billsSub && billsSub.classList.contains('active')) {
          if (!billsSub.querySelector('.mobile-submenu-card')?.contains(e.target) && !billsBtn?.contains(e.target)) {
            billsSub.classList.remove('active');
          }
        }
        if (reportsSub && reportsSub.classList.contains('active')) {
          if (!reportsSub.querySelector('.mobile-submenu-card')?.contains(e.target) && !reportsBtn?.contains(e.target)) {
            reportsSub.classList.remove('active');
          }
        }
      });

      // Resize listener for orientation changes
      let resizeTimeout;
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          app.mobile.renderAllMobileCards();
        }, 250);
      });
    },

    /**
     * Handle bottom navigation tap.
     */
    handleBottomNav(navTarget) {
      const ledgerSub = document.getElementById('mobile-ledger-submenu');
      const billsSub = document.getElementById('mobile-bills-submenu');
      const reportsSub = document.getElementById('mobile-reports-submenu');
      const closeAll = ()=>{ 
        if(ledgerSub) ledgerSub.classList.remove('active'); 
        if(billsSub) billsSub.classList.remove('active'); 
        if(reportsSub) reportsSub.classList.remove('active');
      };
      
      switch (navTarget) {
        case 'dashboard':
          closeAll();
          app.ui.switchTab('dashboard');
          break;
        case 'ledgers':
          if(billsSub) billsSub.classList.remove('active');
          if(reportsSub) reportsSub.classList.remove('active');
          if (ledgerSub) {
            ledgerSub.classList.toggle('active');
          }
          document.querySelectorAll('.bottom-nav-item').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-nav') === 'ledgers');
          });
          break;
        case 'bills':
          if(ledgerSub) ledgerSub.classList.remove('active');
          if(reportsSub) reportsSub.classList.remove('active');
          if (billsSub) {
            billsSub.classList.toggle('active');
          }
          document.querySelectorAll('.bottom-nav-item').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-nav') === 'bills');
          });
          break;
        case 'reports':
          if(ledgerSub) ledgerSub.classList.remove('active');
          if(billsSub) billsSub.classList.remove('active');
          if (reportsSub) {
            reportsSub.classList.toggle('active');
          } else {
            app.ui.switchTab('reports');
          }
          document.querySelectorAll('.bottom-nav-item').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-nav') === 'reports');
          });
          break;
        case 'settings':
          closeAll();
          app.ui.switchTab('settings');
          break;
      }
    },

    /**
     * Render all mobile card views (called from renderAll).
     */
    renderAllMobileCards(forceAll = false) {
      if (!forceAll && app.mobile.isMobile()) {
        const activePanel = document.querySelector('.panel.active');
        const activeId = activePanel ? activePanel.id : '';
        if (activeId === 'panel-advance-cash') {
          try{ app.mobile.renderAdvanceCards(); }catch(e){}
        } else if (activeId === 'panel-hospital-cash') {
          try{ app.mobile.renderHospitalCards(); }catch(e){}
        } else if (activeId === 'panel-hospital-deposits') {
          try{ app.mobile.renderDepositsCards(); }catch(e){}
        } else if (activeId === 'panel-temp-slips') {
          try{ app.mobile.renderSlipsCards(); }catch(e){}
        } else if (activeId === 'panel-advance-bills') {
          try{ app.mobile.renderAdvanceBillsCards(); }catch(e){}
        } else if (activeId === 'panel-bills') {
          try{ app.mobile.renderBillsCards(); }catch(e){}
        } else if (activeId === 'panel-accounts') {
          try{ app.mobile.renderAccountsCards(); }catch(e){}
        } else if (activeId === 'panel-transfers') {
          try{ app.mobile.renderTransfersCards(); }catch(e){}
        }
      } else {
        try{ app.mobile.renderAdvanceCards(); }catch(e){}
        try{ app.mobile.renderHospitalCards(); }catch(e){}
        try{ app.mobile.renderDepositsCards(); }catch(e){}
        try{ app.mobile.renderSlipsCards(); }catch(e){}
        try{ app.mobile.renderAdvanceBillsCards(); }catch(e){}
        try{ app.mobile.renderBillsCards(); }catch(e){}
        try{ app.mobile.renderAccountsCards(); }catch(e){}
        try{ app.mobile.renderTransfersCards(); }catch(e){}
      }
      try{ app.mobile.updateMobileBadges(); }catch(e){}
    },

    /**
     * Update bottom nav and submenu badge counts.
     */
    updateMobileBadges() {
      // Bills badge on bottom nav
      const pendingBills = app.state.bills.filter(b => b.status === 'pending').length;
      const billsBadge = document.getElementById('bottom-nav-bills-badge');
      if (billsBadge) {
        if (pendingBills > 0) {
          billsBadge.textContent = pendingBills;
          billsBadge.style.display = 'flex';
        } else {
          billsBadge.style.display = 'none';
        }
      }

      // Slips badge in submenu
      const slipsBadge = document.getElementById('submenu-slips-badge');
      if (slipsBadge) {
        slipsBadge.textContent = app.state.temporarySlipsPending;
        slipsBadge.style.display = app.state.temporarySlipsPending > 0 ? 'inline' : 'none';
      }
      const muhasibCount = app.state.bills.filter(b=>b.expenseType==='advance').length;
      const hospCount = app.state.bills.filter(b=>b.expenseType==='hospital').length;
      ['submenu-advance-bills-badge','submenu-advance-bills-badge2'].forEach(id=>{ const el=document.getElementById(id); if(el){ el.textContent=muhasibCount; el.style.display=muhasibCount>0?'inline':'none'; } });
      ['submenu-bills-badge','submenu-bills-badge2'].forEach(id=>{ const el=document.getElementById(id); if(el){ el.textContent=hospCount; el.style.display=hospCount>0?'inline':'none'; } });
    },

    /**
     * Muhasib Cash mobile card list.
     */
    renderAdvanceCards() {
      const container = document.getElementById('mobile-list-advance');
      if (!container) return;
      const sorted = app.ui.getFiltered(app.state.advanceCashEntries,'advance');
      if (!sorted.length) {
        const f=app.ui.filters.advance; const isF=f.search||f.from||f.to;
        container.innerHTML = `<div class="mobile-card-empty">${isF?'No records match filter.':'No cash entry records found.'}</div>`;
        return;
      }
      const ascending = [...sorted].sort((a, b) => new Date(a.date) - new Date(b.date));
      const balanceMap = {};
      let running = app.state.openingAdvanceCash;
      ascending.forEach(entry => {
        running += entry.amount;
        balanceMap[entry.id] = running;
      });

      container.innerHTML = sorted.map(entry => `
        <div class="mobile-record-card">
          <div class="mobile-card-header">
            <div>
              <div class="mobile-card-date">${app.ui.formatDate(entry.date)}</div>
            </div>
            <div class="mobile-card-amount inflow">+${app.ui.formatCurrency(entry.amount)}</div>
          </div>
          ${entry.remarks ? `<div class="mobile-card-body">${entry.remarks}</div>` : ''}
          <div class="mobile-card-row">
            <span class="mobile-card-label">Running Balance</span>
            <span class="mobile-card-val">${app.ui.formatCurrency(balanceMap[entry.id] || 0)}</span>
          </div>
          <div class="mobile-card-footer">
            <button class="btn btn-secondary btn-sm btn-edit-action" onclick="app.ui.initiateEdit('advance_cash', ${entry.id})">
              Edit
            </button>
            <button class="btn btn-secondary btn-sm text-error" onclick="app.db.promptDelete('advance_cash', ${entry.id})">
              Delete
            </button>
          </div>
        </div>
      `).join('');
    },

    /**
     * Hospital Cash mobile card list.
     */
    renderHospitalCards() {
      const container = document.getElementById('mobile-list-hospital');
      if (!container) return;
      const sorted = app.ui.getFiltered(app.state.hospitalCashEntries,'hospital');
      if (!sorted.length) {
        const f=app.ui.filters.hospital; const isF=f.search||f.from||f.to;
        container.innerHTML = `<div class="mobile-card-empty">${isF?'No records match filter.':'No collections recorded yet.'}</div>`;
        return;
      }
      const ascending = [...sorted].sort((a, b) => new Date(a.date) - new Date(b.date));
      const balanceMap = {};
      let running = app.state.openingHospitalCash;
      ascending.forEach(entry => {
        running += entry.amount;
        balanceMap[entry.id] = running;
      });

      container.innerHTML = sorted.map(entry => `
        <div class="mobile-record-card">
          <div class="mobile-card-header">
            <div>
              <div class="mobile-card-date">${app.ui.formatDate(entry.date)}</div>
              <span class="source-tag" style="margin-top:0.25rem;display:inline-block;">${entry.source}</span>
            </div>
            <div class="mobile-card-amount inflow">+${app.ui.formatCurrency(entry.amount)}</div>
          </div>
          ${entry.remarks ? `<div class="mobile-card-body">${entry.remarks}</div>` : ''}
          <div class="mobile-card-row">
            <span class="mobile-card-label">Running Balance</span>
            <span class="mobile-card-val">${app.ui.formatCurrency(balanceMap[entry.id] || 0)}</span>
          </div>
          <div class="mobile-card-footer">
            <button class="btn btn-secondary btn-sm btn-edit-action" onclick="app.ui.initiateEdit('hospital_cash', ${entry.id})">
              Edit
            </button>
            <button class="btn btn-secondary btn-sm text-error" onclick="app.db.promptDelete('hospital_cash', ${entry.id})">
              Delete
            </button>
          </div>
        </div>
      `).join('');
    },

    /**
     * Temporary Slips mobile card list.
     */
    renderSlipsCards() {
      const container = document.getElementById('mobile-list-slips');
      if (!container) return;
      // Filter out converted slips so they are removed from the temporary slips mobile list
      const activeSlips = app.state.temporarySlips.filter(s => s.status !== 'converted');
      const sorted = app.ui.getFiltered(activeSlips, 'slips');
      if (!sorted.length) {
        const f=app.ui.filters.slips; const isF=f.search||f.from||f.to;
        container.innerHTML = `<div class="mobile-card-empty">${isF?'No records match filter.':'No pending temporary slips registered.'}</div>`;
        return;
      }

      container.innerHTML = sorted.map(slip => {
        const statusClass = slip.status === 'pending' ? 'pending' : 'converted';
        const typeLabel = slip.expenseType === 'advance' ? 'Muhasib Cash' : 'Hospital Cash';
        
        let attachmentHtml = '';
        if (slip.attachmentUrl) {
          const syncClass = slip.pendingUpload ? 'pending-sync' : '';
          const label = slip.pendingUpload ? '⏳ Syncing' : (slip.fileType === 'application/pdf' ? '📄 PDF' : '📷 Image');
          attachmentHtml = `<span class="attachment-badge ${syncClass}" onclick="app.attachments.viewAttachment('temporary_slips', ${slip.id})" style="cursor:pointer;">${label}</span>`;
        }

        let actionBtns = '';
        if (slip.status === 'pending') {
          actionBtns = `
            <button class="btn btn-secondary btn-sm btn-edit-action" onclick="app.ui.initiateEdit('temporary_slips', ${slip.id})">
              Edit
            </button>
            <button class="btn btn-secondary btn-sm" onclick="app.ui.initiateSlipConversion(${slip.id}, '${slip.vendor.replace(/'/g, "\\'")}', ${slip.amount}, '${slip.expenseType}')">
              Convert to Bill
            </button>
            <button class="btn btn-secondary btn-sm text-error" onclick="app.db.promptDelete('temporary_slips', ${slip.id})">
              Delete
            </button>
          `;
        } else {
          actionBtns = `
            <span class="text-muted" style="font-size:0.78rem; flex:1; text-align:center;">Converted</span>
            <button class="btn btn-secondary btn-sm btn-edit-action" onclick="app.ui.initiateEdit('temporary_slips', ${slip.id})">
              Edit
            </button>
            <button class="btn btn-secondary btn-sm text-error" onclick="app.db.promptDelete('temporary_slips', ${slip.id})">
              Delete
            </button>
          `;
        }

        return `
          <div class="mobile-record-card">
            <div class="mobile-card-header">
              <div class="mobile-card-title">${slip.vendor}</div>
              <div class="mobile-card-amount outflow">-${app.ui.formatCurrency(slip.amount)}</div>
            </div>
            <div class="mobile-card-meta">
              <span class="mobile-card-date">${app.ui.formatDate(slip.date)}</span>
              ${slip.tokenNumber ? `<span class="source-tag font-mono" style="font-size:0.7rem;letter-spacing:0.5px">${slip.tokenNumber}</span>` : ''}
              <span class="source-tag">${typeLabel}</span>
              <span class="status-pill ${statusClass}">${slip.status}</span>
              ${attachmentHtml}
            </div>
            ${slip.remarks ? `<div class="mobile-card-body">${slip.remarks}</div>` : ''}
            <div class="mobile-card-footer">
              ${actionBtns}
            </div>
          </div>
        `;
      }).join('');
    },

    /**
     * Bills mobile card list.
     */
    renderAdvanceBillsCards() {
      const container=document.getElementById('mobile-list-advance-bills');
      if(!container) return;
      let all=app.ui.getFiltered(app.state.bills,'advance-bills');
      let filtered=all.filter(b=>String(b.expenseType||'').toLowerCase().trim()==='advance');
      if(!filtered.length && app.state.bills.length){
        const raw=app.state.bills.filter(b=>String(b.expenseType||'').toLowerCase().trim()==='advance');
        if(raw.length) filtered = app.ui.filters['advance-bills'].search||app.ui.filters['advance-bills'].from||app.ui.filters['advance-bills'].to ? filtered : raw;
        if(!filtered.length && raw.length) filtered=raw;
      }
      if(!filtered.length){
        const f=app.ui.filters['advance-bills']; const isF=f.search||f.from||f.to;
        container.innerHTML=`<div class="mobile-card-empty">${isF?'No records match filter. <button class="btn btn-secondary btn-sm" onclick="app.ui.clearFilters(\'advance-bills\')">Clear Filter</button>':'No muhasib bills found.'} <small style="display:block;margin-top:4px;opacity:0.6">Total bills: ${app.state.bills.length}, Advance: ${app.state.bills.filter(b=>String(b.expenseType||'').toLowerCase().trim()==='advance').length}</small></div>`;
        return;
      }
      container.innerHTML = filtered.map(bill=>{
        const note=!bill.slipId?'Direct':'From Slip';
        let attachmentHtml='';
        if(bill.attachmentUrl){
          const syncClass=bill.pendingUpload?'pending-sync':'';
          const label=bill.pendingUpload?'⏳ Syncing':(bill.fileType==='application/pdf'?'📄 PDF':'📷 Image');
          attachmentHtml=`<span class="attachment-badge ${syncClass}" onclick="app.attachments.viewAttachment('bills', ${bill.id})" style="cursor:pointer;">${label}</span>`;
        } else { attachmentHtml=`<span class="source-tag" style="opacity:0.6">No Attachment</span>`; }
        return `<div class="mobile-record-card" style="border-left:3px solid var(--tertiary)"><div class="mobile-card-header"><div style="min-width:0;flex:1"><div class="mobile-card-title" style="white-space:normal;word-break:break-word">${app.ui.escapeHTML(bill.vendor)}</div><div class="mobile-card-date">#${app.ui.escapeHTML(bill.billNumber)} • ${app.ui.formatDate(bill.date)}</div></div><div class="mobile-card-amount outflow" style="font-size:1rem">-${app.ui.formatCurrency(bill.amount)}</div></div><div class="mobile-card-meta" style="gap:0.4rem">${bill.tokenNumber ? `<span class="source-tag font-mono" style="font-size:0.7rem;letter-spacing:0.5px">${app.ui.escapeHTML(bill.tokenNumber)}</span>` : ''}<span class="source-tag">${app.ui.escapeHTML(bill.category)}</span><span class="source-tag">${note}</span>${attachmentHtml}</div><div style="display:flex;flex-direction:column;gap:0.35rem;background:var(--bg-app);border:1px solid var(--border-color);border-radius:8px;padding:0.6rem 0.7rem"><div class="mobile-card-row"><span class="mobile-card-label">Date</span><span class="mobile-card-val">${app.ui.formatDate(bill.date)}</span></div><div class="mobile-card-row"><span class="mobile-card-label">Token No</span><span class="mobile-card-val" style="font-size:0.8rem;font-family:monospace">${app.ui.escapeHTML(bill.tokenNumber || '-')}</span></div><div class="mobile-card-row"><span class="mobile-card-label">Bill No</span><span class="mobile-card-val" style="font-size:0.8rem">${app.ui.escapeHTML(bill.billNumber)}</span></div><div class="mobile-card-row"><span class="mobile-card-label">Vendor</span><span class="mobile-card-val" style="font-size:0.8rem;white-space:normal;text-align:right;max-width:55%">${app.ui.escapeHTML(bill.vendor)}</span></div><div class="mobile-card-row"><span class="mobile-card-label">Category</span><span class="mobile-card-val" style="font-size:0.8rem">${app.ui.escapeHTML(bill.category)}</span></div><div class="mobile-card-row"><span class="mobile-card-label">Amount</span><span class="mobile-card-val" style="color:var(--error)">${app.ui.formatCurrency(bill.amount)}</span></div>${bill.remarks?`<div style="border-top:1px dashed var(--border-color);padding-top:0.35rem;margin-top:0.15rem"><span class="mobile-card-label">Remarks</span><div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px;white-space:normal;word-break:break-word">${app.ui.escapeHTML(bill.remarks)}</div></div>`:''}</div><div class="mobile-card-footer" style="flex-wrap:wrap"><button class="btn btn-secondary btn-sm" onclick="app.ui.convertBill(${bill.id})" style="flex:1">→ Hosp</button><button class="btn btn-secondary btn-sm btn-edit-action" onclick="app.ui.initiateEdit('bills', ${bill.id})" style="flex:1">Edit</button><button class="btn btn-secondary btn-sm text-error" onclick="app.db.promptDelete('bills', ${bill.id})" style="flex:1">Delete</button></div></div>`;
      }).join('');
    },
    renderBillsCards() {
      const container=document.getElementById('mobile-list-bills');
      if(!container) return;
      let all=app.ui.getFiltered(app.state.bills,'bills');
      let filtered=all.filter(b=>String(b.expenseType||'').toLowerCase().trim()==='hospital');
      if(!filtered.length && app.state.bills.length){
        const raw=app.state.bills.filter(b=>String(b.expenseType||'').toLowerCase().trim()==='hospital');
        if(raw.length) filtered = app.ui.filters.bills.search||app.ui.filters.bills.from||app.ui.filters.bills.to ? filtered : raw;
        if(!filtered.length && raw.length) filtered=raw;
      }
      if(!filtered.length){
        const f=app.ui.filters.bills; const isF=f.search||f.from||f.to;
        container.innerHTML=`<div class="mobile-card-empty">${isF?'No records match filter. <button class="btn btn-secondary btn-sm" onclick="app.ui.clearFilters(\'bills\')">Clear Filter</button>':'No hospital bills found.'} <small style="display:block;margin-top:4px;opacity:0.6">Total bills: ${app.state.bills.length}, Hospital: ${app.state.bills.filter(b=>String(b.expenseType||'').toLowerCase().trim()==='hospital').length}</small></div>`;
        return;
      }
      container.innerHTML = filtered.map(bill=>{
        const note=!bill.slipId?'Direct':'From Slip';
        let attachmentHtml='';
        if(bill.attachmentUrl){
          const syncClass=bill.pendingUpload?'pending-sync':'';
          const label=bill.pendingUpload?'⏳ Syncing':(bill.fileType==='application/pdf'?'📄 PDF':'📷 Image');
          attachmentHtml=`<span class="attachment-badge ${syncClass}" onclick="app.attachments.viewAttachment('bills', ${bill.id})" style="cursor:pointer;">${label}</span>`;
        } else { attachmentHtml=`<span class="source-tag" style="opacity:0.6">No Attachment</span>`; }
        return `<div class="mobile-record-card" style="border-left:3px solid var(--secondary)"><div class="mobile-card-header"><div style="min-width:0;flex:1"><div class="mobile-card-title" style="white-space:normal;word-break:break-word">${app.ui.escapeHTML(bill.vendor)}</div><div class="mobile-card-date">#${app.ui.escapeHTML(bill.billNumber)} • ${app.ui.formatDate(bill.date)}</div></div><div class="mobile-card-amount outflow" style="font-size:1rem">-${app.ui.formatCurrency(bill.amount)}</div></div><div class="mobile-card-meta" style="gap:0.4rem">${bill.tokenNumber ? `<span class="source-tag font-mono" style="font-size:0.7rem;letter-spacing:0.5px">${app.ui.escapeHTML(bill.tokenNumber)}</span>` : ''}<span class="source-tag">${app.ui.escapeHTML(bill.category)}</span><span class="source-tag">${note}</span>${attachmentHtml}</div><div style="display:flex;flex-direction:column;gap:0.35rem;background:var(--bg-app);border:1px solid var(--border-color);border-radius:8px;padding:0.6rem 0.7rem"><div class="mobile-card-row"><span class="mobile-card-label">Date</span><span class="mobile-card-val">${app.ui.formatDate(bill.date)}</span></div><div class="mobile-card-row"><span class="mobile-card-label">Token No</span><span class="mobile-card-val" style="font-size:0.8rem;font-family:monospace">${app.ui.escapeHTML(bill.tokenNumber || '-')}</span></div><div class="mobile-card-row"><span class="mobile-card-label">Bill No</span><span class="mobile-card-val" style="font-size:0.8rem">${app.ui.escapeHTML(bill.billNumber)}</span></div><div class="mobile-card-row"><span class="mobile-card-label">Vendor</span><span class="mobile-card-val" style="font-size:0.8rem;white-space:normal;text-align:right;max-width:55%">${app.ui.escapeHTML(bill.vendor)}</span></div><div class="mobile-card-row"><span class="mobile-card-label">Category</span><span class="mobile-card-val" style="font-size:0.8rem">${app.ui.escapeHTML(bill.category)}</span></div><div class="mobile-card-row"><span class="mobile-card-label">Amount</span><span class="mobile-card-val" style="color:var(--error)">${app.ui.formatCurrency(bill.amount)}</span></div>${bill.remarks?`<div style="border-top:1px dashed var(--border-color);padding-top:0.35rem;margin-top:0.15rem"><span class="mobile-card-label">Remarks</span><div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px;white-space:normal;word-break:break-word">${app.ui.escapeHTML(bill.remarks)}</div></div>`:''}</div><div class="mobile-card-footer" style="flex-wrap:wrap"><button class="btn btn-secondary btn-sm" onclick="app.ui.convertBill(${bill.id})" style="flex:1">→ Muhasib</button><button class="btn btn-secondary btn-sm btn-edit-action" onclick="app.ui.initiateEdit('bills', ${bill.id})" style="flex:1">Edit</button><button class="btn btn-secondary btn-sm text-error" onclick="app.db.promptDelete('bills', ${bill.id})" style="flex:1">Delete</button></div></div>`;
      }).join('');
    },

    renderAccountsCards() {
      const container = document.getElementById('mobile-list-accounts');
      if (!container) return;
      const sorted = app.ui.getFiltered(app.state.accountsRegister,'accounts');

      if (!sorted.length) {
        const f=app.ui.filters.accounts; const isF=f.search||f.from||f.to;
        container.innerHTML = `<div class="mobile-card-empty">${isF?'No records match filter.':'No batches sent to accounts.'}</div>`;
        return;
      }
      container.innerHTML = sorted.map(acc => {
        const typeBadge = acc.billType === 'advance' 
          ? `<span class="badge badge-primary">Advance</span>` 
          : `<span class="badge badge-secondary">Hospital</span>`;
          
        return `
          <div class="mobile-card">
            <div class="mobile-card-header">
              <div class="font-bold">${app.ui.formatDate(acc.dateSent)}</div>
              ${typeBadge}
            </div>
            <div class="mobile-card-body">
              <div class="mobile-card-row">
                <span class="mobile-card-label">Amount Sent</span>
                <span class="mobile-card-value text-accent font-bold">${app.ui.formatCurrency(acc.amount)}</span>
              </div>
              ${acc.referenceNo ? `
              <div class="mobile-card-row">
                <span class="mobile-card-label">Reference</span>
                <span class="mobile-card-value">${app.ui.escapeHTML(acc.referenceNo)}</span>
              </div>` : ''}
              ${acc.remarks ? `
              <div class="mobile-card-row" style="flex-direction: column; align-items: flex-start; gap: 0.25rem; margin-top: 0.5rem; border-top: 1px dashed var(--border-color); padding-top: 0.5rem;">
                <span class="mobile-card-label">Remarks</span>
                <span class="mobile-card-value" style="font-size: 0.85rem; color: var(--text-muted);">${app.ui.escapeHTML(acc.remarks)}</span>
              </div>` : ''}
            </div>
            <div class="mobile-card-actions">
              <button class="btn btn-secondary btn-sm btn-edit-action" onclick="app.ui.initiateEdit('accounts_register', ${acc.id})">
                Edit
              </button>
              <button class="btn btn-secondary btn-sm text-error" onclick="app.db.promptDelete('accounts_register', ${acc.id})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
              </button>
            </div>
          </div>
        `;
      }).join('');
    },

    /**
     * Transfers mobile card list.
     */
    renderTransfersCards() {
      const container = document.getElementById('mobile-list-transfers');
      if (!container) return;
      const sorted = app.ui.getFiltered(app.state.transfers,'transfers');
      if (!sorted.length) {
        const f=app.ui.filters.transfers; const isF=f.search||f.from||f.to;
        container.innerHTML = `<div class="mobile-card-empty">${isF?'No records match filter.':'No transfers recorded.'}</div>`;
        return;
      }

      container.innerHTML = sorted.map(trans => {
        const typeLabel = trans.type === 'amanat' ? 'Amanat Noor Hospital' : 'Imprest Noor Hospital';
        return `
          <div class="mobile-record-card">
            <div class="mobile-card-header">
              <div class="mobile-card-title">${typeLabel}</div>
              <div class="mobile-card-amount inflow">${app.ui.formatCurrency(trans.amount)}</div>
            </div>
            <div class="mobile-card-meta">
              <span class="mobile-card-date">${app.ui.formatDate(trans.date)}</span>
              <span class="source-tag">${trans.type === 'amanat' ? 'Hospital → Amanat' : 'Advance → Imprest'}</span>
            </div>
            ${trans.remarks ? `<div class="mobile-card-body">${trans.remarks}</div>` : ''}
            <div class="mobile-card-footer">
              <button class="btn btn-secondary btn-sm btn-edit-action" onclick="app.ui.initiateEdit('transfers', ${trans.id})">
                Edit
              </button>
              <button class="btn btn-secondary btn-sm text-error" onclick="app.db.promptDelete('transfers', ${trans.id})">
                Delete
              </button>
            </div>
          </div>
        `;
      }).join('');
    },

    /**
     * Hospital Deposits mobile card list.
     */
    renderDepositsCards() {
      const container = document.getElementById('mobile-list-deposits');
      if (!container) return;
      const sorted = app.ui.getFiltered(app.state.hospitalDeposits,'deposits');
      if (!sorted.length) {
        const f=app.ui.filters.deposits; const isF=f.search||f.from||f.to;
        container.innerHTML = `<div class="mobile-card-empty">${isF?'No records match filter.':'No deposits to Muhasib recorded.'}</div>`;
        return;
      }

      container.innerHTML = sorted.map(deposit => {
        let attachmentHtml = '';
        if (deposit.attachmentUrl) {
          const syncClass = deposit.pendingUpload ? 'pending-sync' : '';
          const label = deposit.pendingUpload ? '⏳ Syncing' : (deposit.fileType === 'application/pdf' ? '📄 PDF' : '📷 Image');
          attachmentHtml = `<span class="attachment-badge ${syncClass}" onclick="app.attachments.viewAttachment('hospital_deposits', ${deposit.id})" style="cursor:pointer;">${label}</span>`;
        }

        return `
          <div class="mobile-record-card">
            <div class="mobile-card-header">
              <div>
                <div class="mobile-card-title">${deposit.receiptNumber}</div>
                <div class="mobile-card-date">${app.ui.formatDate(deposit.date)}</div>
              </div>
              <div class="mobile-card-amount outflow">-${app.ui.formatCurrency(deposit.amount)}</div>
            </div>
            <div class="mobile-card-meta">
              ${attachmentHtml}
            </div>
            ${deposit.remarks ? `<div class="mobile-card-body">${deposit.remarks}</div>` : ''}
            <div class="mobile-card-footer">
              <button class="btn btn-secondary btn-sm btn-edit-action" onclick="app.ui.initiateEdit('hospital_deposits', ${deposit.id})">
                Edit
              </button>
              <button class="btn btn-secondary btn-sm text-error" onclick="app.db.promptDelete('hospital_deposits', ${deposit.id})">
                Delete
              </button>
            </div>
          </div>
        `;
      }).join('');
    }
  },

  sidebarColors: {
    defaults: { muhasib: '#a855f7', hospital: '#6366f1', accounts: '#6366f1', transfers: '#10b981' },
    get() {
      try { return JSON.parse(localStorage.getItem('noor_sidebar_colors')) || app.sidebarColors.defaults; } catch(e) { return app.sidebarColors.defaults; }
    },
    save(c) { localStorage.setItem('noor_sidebar_colors', JSON.stringify(c)); },
    apply() {
      const c = app.sidebarColors.get();
      let s = document.getElementById('dynamic-sidebar-colors');
      if (!s) { s = document.createElement('style'); s.id = 'dynamic-sidebar-colors'; document.head.appendChild(s); }
      const hex = (col) => col;
      const light = (col) => col + '1A';
      s.textContent = `
.nav-item[data-panel="advance-cash"], .nav-item[data-panel="advance-bills"] { background-color: ${light(hex(c.muhasib))} !important; color: ${hex(c.muhasib)} !important; }
.nav-item[data-panel="advance-cash"].active, .nav-item[data-panel="advance-bills"].active { background-color: ${light(hex(c.muhasib))} !important; color: ${hex(c.muhasib)} !important; border-left: 3px solid ${hex(c.muhasib)} !important; }
.nav-item[data-panel="advance-cash"] .badge, .nav-item[data-panel="advance-bills"] .badge { background: ${light(hex(c.muhasib))} !important; color: ${hex(c.muhasib)} !important; border-color: ${hex(c.muhasib)}33 !important; }
.nav-item[data-panel="hospital-cash"], .nav-item[data-panel="bills"], .nav-item[data-panel="temp-slips"], .nav-item[data-panel="hospital-deposits"], .nav-item[data-panel="accounts"] { background-color: ${light(hex(c.hospital))} !important; color: ${hex(c.hospital)} !important; }
.nav-item[data-panel="hospital-cash"].active, .nav-item[data-panel="bills"].active, .nav-item[data-panel="temp-slips"].active, .nav-item[data-panel="hospital-deposits"].active, .nav-item[data-panel="accounts"].active { background-color: ${light(hex(c.hospital))} !important; color: ${hex(c.hospital)} !important; border-left: 3px solid ${hex(c.hospital)} !important; }
.nav-item[data-panel="hospital-cash"] .badge, .nav-item[data-panel="bills"] .badge, .nav-item[data-panel="temp-slips"] .badge, .nav-item[data-panel="hospital-deposits"] .badge, .nav-item[data-panel="accounts"] .badge { background: ${light(hex(c.hospital))} !important; color: ${hex(c.hospital)} !important; border-color: ${hex(c.hospital)}33 !important; }
.nav-item[data-panel="transfers"] { background-color: ${light(hex(c.transfers))} !important; color: ${hex(c.transfers)} !important; }
.nav-item[data-panel="transfers"].active { background-color: ${light(hex(c.transfers))} !important; color: ${hex(c.transfers)} !important; border-left: 3px solid ${hex(c.transfers)} !important; }
.nav-item[data-panel="transfers"] .badge { background: ${light(hex(c.transfers))} !important; color: ${hex(c.transfers)} !important; border-color: ${hex(c.transfers)}33 !important; }
.metric-card:has(#dash-advance-cash), .metric-card:has(#dash-total-advance-received), .metric-card:has(#dash-imprest-received), .metric-card:has(#dash-advance-bills-pending) { border-left: 4px solid ${hex(c.muhasib)} !important; background: ${light(hex(c.muhasib))} !important; }
.metric-card:has(#dash-advance-cash) .card-metric-value, .metric-card:has(#dash-total-advance-received) .card-metric-value, .metric-card:has(#dash-imprest-received) .card-metric-value, .metric-card:has(#dash-advance-bills-pending) .card-metric-value { color: ${hex(c.muhasib)} !important; }
.metric-card:has(#dash-advance-cash) .card-metric-header span, .metric-card:has(#dash-total-advance-received) .card-metric-header span, .metric-card:has(#dash-imprest-received) .card-metric-header span, .metric-card:has(#dash-advance-bills-pending) .card-metric-header span, .metric-card:has(#dash-advance-cash) .card-metric-header, .metric-card:has(#dash-total-advance-received) .card-metric-header, .metric-card:has(#dash-imprest-received) .card-metric-header, .metric-card:has(#dash-advance-bills-pending) .card-metric-header { color: ${hex(c.muhasib)} !important; }
.metric-card:has(#dash-advance-cash) .metric-icon, .metric-card:has(#dash-total-advance-received) .metric-icon, .metric-card:has(#dash-imprest-received) .metric-icon, .metric-card:has(#dash-advance-bills-pending) .metric-icon { color: ${hex(c.muhasib)} !important; border-color: ${hex(c.muhasib)}33 !important; opacity:1 !important; }
.metric-card:has(#dash-hospital-cash), .metric-card:has(#dash-total-hospital-collected), .metric-card:has(#dash-total-hospital-deposited), .metric-card:has(#dash-amanat-received), .metric-card:has(#dash-hospital-bills-pending) { border-left: 4px solid ${hex(c.hospital)} !important; background: ${light(hex(c.hospital))} !important; }
.metric-card:has(#dash-hospital-cash) .card-metric-value, .metric-card:has(#dash-total-hospital-collected) .card-metric-value, .metric-card:has(#dash-total-hospital-deposited) .card-metric-value, .metric-card:has(#dash-amanat-received) .card-metric-value, .metric-card:has(#dash-hospital-bills-pending) .card-metric-value { color: ${hex(c.hospital)} !important; }
.metric-card:has(#dash-hospital-cash) .card-metric-header span, .metric-card:has(#dash-total-hospital-collected) .card-metric-header span, .metric-card:has(#dash-total-hospital-deposited) .card-metric-header span, .metric-card:has(#dash-amanat-received) .card-metric-header span, .metric-card:has(#dash-hospital-bills-pending) .card-metric-header span, .metric-card:has(#dash-hospital-cash) .card-metric-header, .metric-card:has(#dash-total-hospital-collected) .card-metric-header, .metric-card:has(#dash-total-hospital-deposited) .card-metric-header, .metric-card:has(#dash-amanat-received) .card-metric-header, .metric-card:has(#dash-hospital-bills-pending) .card-metric-header { color: ${hex(c.hospital)} !important; }
.metric-card:has(#dash-hospital-cash) .metric-icon, .metric-card:has(#dash-total-hospital-collected) .metric-icon, .metric-card:has(#dash-total-hospital-deposited) .metric-icon, .metric-card:has(#dash-amanat-received) .metric-icon, .metric-card:has(#dash-hospital-bills-pending) .metric-icon { color: ${hex(c.hospital)} !important; opacity:1 !important; }
.metric-card:has(#dash-total-sent-to-accounts), .metric-card:has(#dash-awaiting-transfer) { border-left: 4px solid ${hex(c.hospital)} !important; background: ${light(hex(c.hospital))} !important; }
.metric-card:has(#dash-total-sent-to-accounts) .card-metric-value, .metric-card:has(#dash-awaiting-transfer) .card-metric-value { color: ${hex(c.hospital)} !important; }
.metric-card:has(#dash-total-sent-to-accounts) .card-metric-header span, .metric-card:has(#dash-awaiting-transfer) .card-metric-header span, .metric-card:has(#dash-total-sent-to-accounts) .card-metric-header, .metric-card:has(#dash-awaiting-transfer) .card-metric-header { color: ${hex(c.hospital)} !important; }
.metric-card:has(#dash-total-sent-to-accounts) .metric-icon, .metric-card:has(#dash-awaiting-transfer) .metric-icon { color: ${hex(c.hospital)} !important; opacity:1 !important; }
.metric-card:has(#dash-total-transferred), .metric-card:has(#dash-total-cash-me) { border-left: 4px solid ${hex(c.transfers)} !important; background: ${light(hex(c.transfers))} !important; }
.metric-card:has(#dash-total-transferred) .card-metric-value, .metric-card:has(#dash-total-cash-me) .card-metric-value { color: ${hex(c.transfers)} !important; }
.metric-card:has(#dash-total-transferred) .card-metric-header span, .metric-card:has(#dash-total-cash-me) .card-metric-header span, .metric-card:has(#dash-total-transferred) .card-metric-header, .metric-card:has(#dash-total-cash-me) .card-metric-header { color: ${hex(c.transfers)} !important; }
.metric-card:has(#dash-total-transferred) .metric-icon, .metric-card:has(#dash-total-cash-me) .metric-icon { color: ${hex(c.transfers)} !important; opacity:1 !important; }
`;
    },
    bindForm() {
      const c = app.sidebarColors.get();
      const setVal = (sel, cust, val) => {
        const s = document.getElementById(sel);
        const cu = document.getElementById(cust);
        if (!s || !cu) return;
        const opts = Array.from(s.options).map(o=>o.value);
        if (opts.includes(val)) { s.value = val; cu.value = val; } else { s.value = 'custom'; cu.value = val; }
      };
      setVal('color-muhasib','color-muhasib-custom', c.muhasib);
      setVal('color-hospital','color-hospital-custom', c.hospital);
      setVal('color-accounts','color-accounts-custom', c.hospital);
      setVal('color-transfers','color-transfers-custom', c.transfers);
      const bind = (sel, cust) => {
        const s = document.getElementById(sel), cu = document.getElementById(cust);
        if (!s || !cu) return;
        s.addEventListener('change', () => { if (s.value !== 'custom') cu.value = s.value; });
        cu.addEventListener('input', () => { s.value = 'custom'; });
      };
      bind('color-muhasib','color-muhasib-custom');
      bind('color-hospital','color-hospital-custom');
      bind('color-accounts','color-accounts-custom');
      bind('color-transfers','color-transfers-custom');
      const hospSel = document.getElementById('color-hospital'), hospCust = document.getElementById('color-hospital-custom');
      const accSel = document.getElementById('color-accounts'), accCust = document.getElementById('color-accounts-custom');
      const syncAccToHosp = () => {
        const hv = hospSel.value === 'custom' ? hospCust.value : hospSel.value;
        const opts = Array.from(accSel.options).map(o=>o.value);
        if (opts.includes(hv)) { accSel.value = hv; accCust.value = hv; } else { accSel.value = 'custom'; accCust.value = hv; }
      };
      if (hospSel) hospSel.addEventListener('change', syncAccToHosp);
      if (hospCust) hospCust.addEventListener('input', syncAccToHosp);
      const form = document.getElementById('form-sidebar-colors');
      if (form) form.addEventListener('submit', (e) => {
        e.preventDefault();
        const getVal = (sel, cust) => {
          const s = document.getElementById(sel).value;
          const cu = document.getElementById(cust).value;
          return s === 'custom' ? cu : s;
        };
        const hospVal = getVal('color-hospital','color-hospital-custom');
        const nc = { muhasib: getVal('color-muhasib','color-muhasib-custom'), hospital: hospVal, accounts: hospVal, transfers: getVal('color-transfers','color-transfers-custom') };
        app.sidebarColors.save(nc);
        app.sidebarColors.apply();
        app.ui.showToast('Sidebar colors saved!');
      });
    },
    reset() {
      localStorage.removeItem('noor_sidebar_colors');
      app.sidebarColors.apply();
      app.sidebarColors.bindForm();
      app.ui.showToast('Colors reset to default');
    },
    init() { app.sidebarColors.apply(); app.sidebarColors.bindForm(); }
  },

  // ==========================================
  // INITIAL ENTRY POINT
  // ==========================================
  async init() {
    try {
      // Initialize unique Device ID
      app.getDeviceId();

      // 1. Setup Database
      await app.db.init();

      // Bind login form
      const loginForm = document.getElementById('form-login');
      if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const user = document.getElementById('login-username').value;
          const pass = document.getElementById('login-password').value;
          app.auth.login(user, pass);
        });
      }

      // Check Authentication State
      const isLoggedIn = app.auth.isLoggedIn();
      if (isLoggedIn) {
        app.auth.showApp();
        app.auth.embedSupabaseCredentials();
      } else {
        app.auth.showLogin();
      }
      
      // 2. Setup Listeners
      app.ui.init();

      // 2b. Setup Mobile-specific behaviors
      app.mobile.init();

      // 2c. Sidebar Custom Colors
      try { app.sidebarColors.init(); } catch(e) { console.error(e); }

      // 3. Load Theme configuration
      const storedTheme = await app.db.getSetting('theme', 'dark');
      app.ui.setTheme(storedTheme, false);

      // Initialize Supabase Database client & Sync Engine
      await app.supabase.init();
      app.sync.init();

      // If logged in, online, and Supabase configured, perform startup database sync in the background
      if (isLoggedIn && navigator.onLine && app.supabase.isConfigured()) {
        (async () => {
          try {
            app.sync.setStatus('syncing', 'Syncing...');
            await app.sync.processQueue();
            await app.sync.pullAllData();
            app.sync.setStatus('synced', 'Online & Synced');
            await app.syncState();
          } catch (syncErr) {
            console.error('Initial startup database sync failed:', syncErr);
            app.sync.setStatus('error', 'Sync Error');
          }
        })();
      }

      // Register window online event for attachments
      window.addEventListener('online', () => {
        app.ui.showToast('Network restored. Syncing attachments...', 'info');
        app.attachments.runSyncQueue();
      });

      // 4. Sync values and render (only if logged in) - Load local cache immediately
      if (isLoggedIn) {
        await app.syncState();
      }

      // Trigger initial run of sync queue
      app.attachments.runSyncQueue();
      
      console.log('Noor Hospital Cash Management System initialized successfully.');
    } catch (err) {
      console.error('Boot failure:', err);
    }
  }
};

// Expose app on global window object
window.app = app;

// Start application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = app;
  app.init();
});

