/**
 * AUXIAH - Monitor Page JavaScript
 * Handles: Leaflet map, WebSocket, request list, markers
 */

(function () {
  'use strict';

  /* ---- DOM refs ---- */
  const connIndicator = document.getElementById('conn-indicator');
  const requestList   = document.getElementById('request-list');
  const notifBadge    = document.getElementById('notif-badge');
  const filterBtns    = document.querySelectorAll('.filter-btn');

  /* ---- State ---- */
  let map = null;
  let monitorMarker = null;
  let monitorLocation = null;   // { lat, lng }
  let markers = {};             // id -> Leaflet marker
  let requests = [];            // all received requests
  let activeFilter = 'ALL';
  let unreadCount = 0;
  let ws = null;
  let wsReconnectTimer = null;

  /* ---- Type config ---- */
  const TYPE_CONFIG = {
    ASISTENCIA: { color: '#2196F3', emoji: '🆘', label: 'Asistencia' },
    EMERGENCIA: { color: '#F44336', emoji: '🚨', label: 'Emergencia' },
    URGENCIA:   { color: '#FF9800', emoji: '⚠️', label: 'Urgencia'   }
  };

  /* ======================================================
     Map init
  ====================================================== */
  function initMap(lat, lng) {
    if (map) return;

    map = L.map('map', {
      center: [lat, lng],
      zoom: 14,
      zoomControl: true
    });

    // Dark tile layer (CartoDB Dark Matter)
    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
      }
    ).addTo(map);

    // Monitor marker (blue circle)
    monitorMarker = L.circleMarker([lat, lng], {
      radius: 12,
      fillColor: '#FFD700',
      color: '#fff',
      weight: 3,
      fillOpacity: 0.95
    }).addTo(map).bindPopup('<strong>📍 Monitor AUXIAH</strong><br>Tu ubicación actual');
  }

  function updateMonitorLocation(lat, lng) {
    monitorLocation = { lat, lng };
    if (!map) {
      initMap(lat, lng);
    } else {
      monitorMarker.setLatLng([lat, lng]);
    }
  }

  /* ======================================================
     Geolocation - monitor's own position
  ====================================================== */
  function startWatchingPosition() {
    if (!navigator.geolocation) {
      // Fallback: center on CDMX
      updateMonitorLocation(19.4326, -99.1332);
      return;
    }

    navigator.geolocation.watchPosition(
      (pos) => {
        updateMonitorLocation(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        // Fallback center
        if (!map) updateMonitorLocation(19.4326, -99.1332);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }

  /* ======================================================
     Markers
  ====================================================== */
  function createIcon(requestType) {
    const cfg = TYPE_CONFIG[requestType] || { emoji: '📌' };
    // requestType is used only as a tooltip title; escape it to be safe
    return L.divIcon({
      className: '',
      html: `<div class="custom-marker" title="${escapeHtml(requestType)}">${cfg.emoji}</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -20]
    });
  }

  function addOrUpdateMarker(request) {
    if (!map || !request.location) return;
    const { lat, lng } = request.location;
    const cfg = TYPE_CONFIG[request.requestType] || {};

    const popupContent =
      `<div style="min-width:180px">
        <strong style="color:${cfg.color || '#fff'}">${cfg.emoji} ${escapeHtml(request.requestType)}</strong><br>
        <em style="color:#aaa;font-size:0.8em">${escapeHtml(formatTime(request.timestamp))}</em><br><br>
        ${request.message ? `<span>${escapeHtml(request.message)}</span>` : '<span style="color:#666">Sin mensaje</span>'}
      </div>`;

    if (markers[request.id]) {
      markers[request.id].setPopupContent(popupContent);
    } else {
      const m = L.marker([lat, lng], { icon: createIcon(request.requestType) })
        .addTo(map)
        .bindPopup(popupContent);
      markers[request.id] = m;

      // Pulse animation: bounce the marker
      m.on('add', () => {
        const el = m.getElement();
        if (el) {
          el.style.transition = 'transform 0.2s';
          el.style.transform = 'scale(1.5)';
          setTimeout(() => { el.style.transform = 'scale(1)'; }, 300);
        }
      });
    }
  }

  /* ======================================================
     Request list (sidebar)
  ====================================================== */
  function renderList() {
    requestList.innerHTML = '';
    const filtered = activeFilter === 'ALL'
      ? requests
      : requests.filter(r => r.requestType === activeFilter);

    // Most recent first
    [...filtered].reverse().forEach(r => {
      const card = buildCard(r);
      requestList.appendChild(card);
    });
  }

  function buildCard(request) {
    const cfg = TYPE_CONFIG[request.requestType] || {};
    // Only use known requestType values for CSS class names to prevent injection
    const safeType = TYPE_CONFIG[request.requestType] ? request.requestType : 'UNKNOWN';
    const card = document.createElement('div');
    card.className = `req-card ${safeType}`;
    card.dataset.id = request.id;

    card.innerHTML =
      `<div class="req-card-type">${cfg.emoji || ''} ${escapeHtml(request.requestType)}</div>
       <div class="req-card-msg">${request.message ? escapeHtml(request.message) : '<em>Sin mensaje</em>'}</div>
       <div class="req-card-meta">
         🕐 ${escapeHtml(formatTime(request.timestamp))}
         ${request.location ? ` &nbsp;|&nbsp; 📍 ${request.location.lat.toFixed(5)}, ${request.location.lng.toFixed(5)}` : ' &nbsp;|&nbsp; 📍 Sin ubicación'}
       </div>`;

    card.addEventListener('click', () => {
      if (request.location && map) {
        map.flyTo([request.location.lat, request.location.lng], 16, { duration: 1 });
        if (markers[request.id]) markers[request.id].openPopup();
      }
    });

    return card;
  }

  function addRequest(request, isNew) {
    requests.push(request);
    addOrUpdateMarker(request);
    renderList();

    if (isNew) {
      unreadCount++;
      notifBadge.textContent = unreadCount;
      notifBadge.classList.add('visible');

      // Highlight newest card briefly
      const card = requestList.querySelector(`[data-id="${request.id}"]`);
      if (card) {
        card.classList.add('new');
        setTimeout(() => card.classList.remove('new'), 4000);
      }

      // Pan map to new request if it has location
      if (request.location && map) {
        map.flyTo([request.location.lat, request.location.lng], 15, { duration: 1.5 });
        if (markers[request.id]) {
          setTimeout(() => markers[request.id].openPopup(), 1600);
        }
      }

      // Play alert sound (if available via system)
      playAlert(request.requestType);
    }
  }

  /* ======================================================
     Alert sound (Web Audio API — no files needed)
  ====================================================== */
  function playAlert(requestType) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const freqs = {
        ASISTENCIA: [440, 550],
        EMERGENCIA: [880, 660, 880],
        URGENCIA:   [660, 550]
      };
      const seq = freqs[requestType] || [440];
      let t = ctx.currentTime;
      seq.forEach(freq => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.start(t);
        osc.stop(t + 0.25);
        t += 0.28;
      });
    } catch {}
  }

  /* ======================================================
     Filters
  ====================================================== */
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderList();
    });
  });

  /* ======================================================
     WebSocket
  ====================================================== */
  function wsConnect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'register', role: 'monitor' }));
      connIndicator.classList.add('connected');
      const connLabel = document.getElementById('conn-label');
      if (connLabel) connLabel.textContent = 'Conectado';
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'new_request') {
        addRequest(msg.request, true);
      } else if (msg.type === 'history') {
        msg.requests.forEach(r => addRequest(r, false));
      }
    };

    ws.onclose = () => {
      connIndicator.classList.remove('connected');
      const connLabel = document.getElementById('conn-label');
      if (connLabel) connLabel.textContent = 'Reconectando…';
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = setTimeout(wsConnect, 3000);
    };

    ws.onerror = () => { ws.close(); };
  }

  /* ======================================================
     Helpers
  ====================================================== */
  function formatTime(iso) {
    try {
      return new Date(iso).toLocaleTimeString('es-MX', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    } catch { return iso; }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ======================================================
     Init
  ====================================================== */
  startWatchingPosition();
  wsConnect();

  // Reset unread count when window gets focus
  window.addEventListener('focus', () => {
    unreadCount = 0;
    notifBadge.classList.remove('visible');
  });
})();
