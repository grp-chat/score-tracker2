// client/js/index.js
// Full app JS with manual dark-mode toggle and password-protected scoreboard (password: "8888").
// Locked scoreboard disables color selects, inc/dec, drag and disables header actions except Back and Theme toggle.

(function () {
  const L = (...args) => console.log("[CTRK]", ...args);

  document.addEventListener("DOMContentLoaded", () => {
    L("DOM ready — starting script");

    const $ = id => {
      const el = document.getElementById(id);
      if (!el) L("MISSING ELEMENT:", id);
      return el;
    };

    // Socket safe init
    let socket;
    try {
      socket = io();
      L("socket.io client created");
    } catch (err) {
      console.warn("[CTRK] socket.io not available:", err);
      socket = null;
    }

    // Elements
    const screenMain = $("screen-main");
    const screenAdd = $("screen-add");
    const screenScore = $("screen-score");

    const btnAddPlayers = $("btn-add-players");
    const btnScoreboard = $("btn-scoreboard");
    const btnClearData = $("btn-clear-data");

    const btnBackFromAdd = $("btn-back-from-add");
    const btnBackFromScore = $("btn-back-from-score");

    const btnAddFromText = $("btn-add-from-text");
    const btnSavePlayers = $("btn-save-players");

    const multiInput = $("multi-input");
    const playersList = $("players-list");

    const board = $("board");
    const teamsList = $("teams-list");
    const btnToggleDrag = $("btn-toggle-drag");

    const btnSavePositions = $("btn-save-positions"); // optional
    const btnThemeToggle = $("btn-theme-toggle");

    const uiBlocker = $("ui-blocker");
    const spinnerText = $("spinner-text");

    if (!screenMain || !screenAdd || !screenScore) {
      L("Warning: one or more screen elements missing.");
    }

    // Colors (with names)
    const COLOR_MAP = [
      { name: "Red", hex: "#e6194b" },
      { name: "Green", hex: "#3cb44b" },
      { name: "Yellow", hex: "#ffe119" },
      { name: "Blue", hex: "#0082c8" },
      { name: "Orange", hex: "#f58231" },
      { name: "Purple", hex: "#911eb4" },
      { name: "Cyan", hex: "#46f0f0" },
      { name: "Pink", hex: "#f032e6" },
      { name: "Lime", hex: "#d2f53c" },
      { name: "Peach", hex: "#fabebe" }
    ];

    const TEAM_COLORS = COLOR_MAP.map(c => c.hex);

    // App state
    let appData = []; // {id,name,score,color,pos}
    let dragEnabled = false;
    let draggingCard = null;
    let dragOffset = { x: 0, y: 0 };

    const defaultPos = new Map();

    const CARD_WIDTH = 200;
    const CARD_HEIGHT_APPROX = 140;
    const CASCADE_OFFSET = 6;
    const DEFAULT_RAISE = 0;

    // Scoreboard lock state (true when wrong password)
    let scoreboardLocked = false;

    // Utilities
    function makeId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
    function normalizeName(s){ return (s || "").trim().toUpperCase().replace(/\s+/g,' '); }
    function escapeHtml(s){ if(!s) return ''; return s.replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m])); }

    // Theme handling
    function applyTheme(theme){
      try {
        if (theme === 'dark') document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');

        if (btnThemeToggle) btnThemeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
        localStorage.setItem('ctrk_theme', theme);
      } catch(e){ L('theme apply failed', e); }
    }
    function initTheme(){
      const stored = localStorage.getItem('ctrk_theme');
      if (stored) { applyTheme(stored); return; }
      // default to light
      applyTheme('light');
    }
    if (btnThemeToggle) {
      btnThemeToggle.addEventListener('click', () => {
        const current = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
        applyTheme(current === 'dark' ? 'light' : 'dark');
      });
    }
    initTheme();

    // Screens
    function showScreen(screenEl){
      [screenMain, screenAdd, screenScore].forEach(s => { if (s) s.classList.add('hidden'); });
      if (screenEl) screenEl.classList.remove('hidden');

      if (screenEl === screenScore) {
        requestAnimationFrame(()=> {
          requestAnimationFrame(()=> {
            defaultPos.clear();
            ensureDefaultPositions();
            renderBoard();
            applyScoreboardLock();
          });
        });
      }
    }

    function lockUI(msg='Working...'){
      if (uiBlocker) { uiBlocker.classList.remove('hidden'); if (spinnerText) spinnerText.textContent = msg; }
      document.querySelectorAll('button, textarea, input').forEach(n => n.disabled = true);
    }
    function unlockUI(){
      if (uiBlocker) uiBlocker.classList.add('hidden');
      document.querySelectorAll('button, textarea, input').forEach(n => n.disabled = false);
    }

    // Socket wrappers
    function safeEmit(evt, payload){
      if (!socket) { L("socket unavailable, skipping emit:", evt); return; }
      try { socket.emit(evt, payload); }
      catch (e) { console.error("[CTRK] socket emit failed:", evt, e); }
    }

    // Socket handlers
    if (socket) {
      socket.on('connect', () => { L('socket connected', socket.id); requestLatestData(); });
      socket.on('disconnect', () => L('socket disconnected'));
      socket.on('operation:start', ({message}) => lockUI(message || 'Working...'));
      socket.on('operation:end', () => { setTimeout(()=>unlockUI(), 120); });
      socket.on('operation:error', ({message}) => { alert('Server error: '+message); unlockUI(); });

      socket.on('latest-data', (data) => {
        L('latest-data received', data);
        if (!Array.isArray(data)) appData = [];
        else appData = data.map(p => ({
          id: p.id || makeId(),
          name: p.name || '',
          score: Number(p.score || 0),
          color: p.color || null,
          pos: p.pos || null
        }));

        renderPlayersList();

        if (!screenScore.classList.contains('hidden')) {
          requestAnimationFrame(()=>requestAnimationFrame(()=>{ ensureDefaultPositions(); renderBoard(); applyScoreboardLock(); }));
        } else {
          renderBoard();
        }

        unlockUI();
      });

      socket.on('save-complete', () => {
        L('save-complete -> re-requesting latest');
        requestLatestData();
      });
    }

    // API wrappers
    function requestLatestData(){
      lockUI('Reading data...');
      safeEmit('request-latest-data');
      if (!socket) setTimeout(()=>unlockUI(), 400);
    }
    function saveToServer(message='Save data'){
      lockUI('Saving data...');
      safeEmit('save-data', { data: appData, message });
      if (!socket) setTimeout(()=>unlockUI(), 400);
    }
    function clearOnServer(){
      if (!confirm('Clear all data?')) return;
      lockUI('Clearing data...');
      safeEmit('clear-data');
      if (!socket) setTimeout(()=>unlockUI(), 400);
    }

    // Compute default positions
    function ensureDefaultPositions() {
      if (!board) return;

      const bw = board.clientWidth || window.innerWidth;
      const bh = board.clientHeight || window.innerHeight;

      const unsaved = appData.filter(p => !p.pos);
      unsaved.forEach((p, i) => {
        if (defaultPos.has(p.id)) return;

        const left = Math.max(0, bw - CARD_WIDTH - (CASCADE_OFFSET * i));
        const top  = Math.max(0, bh - CARD_HEIGHT_APPROX - (CASCADE_OFFSET * i) - DEFAULT_RAISE);

        defaultPos.set(p.id, { left: left + 'px', top: top + 'px' });
      });
    }

    // Render players list
    function renderPlayersList(){
      if (!playersList) return;
      playersList.innerHTML = '';
      if (!appData.length) {
        playersList.innerHTML = '<li class="muted">No players yet</li>';
        return;
      }
      appData.forEach(p => {
        const li = document.createElement('li');
        li.className = 'player-row';
        li.innerHTML = `
          <div class="name">${escapeHtml(p.name)}</div>
          <div class="row-actions">
            <button class="edit-btn" data-id="${p.id}">Edit</button>
            <button class="del-btn" data-id="${p.id}">Delete</button>
          </div>`;
        playersList.appendChild(li);
      });

      playersList.querySelectorAll('.del-btn').forEach(b =>
        b.addEventListener('click', () => {
          const id = b.dataset.id;
          appData = appData.filter(x => x.id !== id);
          defaultPos.delete(id);
          renderPlayersList();
          renderBoard();
        })
      );

      playersList.querySelectorAll('.edit-btn').forEach(b =>
        b.addEventListener('click', () => {
          const id = b.dataset.id;
          const p = appData.find(x => x.id === id);
          if (!p) return;
          const newName = prompt('Edit player name', p.name);
          if (newName === null) return;
          const name = normalizeName(newName);
          if (!name) return;
          p.name = name;
          renderPlayersList();
        })
      );
    }

    // Apply scoreboard lock/enable states
    function applyScoreboardLock(){
      if (!screenScore || screenScore.classList.contains('hidden')) return;

      // Elements inside scoreboard to toggle
      const inside = Array.from(screenScore.querySelectorAll('button, select, input, textarea'));
      inside.forEach(el => {
        if (el.id === 'btn-back-from-score') {
          el.disabled = false; // always allow back
          return;
        }
        // theme toggle is outside and should remain enabled
        if (el.id === 'btn-theme-toggle') { el.disabled = false; return; }
        el.disabled = scoreboardLocked;
      });

      // Header buttons (outside scoreboard) — disable when locked except theme toggle and back button
      [btnAddPlayers, btnScoreboard, btnClearData].forEach(b => {
        if (!b) return;
        b.disabled = scoreboardLocked;
      });

      if (btnToggleDrag) btnToggleDrag.disabled = scoreboardLocked;
      if (btnSavePositions) btnSavePositions.disabled = scoreboardLocked;

      // Per-card elements
      board.querySelectorAll('.inc, .dec, .color-select').forEach(el => {
        el.disabled = scoreboardLocked;
      });

      // Dragging disabled when locked
      if (scoreboardLocked) {
        dragEnabled = false;
        document.querySelectorAll('.player-card').forEach(c => c.style.cursor = 'default');
      }

      // Visual class
      if (scoreboardLocked) screenScore.classList.add('locked');
      else screenScore.classList.remove('locked');
    }

    // Render board
    function renderBoard(){
      if (!board) return;
      board.innerHTML = '';
      if (!appData.length) {
        board.innerHTML = '<div class="muted" style="padding:18px">No players — go add some.</div>';
        if (teamsList) teamsList.innerHTML = '';
        return;
      }

      ensureDefaultPositions();

      appData.forEach(p => {
        const card = document.createElement('div');
        card.className = 'player-card';
        card.dataset.id = p.id;

        if (p.pos) {
          card.style.left = p.pos.left;
          card.style.top  = p.pos.top;
        } else if (defaultPos.has(p.id)) {
          const d = defaultPos.get(p.id);
          card.style.left = d.left;
          card.style.top  = d.top;
        } else {
          card.style.left = '8px';
          card.style.top  = '8px';
        }

        const colorStyle = p.color ? `background:${p.color}` : '';

        const optionsHtml = COLOR_MAP.map(c =>
          `<option value="${c.hex}" ${p.color===c.hex ? 'selected' : ''}>${c.name}</option>`
        ).join('');

        card.innerHTML = `
          <div class="card-top">
            <div class="name" style="${colorStyle}">${escapeHtml(p.name)}</div>
            <div class="score">${p.score}</div>
          </div>
          <div class="controls">
            <div class="left-controls">
              <select class="color-select" data-id="${p.id}">
                <option value="">NO TEAM</option>
                ${optionsHtml}
              </select>
            </div>
            <div class="right-controls">
              <button class="dec" data-id="${p.id}">-</button>
              <button class="inc" data-id="${p.id}">+</button>
            </div>
          </div>
        `;
        board.appendChild(card);
      });

      // attach handlers
      board.querySelectorAll('.player-card').forEach(card => {
        card.addEventListener('mousedown', startDrag);
        card.addEventListener('touchstart', startDrag, { passive: false });

        card.querySelectorAll('.inc').forEach(b =>
          b.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (scoreboardLocked) return;
            changeScore(card.dataset.id, +1);
          })
        );
        card.querySelectorAll('.dec').forEach(b =>
          b.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (scoreboardLocked) return;
            changeScore(card.dataset.id, -1);
          })
        );

        const sel = card.querySelector('.color-select');
        if (sel) {
          sel.addEventListener('change', () => {
            if (scoreboardLocked) {
              // revert attempted change by re-rendering
              renderBoard();
              return;
            }
            const id = sel.dataset.id;
            const val = sel.value || null;
            const p = appData.find(x => x.id === id);
            if (!p) return;
            p.color = val;
            renderBoard();
            saveToServer(`Assign color`);
          });
        }
      });

      renderTeamsPanel();

      // Ensure lock is applied to newly created controls
      applyScoreboardLock();
    }

    // Save positions
    function saveAllPositions() {
      if (scoreboardLocked) return;
      const cards = board.querySelectorAll('.player-card');
      cards.forEach(card => {
        const id = card.dataset.id;
        const p = appData.find(x => x.id === id);
        if (!p) return;
        p.pos = {
          left: card.style.left,
          top: card.style.top
        };
      });
      saveToServer("Save all positions");
    }

    // Dragging
    function startDrag(e){
      if (!dragEnabled) return;
      if (scoreboardLocked) return;
      e.preventDefault();
      const card = e.currentTarget;
      draggingCard = card;
      card.classList.add('dragging');

      const rect = card.getBoundingClientRect();
      const boardRect = board.getBoundingClientRect();

      const clientX = (e.touches ? e.touches[0].clientX : e.clientX);
      const clientY = (e.touches ? e.touches[0].clientY : e.clientY);

      dragOffset.x = clientX - rect.left;
      dragOffset.y = clientY - rect.top;

      function onMove(ev){
        const mx = (ev.touches ? ev.touches[0].clientX : ev.clientX);
        const my = (ev.touches ? ev.touches[0].clientY : ev.clientY);

        let left = mx - boardRect.left - dragOffset.x;
        let top  = my - boardRect.top  - dragOffset.y;

        left = Math.max(0, Math.min(left, board.clientWidth - card.offsetWidth));
        top  = Math.max(0, Math.min(top, board.clientHeight - card.offsetHeight));

        card.style.left = left + 'px';
        card.style.top  = top + 'px';
      }

      function onUp(){
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);

        if (draggingCard) draggingCard.classList.remove('dragging');

        const id = card.dataset.id;
        const p = appData.find(x => x.id === id);
        if (p) {
          p.pos = {
            left: card.style.left,
            top:  card.style.top
          };
          defaultPos.delete(id);
        }

        draggingCard = null;
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive:false });
      document.addEventListener('touchend', onUp);
    }

    // Score change
    function changeScore(id, delta){
      const p = appData.find(x => x.id === id);
      if (!p) return;
      p.score = (Number(p.score) || 0) + delta;
      if (p.score < 0) p.score = 0;
      renderBoard();
      saveToServer(`Change score`);
    }

    // Teams panel
    function renderTeamsPanel(){
      if (!teamsList) return;
      const totals = {};
      appData.forEach(p => {
        const key = p.color || '(Unassigned)';
        totals[key] = (totals[key] || 0) + (Number(p.score) || 0);
      });

      const rows = Object.keys(totals).map(k => {
        let label = k;
        if (k !== "(Unassigned)") {
          const found = COLOR_MAP.find(c => c.hex === k);
          const name = found ? found.name : k;
          label = `<span class="color-bullet" style="background:${k}"></span> ${name}`;
        }
        return `<div class="team-row"><div class="team-label">${label}</div><div class="team-score">${totals[k]}</div></div>`;
      }).join('');

      teamsList.innerHTML = rows || '<div class="muted">No teams</div>';
    }

    // Add names from input
    function addNamesFromInput(){
      if (!multiInput) return;
      const text = multiInput.value || '';
      if (!text.trim()) return;
      const parts = text.split(/\n|,/).map(x => x.trim()).filter(Boolean);
      parts.forEach(raw => {
        const name = normalizeName(raw);
        if (!name) return;
        if (!appData.some(p => p.name === name)) {
          appData.push({ id: makeId(), name, score: 0, color: null, pos: null });
        }
      });
      multiInput.value = '';
      ensureDefaultPositions();
      renderPlayersList();
      renderBoard();
    }

    // Input uppercase
    if (multiInput) {
      multiInput.addEventListener('input', () => {
        const start = multiInput.selectionStart;
        multiInput.value = multiInput.value.toUpperCase();
        multiInput.selectionStart = multiInput.selectionEnd = start;
      });
    }

    // Password check when opening scoreboard
    function openScoreboardWithPassword() {
      const pw = prompt('Enter scoreboard password');
      if (pw === null) {
        // user cancelled prompt — do not open scoreboard
        return;
      }
      if (String(pw) === '8888') scoreboardLocked = false;
      else scoreboardLocked = true;

      showScreen(screenScore);
      requestLatestData();
      applyScoreboardLock();
    }

    // Buttons wiring
    if (btnAddPlayers) btnAddPlayers.addEventListener('click', ()=> { showScreen(screenAdd); requestLatestData(); });
    if (btnScoreboard) btnScoreboard.addEventListener('click', openScoreboardWithPassword);

    if (btnBackFromAdd) btnBackFromAdd.addEventListener('click', ()=> showScreen(screenMain));
    if (btnBackFromScore) btnBackFromScore.addEventListener('click', ()=> {
      scoreboardLocked = false; // clear locked mode when leaving
      showScreen(screenMain);
      applyScoreboardLock();
    });

    if (btnAddFromText) btnAddFromText.addEventListener('click', addNamesFromInput);
    if (btnSavePlayers) btnSavePlayers.addEventListener('click', ()=> {
      appData = appData.map(p => ({ ...p, id: p.id || makeId(), name: normalizeName(p.name), score: Number(p.score || 0) }));
      ensureDefaultPositions();
      renderPlayersList();
      renderBoard();
      saveToServer('Save players list');
    });

    if (btnToggleDrag) btnToggleDrag.addEventListener('click', ()=> {
      if (scoreboardLocked) return; // ignore when locked
      dragEnabled = !dragEnabled;
      btnToggleDrag.textContent = dragEnabled ? 'Lock Drag' : 'Unlock Drag';
      document.querySelectorAll('.player-card').forEach(c => c.style.cursor = dragEnabled ? 'grab' : 'default');
    });

    if (btnSavePositions) btnSavePositions.addEventListener("click", saveAllPositions);

    if (btnClearData) btnClearData.addEventListener('click', clearOnServer);

    // Recompute default positions on resize
    window.addEventListener('resize', () => {
      defaultPos.clear();
      if (!screenScore.classList.contains('hidden')) {
        requestAnimationFrame(()=>requestAnimationFrame(()=>{ ensureDefaultPositions(); renderBoard(); applyScoreboardLock(); }));
      } else {
        ensureDefaultPositions();
        renderBoard();
      }
    });

    // initial load
    L('initializing: requesting data...');
    lockUI('Initializing…');
    requestLatestData();
  });
})();
