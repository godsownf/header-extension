/**
 * Storage Inspector - Chrome Extension
 * Professional tool for security researchers
 * v1.1 - With state persistence & fullscreen support
 */

class StorageInspector {
  constructor() {
    this.currentTab = 'localStorage';
    this.currentTabId = null;
    this.currentUrl = null;
    this.isFullscreen = false;
    this.browserTabs = [];
    this.data = {
      localStorage: {},
      sessionStorage: {},
      cookies: []
    };
    this.editingItem = null;
    this.searchQuery = '';
    
    this.init();
  }

  async init() {
    // Check if fullscreen mode
    this.isFullscreen = new URLSearchParams(window.location.search).get('fullscreen') === '1';
    if (this.isFullscreen) {
      document.body.classList.add('fullscreen');
    }
    
    this.loadTheme();
    this.showLoading(true);
    
    try {
      // Restore saved state
      await this.restoreState();
      
      // Get current or selected tab
      await this.getCurrentTab();
      
      // Load browser tabs for fullscreen mode
      if (this.isFullscreen) {
        await this.loadBrowserTabs();
      }
      
      this.bindEvents();
      await this.loadAllData();
      
      // Save state periodically
      this.startAutoSave();
    } catch (error) {
      console.error('Init error:', error);
      this.showToast('Failed to initialize', 'error');
    } finally {
      this.showLoading(false);
    }
  }

  // ================================
  // State Persistence
  // ================================
  
  async saveState() {
    try {
      const state = {
        currentTab: this.currentTab,
        currentTabId: this.currentTabId,
        currentUrl: this.currentUrl?.href,
        searchQuery: this.searchQuery,
        theme: document.documentElement.getAttribute('data-theme'),
        lastSaved: Date.now()
      };
      await chrome.storage.local.set({ inspectorState: state });
    } catch (error) {
      console.error('Failed to save state:', error);
    }
  }

  async restoreState() {
    try {
      const result = await chrome.storage.local.get('inspectorState');
      const state = result.inspectorState;
      
      if (state && state.lastSaved) {
        // Only restore if saved within last hour
        const hourAgo = Date.now() - (60 * 60 * 1000);
        if (state.lastSaved > hourAgo) {
          this.currentTab = state.currentTab || 'localStorage';
          this.searchQuery = state.searchQuery || '';
          
          // Restore search input
          const searchInput = document.getElementById('searchInput');
          if (searchInput && this.searchQuery) {
            searchInput.value = this.searchQuery;
            document.getElementById('clearSearch').classList.add('visible');
          }
          
          // Restore theme
          if (state.theme) {
            document.documentElement.setAttribute('data-theme', state.theme);
          }
          
          // Update active tab UI
          document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === this.currentTab);
          });
        }
      }
    } catch (error) {
      console.error('Failed to restore state:', error);
    }
  }

  startAutoSave() {
    // Save state every 5 seconds if changed
    setInterval(() => this.saveState(), 5000);
    
    // Save on unload
    window.addEventListener('beforeunload', () => this.saveState());
  }

  // ================================
  // Theme Management
  // ================================
  
  loadTheme() {
    const savedTheme = localStorage.getItem('si-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('si-theme', next);
    this.saveState();
  }

  // ================================
  // UI Helpers
  // ================================

  showLoading(show) {
    const el = document.getElementById('loadingState');
    const list = document.getElementById('storageList');
    const empty = document.getElementById('emptyState');
    
    if (show) {
      el.classList.add('visible');
      list.style.display = 'none';
      empty.classList.remove('visible');
    } else {
      el.classList.remove('visible');
    }
  }

  showEmpty(show) {
    const el = document.getElementById('emptyState');
    const list = document.getElementById('storageList');
    
    if (show) {
      el.classList.add('visible');
      list.style.display = 'none';
    } else {
      el.classList.remove('visible');
      list.style.display = this.isFullscreen ? 'grid' : 'flex';
    }
  }

  // ================================
  // Fullscreen & Tab Management
  // ================================

  openFullscreen() {
    const url = chrome.runtime.getURL('popup.html?fullscreen=1');
    chrome.tabs.create({ url });
  }

  async loadBrowserTabs() {
    try {
      const tabs = await chrome.tabs.query({});
      this.browserTabs = tabs.filter(tab => 
        tab.url && 
        !tab.url.startsWith('chrome://') && 
        !tab.url.startsWith('chrome-extension://') &&
        !tab.url.startsWith('edge://') &&
        !tab.url.startsWith('about:')
      );
      
      const select = document.getElementById('browserTabSelect');
      if (select) {
        select.innerHTML = this.browserTabs.map(tab => {
          const selected = tab.id === this.currentTabId ? 'selected' : '';
          const title = this.truncate(tab.title || tab.url, 50);
          return `<option value="${tab.id}" ${selected}>${title}</option>`;
        }).join('');
        
        if (this.browserTabs.length === 0) {
          select.innerHTML = '<option value="">No accessible tabs</option>';
        }
      }
    } catch (error) {
      console.error('Failed to load browser tabs:', error);
    }
  }

  async switchBrowserTab(tabId) {
    const tab = this.browserTabs.find(t => t.id === parseInt(tabId));
    if (!tab) return;
    
    this.currentTabId = tab.id;
    this.currentUrl = new URL(tab.url);
    
    document.getElementById('currentDomain').textContent = this.currentUrl.hostname || 'N/A';
    
    this.showLoading(true);
    await this.loadAllData();
    this.showLoading(false);
    this.saveState();
    
    this.showToast(`Switched to ${this.truncate(tab.title, 30)}`, 'success');
  }

  truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
  }

  // ================================
  // Tab & Data Loading
  // ================================

  async getCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        // In fullscreen mode, try to get first valid tab
        if (this.isFullscreen) {
          const tabs = await chrome.tabs.query({});
          const validTab = tabs.find(t => 
            t.url && 
            !t.url.startsWith('chrome://') && 
            !t.url.startsWith('chrome-extension://')
          );
          if (validTab) {
            this.currentTabId = validTab.id;
            this.currentUrl = new URL(validTab.url);
          } else {
            throw new Error('No valid tabs');
          }
        } else {
          throw new Error('No active tab');
        }
      } else {
        this.currentTabId = tab.id;
        this.currentUrl = new URL(tab.url);
      }
      
      document.getElementById('currentDomain').textContent = this.currentUrl.hostname || 'N/A';
    } catch (error) {
      document.getElementById('currentDomain').textContent = 'N/A';
      throw error;
    }
  }

  async loadAllData() {
    await Promise.all([
      this.loadWebStorage('localStorage'),
      this.loadWebStorage('sessionStorage'),
      this.loadCookies()
    ]);
    this.renderCurrentTab();
  }

  async loadWebStorage(type) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: this.currentTabId },
        func: (storageType) => {
          const storage = window[storageType];
          const data = {};
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            data[key] = storage.getItem(key);
          }
          return data;
        },
        args: [type]
      });
      
      this.data[type] = results[0]?.result || {};
    } catch (error) {
      console.error(`Error loading ${type}:`, error);
      this.data[type] = {};
    }
    
    this.updateCount(type);
  }

  async loadCookies() {
    try {
      const cookies = await chrome.cookies.getAll({ url: this.currentUrl.origin });
      this.data.cookies = cookies || [];
    } catch (error) {
      console.error('Error loading cookies:', error);
      this.data.cookies = [];
    }
    
    this.updateCount('cookies');
  }

  updateCount(type) {
    const el = document.getElementById(`${type}Count`);
    const count = type === 'cookies' 
      ? this.data.cookies.length 
      : Object.keys(this.data[type]).length;
    el.textContent = count;
  }

  // ================================
  // Data Operations
  // ================================

  async setWebStorageItem(type, key, value) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: this.currentTabId },
        func: (storageType, k, v) => window[storageType].setItem(k, v),
        args: [type, key, value]
      });
      
      this.data[type][key] = value;
      this.updateCount(type);
      return true;
    } catch (error) {
      console.error(`Error setting ${type} item:`, error);
      return false;
    }
  }

  async removeWebStorageItem(type, key) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: this.currentTabId },
        func: (storageType, k) => window[storageType].removeItem(k),
        args: [type, key]
      });
      
      delete this.data[type][key];
      this.updateCount(type);
      return true;
    } catch (error) {
      console.error(`Error removing ${type} item:`, error);
      return false;
    }
  }

  async setCookie(data) {
    try {
      const cookie = {
        url: this.currentUrl.origin,
        name: data.name,
        value: data.value,
        path: data.path || '/',
        secure: data.secure || false,
        httpOnly: data.httpOnly || false,
        sameSite: data.sameSite || 'lax'
      };
      
      // Fix domain - remove leading dot to prevent duplicates
      if (data.domain) {
        let domain = data.domain;
        // Normalize domain: remove leading dot
        if (domain.startsWith('.')) {
          domain = domain.substring(1);
        }
        // Only set domain if it differs from current hostname
        if (domain !== this.currentUrl.hostname) {
          cookie.domain = domain;
        }
      }
      if (data.expirationDate) cookie.expirationDate = data.expirationDate;
      
      await chrome.cookies.set(cookie);
      await this.loadCookies();
      return true;
    } catch (error) {
      console.error('Error setting cookie:', error);
      return false;
    }
  }

  async removeCookie(name) {
    try {
      await chrome.cookies.remove({
        url: this.currentUrl.origin,
        name: name
      });
      await this.loadCookies();
      return true;
    } catch (error) {
      console.error('Error removing cookie:', error);
      return false;
    }
  }

  // ================================
  // Rendering
  // ================================

  renderCurrentTab() {
    const list = document.getElementById('storageList');
    let items = [];
    
    if (this.currentTab === 'cookies') {
      items = this.data.cookies
        .filter(c => this.matchSearch(c.name, c.value))
        .map(c => this.renderCookieItem(c));
    } else {
      const storage = this.data[this.currentTab];
      items = Object.entries(storage)
        .filter(([k, v]) => this.matchSearch(k, v))
        .map(([k, v]) => this.renderStorageItem(k, v));
    }
    
    if (items.length === 0) {
      list.innerHTML = '';
      this.showEmpty(true);
    } else {
      this.showEmpty(false);
      list.innerHTML = items.join('');
      this.bindItemEvents();
    }
  }

  matchSearch(key, value) {
    if (!this.searchQuery) return true;
    const q = this.searchQuery.toLowerCase();
    return key.toLowerCase().includes(q) || 
           String(value).toLowerCase().includes(q);
  }

  renderStorageItem(key, value) {
    const isJson = this.isJson(value);
    const display = isJson ? JSON.stringify(JSON.parse(value), null, 2) : value;
    const type = isJson ? 'json' : 'string';
    
    return `
      <div class="storage-item" data-key="${this.esc(key)}">
        <div class="storage-item-header">
          <div class="storage-item-key">
            <span class="key-text" title="${this.esc(key)}">${this.esc(key)}</span>
            <span class="type-badge ${type}">${type}</span>
          </div>
          <div class="storage-item-actions">
            <button class="action-btn copy" title="Copy">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
            </button>
            <button class="action-btn edit" title="Edit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="action-btn delete" title="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
              </svg>
            </button>
          </div>
          <div class="storage-item-expand">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </div>
        </div>
        <div class="storage-item-content">
          <div class="storage-item-value">${this.esc(display)}</div>
        </div>
      </div>
    `;
  }

  renderCookieItem(cookie) {
    let meta = '<div class="cookie-meta">';
    
    if (cookie.domain) {
      meta += `<div class="cookie-meta-item"><span class="label">Domain:</span><span class="value">${this.esc(cookie.domain)}</span></div>`;
    }
    if (cookie.path) {
      meta += `<div class="cookie-meta-item"><span class="label">Path:</span><span class="value">${this.esc(cookie.path)}</span></div>`;
    }
    if (cookie.expirationDate) {
      const exp = new Date(cookie.expirationDate * 1000).toLocaleString();
      meta += `<div class="cookie-meta-item"><span class="label">Expires:</span><span class="value">${exp}</span></div>`;
    } else {
      meta += `<div class="cookie-meta-item"><span class="label">Session</span></div>`;
    }
    if (cookie.secure) {
      meta += `<div class="cookie-meta-item flag">Secure</div>`;
    }
    if (cookie.httpOnly) {
      meta += `<div class="cookie-meta-item flag">HttpOnly</div>`;
    }
    if (cookie.sameSite && cookie.sameSite !== 'unspecified') {
      meta += `<div class="cookie-meta-item"><span class="label">SameSite:</span><span class="value">${cookie.sameSite}</span></div>`;
    }
    
    meta += '</div>';
    
    return `
      <div class="storage-item" data-key="${this.esc(cookie.name)}" data-type="cookie">
        <div class="storage-item-header">
          <div class="storage-item-key">
            <span class="key-text" title="${this.esc(cookie.name)}">${this.esc(cookie.name)}</span>
            <span class="type-badge">cookie</span>
          </div>
          <div class="storage-item-actions">
            <button class="action-btn copy" title="Copy">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
            </button>
            <button class="action-btn edit" title="Edit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="action-btn delete" title="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
              </svg>
            </button>
          </div>
          <div class="storage-item-expand">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </div>
        </div>
        <div class="storage-item-content">
          <div class="storage-item-value">${this.esc(cookie.value)}</div>
          ${meta}
        </div>
      </div>
    `;
  }

  // ================================
  // Event Binding
  // ================================

  bindEvents() {
    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', () => this.toggleTheme());
    
    // Refresh
    document.getElementById('refreshBtn').addEventListener('click', () => this.refresh());
    
    // Expand button
    const expandBtn = document.getElementById('expandBtn');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => this.openFullscreen());
    }
    
    // Browser tab selector (fullscreen mode)
    const tabSelect = document.getElementById('browserTabSelect');
    if (tabSelect) {
      tabSelect.addEventListener('change', (e) => {
        if (e.target.value) {
          this.switchBrowserTab(e.target.value);
        }
      });
    }
    
    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
    });
    
    // Search
    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearSearch');
    
    searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      clearBtn.classList.toggle('visible', !!this.searchQuery);
      this.renderCurrentTab();
      this.saveState();
    });
    
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      this.searchQuery = '';
      clearBtn.classList.remove('visible');
      this.renderCurrentTab();
      this.saveState();
    });
    
    // Toolbar buttons
    document.getElementById('addNewBtn').addEventListener('click', () => this.openAddModal());
    document.getElementById('exportBtn').addEventListener('click', () => this.openExportModal());
    document.getElementById('importBtn').addEventListener('click', () => this.openImportModal());
    
    // Modal events
    this.bindModalEvents();
  }

  bindModalEvents() {
    // Edit Modal
    const editModal = document.getElementById('editModal');
    document.getElementById('modalClose').addEventListener('click', () => this.closeModal(editModal));
    document.getElementById('cancelBtn').addEventListener('click', () => this.closeModal(editModal));
    editModal.querySelector('.modal-backdrop').addEventListener('click', () => this.closeModal(editModal));
    document.getElementById('editForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveItem();
    });
    
    // Import Modal
    const importModal = document.getElementById('importModal');
    document.getElementById('importModalClose').addEventListener('click', () => this.closeModal(importModal));
    document.getElementById('importCancelBtn').addEventListener('click', () => this.closeModal(importModal));
    importModal.querySelector('.modal-backdrop').addEventListener('click', () => this.closeModal(importModal));
    
    // Import tabs
    document.querySelectorAll('.import-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.import-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        const type = tab.dataset.import;
        document.getElementById('importFileContent').classList.toggle('hidden', type !== 'file');
        document.getElementById('importTextContent').classList.toggle('hidden', type !== 'text');
      });
    });
    
    // Drop zone
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('importFile');
    
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        this.handleImportFile(e.dataTransfer.files[0]);
      }
    });
    
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) {
        this.handleImportFile(e.target.files[0]);
      }
    });
    
    document.getElementById('importConfirmBtn').addEventListener('click', () => this.confirmImport());
    
    // Export Modal
    const exportModal = document.getElementById('exportModal');
    document.getElementById('exportModalClose').addEventListener('click', () => this.closeModal(exportModal));
    exportModal.querySelector('.modal-backdrop').addEventListener('click', () => this.closeModal(exportModal));
    
    document.getElementById('exportCopyBtn').addEventListener('click', () => this.copyExportData());
    document.getElementById('exportDownloadBtn').addEventListener('click', () => this.downloadExportData());
    
    ['exportLocalStorage', 'exportSessionStorage', 'exportCookies'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => this.updateExportPreview());
    });
  }

  bindItemEvents() {
    // Expand/collapse
    document.querySelectorAll('.storage-item-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (!e.target.closest('.storage-item-actions')) {
          header.closest('.storage-item').classList.toggle('expanded');
        }
      });
    });
    
    // Action buttons
    document.querySelectorAll('.action-btn.copy').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.copyValue(btn.closest('.storage-item').dataset.key);
      });
    });
    
    document.querySelectorAll('.action-btn.edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openEditModal(btn.closest('.storage-item').dataset.key);
      });
    });
    
    document.querySelectorAll('.action-btn.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteItem(btn.closest('.storage-item').dataset.key);
      });
    });
  }

  // ================================
  // Modal Operations
  // ================================

  openModal(modal) {
    modal.classList.add('active');
  }

  closeModal(modal) {
    modal.classList.remove('active');
    this.editingItem = null;
  }

  openAddModal() {
    const modal = document.getElementById('editModal');
    const title = document.getElementById('modalTitle');
    const keyInput = document.getElementById('itemKey');
    const valueInput = document.getElementById('itemValue');
    const cookieFields = document.getElementById('cookieFields');
    
    title.textContent = 'Add New Item';
    keyInput.value = '';
    keyInput.disabled = false;
    valueInput.value = '';
    
    if (this.currentTab === 'cookies') {
      cookieFields.classList.add('visible');
      document.getElementById('cookieDomain').value = this.currentUrl.hostname;
      document.getElementById('cookiePath').value = '/';
      document.getElementById('cookieExpires').value = '';
      document.getElementById('cookieSecure').checked = this.currentUrl.protocol === 'https:';
      document.getElementById('cookieHttpOnly').checked = false;
      document.getElementById('cookieSameSite').value = 'lax';
    } else {
      cookieFields.classList.remove('visible');
    }
    
    this.editingItem = null;
    this.openModal(modal);
    keyInput.focus();
  }

  openEditModal(key) {
    const modal = document.getElementById('editModal');
    const title = document.getElementById('modalTitle');
    const keyInput = document.getElementById('itemKey');
    const valueInput = document.getElementById('itemValue');
    const cookieFields = document.getElementById('cookieFields');
    
    title.textContent = 'Edit Item';
    keyInput.value = key;
    keyInput.disabled = true;
    
    if (this.currentTab === 'cookies') {
      const cookie = this.data.cookies.find(c => c.name === key);
      if (cookie) {
        valueInput.value = cookie.value;
        cookieFields.classList.add('visible');
        // Remove leading dot from domain for editing
        let domain = cookie.domain || '';
        if (domain.startsWith('.')) {
          domain = domain.substring(1);
        }
        document.getElementById('cookieDomain').value = domain;
        document.getElementById('cookiePath').value = cookie.path || '/';
        
        if (cookie.expirationDate) {
          const date = new Date(cookie.expirationDate * 1000);
          document.getElementById('cookieExpires').value = date.toISOString().slice(0, 16);
        } else {
          document.getElementById('cookieExpires').value = '';
        }
        
        document.getElementById('cookieSecure').checked = cookie.secure || false;
        document.getElementById('cookieHttpOnly').checked = cookie.httpOnly || false;
        document.getElementById('cookieSameSite').value = cookie.sameSite || 'lax';
      }
    } else {
      const value = this.data[this.currentTab][key];
      valueInput.value = this.isJson(value) ? JSON.stringify(JSON.parse(value), null, 2) : value;
      cookieFields.classList.remove('visible');
    }
    
    this.editingItem = key;
    this.openModal(modal);
    valueInput.focus();
  }

  async saveItem() {
    const keyInput = document.getElementById('itemKey');
    const valueInput = document.getElementById('itemValue');
    
    const key = keyInput.value.trim();
    let value = valueInput.value;
    
    if (!key) {
      this.showToast('Key is required', 'error');
      return;
    }
    
    // Minify JSON if valid
    if (this.isJson(value)) {
      try {
        value = JSON.stringify(JSON.parse(value));
      } catch {}
    }
    
    let success = false;
    
    if (this.currentTab === 'cookies') {
      const cookieData = {
        name: key,
        value: value,
        domain: document.getElementById('cookieDomain').value || undefined,
        path: document.getElementById('cookiePath').value || '/',
        secure: document.getElementById('cookieSecure').checked,
        httpOnly: document.getElementById('cookieHttpOnly').checked,
        sameSite: document.getElementById('cookieSameSite').value
      };
      
      const expires = document.getElementById('cookieExpires').value;
      if (expires) {
        cookieData.expirationDate = new Date(expires).getTime() / 1000;
      }
      
      success = await this.setCookie(cookieData);
    } else {
      success = await this.setWebStorageItem(this.currentTab, key, value);
    }
    
    if (success) {
      this.closeModal(document.getElementById('editModal'));
      this.renderCurrentTab();
      this.showToast(this.editingItem ? 'Updated' : 'Added', 'success');
    } else {
      this.showToast('Failed to save', 'error');
    }
  }

  async deleteItem(key) {
    if (!confirm(`Delete "${key}"?`)) return;
    
    let success = this.currentTab === 'cookies'
      ? await this.removeCookie(key)
      : await this.removeWebStorageItem(this.currentTab, key);
    
    if (success) {
      this.renderCurrentTab();
      this.showToast('Deleted', 'success');
    } else {
      this.showToast('Failed to delete', 'error');
    }
  }

  async copyValue(key) {
    let value;
    
    if (this.currentTab === 'cookies') {
      const cookie = this.data.cookies.find(c => c.name === key);
      value = cookie?.value || '';
    } else {
      value = this.data[this.currentTab][key] || '';
    }
    
    try {
      await navigator.clipboard.writeText(value);
      this.showToast('Copied', 'success');
    } catch {
      this.showToast('Copy failed', 'error');
    }
  }

  // ================================
  // Import/Export
  // ================================

  openImportModal() {
    const modal = document.getElementById('importModal');
    document.getElementById('importText').value = '';
    document.getElementById('mergeImport').checked = true;
    this.openModal(modal);
  }

  openExportModal() {
    const modal = document.getElementById('exportModal');
    this.updateExportPreview();
    this.openModal(modal);
  }

  updateExportPreview() {
    const data = this.getExportData();
    document.getElementById('exportPreview').textContent = JSON.stringify(data, null, 2);
  }

  getExportData() {
    const data = {
      exportedAt: new Date().toISOString(),
      domain: this.currentUrl.hostname
    };
    
    if (document.getElementById('exportLocalStorage').checked) {
      data.localStorage = this.data.localStorage;
    }
    
    if (document.getElementById('exportSessionStorage').checked) {
      data.sessionStorage = this.data.sessionStorage;
    }
    
    if (document.getElementById('exportCookies').checked) {
      // Normalize cookie domains on export (remove leading dot)
      data.cookies = this.data.cookies.map(c => {
        const cookie = {
          name: c.name,
          value: c.value,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          sameSite: c.sameSite,
          expirationDate: c.expirationDate
        };
        // Normalize domain
        if (c.domain) {
          cookie.domain = c.domain.startsWith('.') ? c.domain.substring(1) : c.domain;
        }
        return cookie;
      });
    }
    
    return data;
  }

  async copyExportData() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(this.getExportData(), null, 2));
      this.showToast('Copied to clipboard', 'success');
    } catch {
      this.showToast('Copy failed', 'error');
    }
  }

  downloadExportData() {
    const data = this.getExportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `storage-${this.currentUrl.hostname}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    this.closeModal(document.getElementById('exportModal'));
    this.showToast('Downloaded', 'success');
  }

  handleImportFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById('importText').value = e.target.result;
      // Switch to text tab
      document.querySelectorAll('.import-tab').forEach(t => t.classList.remove('active'));
      document.querySelector('.import-tab[data-import="text"]').classList.add('active');
      document.getElementById('importFileContent').classList.add('hidden');
      document.getElementById('importTextContent').classList.remove('hidden');
    };
    reader.readAsText(file);
  }

  async confirmImport() {
    const text = document.getElementById('importText').value.trim();
    const merge = document.getElementById('mergeImport').checked;
    
    if (!text) {
      this.showToast('No data to import', 'error');
      return;
    }
    
    let importData;
    try {
      importData = JSON.parse(text);
    } catch {
      this.showToast('Invalid JSON', 'error');
      return;
    }
    
    let count = 0;
    
    // Import localStorage
    if (importData.localStorage) {
      if (!merge) {
        for (const key of Object.keys(this.data.localStorage)) {
          await this.removeWebStorageItem('localStorage', key);
        }
      }
      for (const [key, value] of Object.entries(importData.localStorage)) {
        await this.setWebStorageItem('localStorage', key, value);
        count++;
      }
    }
    
    // Import sessionStorage
    if (importData.sessionStorage) {
      if (!merge) {
        for (const key of Object.keys(this.data.sessionStorage)) {
          await this.removeWebStorageItem('sessionStorage', key);
        }
      }
      for (const [key, value] of Object.entries(importData.sessionStorage)) {
        await this.setWebStorageItem('sessionStorage', key, value);
        count++;
      }
    }
    
    // Import cookies
    if (importData.cookies && Array.isArray(importData.cookies)) {
      if (!merge) {
        for (const cookie of this.data.cookies) {
          await this.removeCookie(cookie.name);
        }
      }
      for (const cookie of importData.cookies) {
        await this.setCookie(cookie);
        count++;
      }
    }
    
    this.closeModal(document.getElementById('importModal'));
    await this.loadAllData();
    this.showToast(`Imported ${count} items`, 'success');
  }

  // ================================
  // Utility Functions
  // ================================

  switchTab(tabName) {
    this.currentTab = tabName;
    
    document.querySelectorAll('.tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    
    this.renderCurrentTab();
    this.saveState();
  }

  async refresh() {
    const btn = document.getElementById('refreshBtn');
    btn.style.animation = 'spin 0.5s linear';
    
    // Also refresh browser tabs in fullscreen mode
    if (this.isFullscreen) {
      await this.loadBrowserTabs();
    }
    
    await this.loadAllData();
    
    setTimeout(() => btn.style.animation = '', 500);
    this.showToast('Refreshed', 'success');
  }

  isJson(str) {
    if (typeof str !== 'string') return false;
    try {
      const result = JSON.parse(str);
      return typeof result === 'object' && result !== null;
    } catch {
      return false;
    }
  }

  esc(str) {
    if (typeof str !== 'string') return str;
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-message">${message}</span>
      <button class="toast-close">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    `;
    
    toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
    container.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'toastOut 200ms var(--ease) forwards';
      setTimeout(() => toast.remove(), 200);
    }, 2500);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => new StorageInspector());
