/* ============================================================
   NOTEPAD — Fast Notes Module (JavaScript)
   Offline-first, localStorage-backed.
   Integrates with Noor Hospital CMS design system.
   ============================================================ */

(function () {
  'use strict';

  const STORAGE_KEY = 'noor_notepad_v1';
  const NOTE_COLORS = [
    { id: 'teal',   hex: '#0f766e' },
    { id: 'indigo', hex: '#4f46e5' },
    { id: 'amber',  hex: '#d97706' },
    { id: 'rose',   hex: '#e11d48' },
    { id: 'sky',    hex: '#0284c7' },
    { id: 'violet', hex: '#7c3aed' },
    { id: 'slate',  hex: '#64748b' },
  ];

  /* ---------- DATA LAYER ---------- */

  function loadNotes() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      // Migrate previous notes format if needed (if it had title & body)
      return Array.isArray(parsed) ? parsed.map(n => {
        if (!n.text) {
          const parts = [n.title && n.title !== 'Untitled' ? n.title : '', n.body || ''].filter(Boolean);
          n.text = parts.join('\n\n') || n.title || '';
        }
        return n;
      }) : [];
    } catch (_) {
      return [];
    }
  }

  function saveNotes(notes) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    } catch (_) {}
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- CONTROLLER ---------- */

  const notepad = {
    notes: [],
    searchQuery: '',
    editingId: null,

    init() {
      this.notes = loadNotes();
      this.bindEvents();
      this.render();
    },

    bindEvents() {
      // Add / Update button
      const addBtn = document.getElementById('notepad-add-btn');
      if (addBtn) addBtn.addEventListener('click', () => this.addOrUpdateNote());

      // Search input
      const searchInput = document.getElementById('notepad-search');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          this.searchQuery = e.target.value.trim().toLowerCase();
          this.renderNotes();
        });
      }

      // Color swatches
      document.querySelectorAll('.notepad-color-swatch').forEach(sw => {
        sw.addEventListener('click', () => {
          document.querySelectorAll('.notepad-color-swatch').forEach(s => s.classList.remove('active'));
          sw.classList.add('active');
        });
      });

      // Keyboard shortcut: Ctrl+Enter or Cmd+Enter to save
      const textInput = document.getElementById('notepad-text');
      if (textInput) {
        textInput.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            this.addOrUpdateNote();
          }
        });
      }
    },

    getSelectedColor() {
      const activeColor = document.querySelector('.notepad-color-swatch.active');
      return activeColor ? activeColor.dataset.color : 'teal';
    },

    setSelectedColor(colorId) {
      document.querySelectorAll('.notepad-color-swatch').forEach(s => {
        s.classList.toggle('active', s.dataset.color === colorId);
      });
    },

    resetForm() {
      const textEl = document.getElementById('notepad-text');
      if (textEl) textEl.value = '';
      this.setSelectedColor('teal');
      this.editingId = null;

      const addBtn = document.getElementById('notepad-add-btn');
      if (addBtn) {
        addBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          Save Note
        `;
      }

      const cancelBtn = document.getElementById('notepad-cancel-edit-btn');
      if (cancelBtn) cancelBtn.remove();
    },

    addOrUpdateNote() {
      const textEl = document.getElementById('notepad-text');
      const text = (textEl ? textEl.value : '').trim();
      const color = this.getSelectedColor();

      if (!text) {
        if (window.app && app.ui && app.ui.showToast) {
          app.ui.showToast('Please enter some text for your note.', 'warning');
        } else {
          alert('Please enter some text for your note.');
        }
        if (textEl) textEl.focus();
        return;
      }

      if (this.editingId) {
        // Update existing note
        const idx = this.notes.findIndex(n => n.id === this.editingId);
        if (idx !== -1) {
          this.notes[idx] = {
            ...this.notes[idx],
            text,
            color,
            updatedAt: new Date().toISOString()
          };
        }
        if (window.app && app.ui && app.ui.showToast) {
          app.ui.showToast('Note updated successfully!');
        }
      } else {
        // Create new note
        const note = {
          id: generateId(),
          text,
          color,
          pinned: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        this.notes.unshift(note);
        if (window.app && app.ui && app.ui.showToast) {
          app.ui.showToast('Note saved successfully!');
        }
      }

      saveNotes(this.notes);
      this.resetForm();
      this.render();
    },

    editNote(id) {
      const note = this.notes.find(n => n.id === id);
      if (!note) return;

      this.editingId = id;
      const textEl = document.getElementById('notepad-text');
      if (textEl) {
        textEl.value = note.text || '';
        textEl.focus();
      }

      this.setSelectedColor(note.color || 'teal');

      // Update button text and add Cancel button if not present
      const addBtn = document.getElementById('notepad-add-btn');
      if (addBtn) {
        addBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>
          Update Note
        `;

        if (!document.getElementById('notepad-cancel-edit-btn')) {
          const cancelBtn = document.createElement('button');
          cancelBtn.type = 'button';
          cancelBtn.id = 'notepad-cancel-edit-btn';
          cancelBtn.className = 'notepad-cancel-btn';
          cancelBtn.textContent = 'Cancel';
          cancelBtn.onclick = () => this.resetForm();
          addBtn.parentNode.insertBefore(cancelBtn, addBtn.nextSibling);
        }
      }

      // Scroll smoothly to quick-add area
      try {
        const quickAdd = document.querySelector('.notepad-quick-add');
        if (quickAdd) quickAdd.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (_) {}
    },

    deleteNote(id) {
      if (!confirm('Are you sure you want to delete this note?')) return;
      this.notes = this.notes.filter(n => n.id !== id);
      saveNotes(this.notes);
      if (this.editingId === id) this.resetForm();
      this.render();
      if (window.app && app.ui && app.ui.showToast) {
        app.ui.showToast('Note deleted.');
      }
    },

    togglePin(id) {
      const note = this.notes.find(n => n.id === id);
      if (note) {
        note.pinned = !note.pinned;
        note.updatedAt = new Date().toISOString();
        saveNotes(this.notes);
        this.render();
      }
    },

    copyNote(id) {
      const note = this.notes.find(n => n.id === id);
      if (note && note.text) {
        navigator.clipboard.writeText(note.text).then(() => {
          if (window.app && app.ui && app.ui.showToast) {
            app.ui.showToast('Note copied to clipboard!');
          }
        }).catch(() => {
          const textarea = document.createElement('textarea');
          textarea.value = note.text;
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          if (window.app && app.ui && app.ui.showToast) {
            app.ui.showToast('Note copied to clipboard!');
          }
        });
      }
    },

    /* ---------- RENDER ---------- */

    getFilteredNotes() {
      let notes = [...this.notes];

      // Search filter
      if (this.searchQuery) {
        notes = notes.filter(n =>
          (n.text || '').toLowerCase().includes(this.searchQuery)
        );
      }

      // Sort: pinned first, then newest first
      notes.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

      return notes;
    },

    render() {
      this.renderStats();
      this.renderNotes();
    },

    renderStats() {
      const total = this.notes.length;
      const totalEl = document.getElementById('notepad-stat-total');
      if (totalEl) totalEl.textContent = total;

      // Update notification badges (dashboard, topbar, sidebar)
      updateNotepadNotificationBadge(total);
    },

    renderNotes() {
      const container = document.getElementById('notepad-grid');
      if (!container) return;

      const notes = this.getFilteredNotes();

      if (notes.length === 0) {
        container.innerHTML = `
          <div class="notepad-empty" style="grid-column: 1 / -1;">
            <div class="notepad-empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <line x1="10" y1="9" x2="8" y2="9"/>
              </svg>
            </div>
            <div class="notepad-empty-title">${this.searchQuery ? 'No Matching Notes' : 'No Notes Yet'}</div>
            <div class="notepad-empty-desc">${this.searchQuery ? 'Try a different search term.' : 'Write your note in the box above and click Save Note. All notes are saved locally on this device.'}</div>
          </div>
        `;
        return;
      }

      container.innerHTML = notes.map((note, idx) => {
        const colorObj = NOTE_COLORS.find(c => c.id === note.color) || NOTE_COLORS[0];
        const date = new Date(note.createdAt);
        const dateStr = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

        return `
          <div class="notepad-card" data-id="${note.id}" style="animation-delay: ${idx * 0.03}s">
            <div class="notepad-card-accent" style="background: ${colorObj.hex}"></div>
            <div class="notepad-card-body">
              ${note.pinned ? `
                <div class="notepad-pin-badge">
                  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M16 2a1 1 0 0 0-.72.31l-3.52 3.74-3.87-.8a1 1 0 0 0-.99.37L4.34 9.3a1 1 0 0 0 .2 1.38l3.2 2.5-3.43 3.43a1 1 0 0 0 0 1.41 1 1 0 0 0 1.41 0l3.43-3.43 2.5 3.2a1 1 0 0 0 1.38.2l3.68-2.56a1 1 0 0 0 .37-.99l-.8-3.87 3.74-3.52A1 1 0 0 0 20.33 6l-2.4-3.54A1 1 0 0 0 16 2z"/></svg>
                  Pinned
                </div>
              ` : ''}
              <div class="notepad-card-text">${this.escapeHtml(note.text || '')}</div>
            </div>
            <div class="notepad-card-footer">
              <span class="notepad-card-date">${dateStr} &bull; ${timeStr}</span>
              <div class="notepad-card-actions">
                <button class="notepad-card-action" title="Copy to clipboard" onclick="window.notepadModule.copyNote('${note.id}')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                </button>
                <button class="notepad-card-action ${note.pinned ? 'active-pin' : ''}" title="${note.pinned ? 'Unpin' : 'Pin to top'}" onclick="window.notepadModule.togglePin('${note.id}')">
                  <svg viewBox="0 0 24 24" fill="${note.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z"/></svg>
                </button>
                <button class="notepad-card-action" title="Edit note" onclick="window.notepadModule.editNote('${note.id}')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                </button>
                <button class="notepad-card-action delete" title="Delete note" onclick="window.notepadModule.deleteNote('${note.id}')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/></svg>
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    },

    escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }
  };

  /* ---------- NOTIFICATION BADGE & MESSENGER BUBBLE CONTROLLER ---------- */

  function updateNotepadNotificationBadge(count) {
    let notes = [];
    if (window.notepadModule && Array.isArray(window.notepadModule.notes) && window.notepadModule.notes.length) {
      notes = window.notepadModule.notes;
    } else {
      notes = loadNotes();
    }

    if (typeof count !== 'number') {
      count = notes.length;
    }

    // 1. Sidebar badge
    const sidebarBadge = document.getElementById('sidebar-notepad-badge');
    if (sidebarBadge) {
      sidebarBadge.textContent = count;
      sidebarBadge.style.display = count > 0 ? '' : 'none';
    }

    // 2. Floating Facebook Messenger-style Single Bubble
    const wrapper = document.getElementById('note-messenger-wrapper');
    const activePanel = document.querySelector('.panel.active');
    const isNotepadPanel = activePanel && activePanel.id === 'panel-notepad';

    if (wrapper) {
      // Show floating bubble ONLY if notes exist (count > 0) AND user is not on full Notepad panel
      if (count > 0 && !isNotepadPanel) {
        wrapper.style.display = 'block';
      } else {
        wrapper.style.display = 'none';
        if (window.closeNotesBubblePopup) window.closeNotesBubblePopup();
      }
    }

    const bubbleStack = document.getElementById('note-bubble-stack');
    if (bubbleStack) {
      bubbleStack.setAttribute('title', `${count} saved note${count !== 1 ? 's' : ''} — click to view or add notes`);
    }

    // Number badge on the single bubble
    const bubbleBadge = document.getElementById('note-bubble-badge');
    if (bubbleBadge) {
      bubbleBadge.textContent = count > 99 ? '99+' : count;
      bubbleBadge.style.display = 'flex';
    }

    // Populate Messenger popup card with notes
    const popupSubtitle = document.getElementById('note-popup-subtitle');
    if (popupSubtitle) {
      popupSubtitle.textContent = count === 1 ? '1 saved note' : `${count} saved notes`;
    }

    const popupBody = document.getElementById('note-popup-body');
    if (popupBody) {
      if (notes.length === 0) {
        popupBody.innerHTML = `
          <div style="padding: 24px 12px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
            No notes yet. Type a note above and click Add Note!
          </div>
        `;
      } else {
        popupBody.innerHTML = notes.map(note => {
          const colorObj = NOTE_COLORS.find(c => c.id === note.color) || NOTE_COLORS[0];
          const date = new Date(note.createdAt);
          const dateStr = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
          const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
          const safeText = (notepad.escapeHtml ? notepad.escapeHtml(note.text || '') : (note.text || ''))
            .replace(/</g, '&lt;').replace(/>/g, '&gt;');

          return `
            <div class="note-popup-item" onclick="if(window.app && app.ui){app.ui.switchTab('notepad');} window.closeNotesBubblePopup();" title="Click to open this note in Notepad">
              <div class="note-popup-item-accent" style="background: ${colorObj.hex}"></div>
              <div class="note-popup-item-content">
                <div class="note-popup-item-header">
                  <div style="display:flex; align-items:center; gap:6px; overflow:hidden;">
                    <span class="note-popup-item-date">${dateStr} &bull; ${timeStr}</span>
                    ${note.pinned ? `
                      <span class="note-popup-item-pinned">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 2a1 1 0 0 0-.72.31l-3.52 3.74-3.87-.8a1 1 0 0 0-.99.37L4.34 9.3a1 1 0 0 0 .2 1.38l3.2 2.5-3.43 3.43a1 1 0 0 0 0 1.41 1 1 0 0 0 1.41 0l3.43-3.43 2.5 3.2a1 1 0 0 0 1.38.2l3.68-2.56a1 1 0 0 0 .37-.99l-.8-3.87 3.74-3.52A1 1 0 0 0 20.33 6l-2.4-3.54A1 1 0 0 0 16 2z"/></svg>
                        Pinned
                      </span>
                    ` : ''}
                  </div>
                  <button type="button" class="note-popup-del-btn" title="Delete note" onclick="event.stopPropagation(); window.deleteNoteFromPopup('${note.id}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/></svg>
                  </button>
                </div>
                <div class="note-popup-item-text">${safeText}</div>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  }

  /* ---------- QUICK ADD & DELETE NOTE DIRECTLY FROM POPUP ---------- */

  window.addNoteFromPopup = function() {
    const input = document.getElementById('note-popup-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }

    const activeColorEl = document.querySelector('.note-popup-color-dot.active');
    const color = activeColorEl ? activeColorEl.dataset.color : 'teal';

    const newNote = {
      id: generateId(),
      text: text,
      color: color,
      pinned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!Array.isArray(notepad.notes)) notepad.notes = [];
    notepad.notes.unshift(newNote);
    saveNotes(notepad.notes);
    input.value = '';

    notepad.render();
    if (window.app && app.ui && app.ui.showToast) {
      app.ui.showToast('Note saved!');
    }
  };

  window.deleteNoteFromPopup = function(id) {
    if (!id) return;
    if (!confirm('Are you sure you want to delete this note?')) return;
    notepad.notes = (notepad.notes || []).filter(n => n.id !== id);
    saveNotes(notepad.notes);
    if (notepad.editingId === id) notepad.resetForm();
    notepad.render();
    if (window.app && app.ui && app.ui.showToast) {
      app.ui.showToast('Note deleted.');
    }
  };

  function bindPopupEvents() {
    // Color swatches in popup
    const popupColors = document.querySelectorAll('.note-popup-color-dot');
    popupColors.forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        popupColors.forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
      });
    });

    // Enter key to quickly save note in popup
    const popupInput = document.getElementById('note-popup-input');
    if (popupInput) {
      popupInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          window.addNoteFromPopup();
        }
      });
    }
  }

  window.toggleNotesBubblePopup = function(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    const popup = document.getElementById('note-bubble-popup');
    if (!popup) return;
    const isHidden = popup.style.display === 'none' || !popup.style.display;
    popup.style.display = isHidden ? 'flex' : 'none';

    if (isHidden) {
      setTimeout(() => {
        const input = document.getElementById('note-popup-input');
        if (input) input.focus();
      }, 50);
    }
  };

  window.closeNotesBubblePopup = function() {
    const popup = document.getElementById('note-bubble-popup');
    if (popup) popup.style.display = 'none';
  };

  // Close popup when clicking outside the bubble or popup
  document.addEventListener('click', function(e) {
    const wrapper = document.getElementById('note-messenger-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
      window.closeNotesBubblePopup();
    }
  });

  window.updateNotepadNotificationBadge = updateNotepadNotificationBadge;

  /* ---------- EXPOSE & AUTO-INIT ---------- */
  window.notepadModule = notepad;

  // Immediate badge sync from localStorage even before full DOM load
  try { updateNotepadNotificationBadge(); } catch (_) {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      notepad.init();
      bindPopupEvents();
      updateNotepadNotificationBadge();
    });
  } else {
    setTimeout(() => {
      notepad.init();
      bindPopupEvents();
      updateNotepadNotificationBadge();
    }, 0);
  }
})();
