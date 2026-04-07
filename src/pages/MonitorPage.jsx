import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import useWebSocket from '../hooks/useWebSocket';
import 'leaflet/dist/leaflet.css';
import '../styles/monitor.css';

const logoAuxiah = '/logoauxiah.png';

const TYPE_CONFIG = {
  ASISTENCIA: { color: '#2196F3', emoji: '🆘', label: 'Asistencia' },
  EMERGENCIA: { color: '#F44336', emoji: '🚨', label: 'Emergencia' },
  URGENCIA: { color: '#FF9800', emoji: '⚠️', label: 'Urgencia' },
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Calculate distance in meters between two [lat, lng] points using Haversine formula */
function haversineDistance(pos1, pos2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(pos2[0] - pos1[0]);
  const dLng = toRad(pos2[1] - pos1[1]);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(pos1[0])) * Math.cos(toRad(pos2[0])) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Format distance for display */
function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function createIcon(requestType) {
  const cfg = TYPE_CONFIG[requestType] || { emoji: '📌' };
  return L.divIcon({
    className: '',
    html: `<div class="custom-marker" title="${escapeHtml(requestType)}">${cfg.emoji}</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20],
  });
}

function playAlert(requestType) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const freqs = {
      ASISTENCIA: [440, 550],
      EMERGENCIA: [880, 660, 880],
      URGENCIA: [660, 550],
    };
    const seq = freqs[requestType] || [440];
    let t = ctx.currentTime;
    seq.forEach((freq) => {
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
  } catch {
    // ignore audio errors
  }
}

/** Component to fly the map to a new position */
function FlyTo({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) {
      map.flyTo(position, 15, { duration: 1.5 });
    }
  }, [position, map]);
  return null;
}

export default function MonitorPage() {
  const { connected, lastMessage, send } = useWebSocket('monitor');
  const [requests, setRequests] = useState([]);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [unreadCount, setUnreadCount] = useState(0);
  const [monitorPos, setMonitorPos] = useState([19.4326, -99.1332]);
  const [flyTarget, setFlyTarget] = useState(null);
  const newIdsRef = useRef(new Set());

  // Route state for displaying path from monitor to incident
  const [routeCoords, setRouteCoords] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);

  // Context menu state
  const [contextMenu, setContextMenu] = useState(null);

  // Helper identification modal state (shown on page load)
  const [helperModalOpen, setHelperModalOpen] = useState(true);
  const [helperAlias, setHelperAlias] = useState('');
  const [helperPhone, setHelperPhone] = useState('');
  const [helperReady, setHelperReady] = useState(false);

  // Terminado (archive) modal state
  const [archiveModal, setArchiveModal] = useState(null); // { id, requestType }
  const [archiveInfo, setArchiveInfo] = useState('');

  // Environment-based admin credentials for audit access
  const envAlias = import.meta.env.HELPER_ALIAS || '';
  const envPhone = import.meta.env.HELPER_TELEFONO || '';

  // Audit panel state
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditData, setAuditData] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditFilterCountry, setAuditFilterCountry] = useState('');
  const [auditFilterType, setAuditFilterType] = useState('');

  // Watch monitor's own geolocation
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setMonitorPos([pos.coords.latitude, pos.coords.longitude]),
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Handle incoming WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'new_request') {
      const req = lastMessage.request;
      setRequests((prev) => [...prev, req]);
      setUnreadCount((prev) => prev + 1);
      newIdsRef.current.add(req.id);
      setTimeout(() => newIdsRef.current.delete(req.id), 4000);
      playAlert(req.requestType);
      if (req.location) {
        setFlyTarget([req.location.lat, req.location.lng]);
      }
    } else if (lastMessage.type === 'history') {
      setRequests((prev) => [...prev, ...lastMessage.requests]);
    } else if (lastMessage.type === 'status_updated') {
      const { id, estatus } = lastMessage;
      setRequests((prev) =>
        prev.map((r) => (r.id === id ? { ...r, estatus } : r))
      );
    }
  }, [lastMessage]);

  // Reset unread count on window focus
  useEffect(() => {
    const handleFocus = () => setUnreadCount(0);
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  // Handle helper modal submit
  const handleHelperSubmit = useCallback(() => {
    if (!helperAlias.trim() || !helperPhone.trim()) return;
    setHelperReady(true);
    setHelperModalOpen(false);
  }, [helperAlias, helperPhone]);

  // Fetch audit data from REST API
  const fetchAuditData = useCallback(async (country = '', requestType = '') => {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams();
      if (country) params.set('country', country);
      if (requestType) params.set('requestType', requestType);
      const url = `/api/solicitudes${params.toString() ? '?' + params.toString() : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      setAuditData(data.solicitudes || []);
    } catch (err) {
      console.error('Error fetching audit data:', err);
      setAuditData([]);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const handleOpenAudit = useCallback(() => {
    setAuditOpen(true);
    setAuditFilterCountry('');
    setAuditFilterType('');
    fetchAuditData();
  }, [fetchAuditData]);

  const handleAuditFilter = useCallback(() => {
    fetchAuditData(auditFilterCountry, auditFilterType);
  }, [fetchAuditData, auditFilterCountry, auditFilterType]);

  const handleCardClick = useCallback(async (req) => {
    if (req.location) {
      setFlyTarget([req.location.lat, req.location.lng]);

      // Fetch route from OSRM
      setRouteLoading(true);
      setRouteCoords(null);
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${monitorPos[1]},${monitorPos[0]};${req.location.lng},${req.location.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.routes && data.routes.length > 0) {
          // GeoJSON coordinates are [lng, lat], convert to [lat, lng] for Leaflet
          const coords = data.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]);
          setRouteCoords(coords);
        }
      } catch (err) {
        console.error('Error fetching route:', err);
        // Fallback: draw a straight line
        setRouteCoords([monitorPos, [req.location.lat, req.location.lng]]);
      } finally {
        setRouteLoading(false);
      }
    }
  }, [monitorPos]);

  // Context menu: right-click on a card
  const handleCardContextMenu = useCallback((e, req) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, request: req });
  }, []);

  const handleStatusChange = useCallback(async (id, estatus) => {
    // When changing to TERMINADO, show the archive modal instead
    if (estatus === 'TERMINADO') {
      const req = requests.find((r) => r.id === id);
      setArchiveModal({ id, requestType: req?.requestType || '' });
      setArchiveInfo('');
      setContextMenu(null);
      return;
    }

    // For ATENDIENDO: update via REST API + save helper info
    try {
      await fetch(`/api/incidentes/${id}/estatus`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estatus }),
      });
      // Also save helper alias/phone if available
      if (helperReady && helperAlias.trim()) {
        await fetch(`/api/incidentes/${id}/apoyo`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aliasapoyo: helperAlias.trim(),
            contactoapoyo: helperPhone.trim(),
          }),
        });
      }
    } catch (err) {
      console.error('Error updating status:', err);
    }

    // Optimistic update
    setRequests((prev) =>
      prev.map((r) => (r.id === id ? { ...r, estatus } : r))
    );
    setContextMenu(null);
  }, [helperReady, helperAlias, helperPhone, requests]);

  // Handle archive (Terminado) modal submit
  const handleArchiveSubmit = useCallback(async () => {
    if (!archiveModal) return;
    const { id } = archiveModal;

    try {
      await fetch(`/api/incidentes/${id}/archivar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ infodeapoyo: archiveInfo.trim() }),
      });
      // Also save helper info if available
      if (helperReady && helperAlias.trim()) {
        await fetch(`/api/incidentes/${id}/apoyo`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aliasapoyo: helperAlias.trim(),
            contactoapoyo: helperPhone.trim(),
          }),
        });
      }
    } catch (err) {
      console.error('Error archiving incident:', err);
    }

    // Optimistic update
    setRequests((prev) =>
      prev.map((r) => (r.id === id ? { ...r, estatus: 'TERMINADO' } : r))
    );
    setArchiveModal(null);
    setArchiveInfo('');
  }, [archiveModal, archiveInfo, helperReady, helperAlias, helperPhone]);

  // Close context menu on click anywhere
  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  // Filter out "TERMINADO" requests, then apply type filter
  const visibleRequests = requests.filter((r) => r.estatus !== 'TERMINADO');
  const filteredRequests =
    activeFilter === 'ALL' ? visibleRequests : visibleRequests.filter((r) => r.requestType === activeFilter);

  const filters = [
    { key: 'ALL', label: 'Todas', cls: 'f-all' },
    { key: 'ASISTENCIA', label: '🆘 Asistencia', cls: 'f-asistencia' },
    { key: 'EMERGENCIA', label: '🚨 Emergencia', cls: 'f-emergencia' },
    { key: 'URGENCIA', label: '⚠️ Urgencia', cls: 'f-urgencia' },
  ];

  return (
    <div className="monitor-page">
      {/* Helper Identification Modal */}
      {helperModalOpen && (
        <div className="helper-overlay">
          <div className="helper-modal">
            <div className="helper-modal-header">
              <img src={logoAuxiah} alt="AUXIAH" className="helper-modal-logo" />
              <h2>Identificación de Apoyo</h2>
              <p>Ingresa tus datos para poder ayudar a las personas que lo necesitan</p>
            </div>
            <div className="helper-modal-body">
              <div className="helper-field">
                <label htmlFor="helper-alias">👤 Alias</label>
                <input
                  id="helper-alias"
                  type="text"
                  placeholder="Tu nombre o alias…"
                  value={helperAlias}
                  onChange={(e) => setHelperAlias(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="helper-field">
                <label htmlFor="helper-phone">📞 Teléfono</label>
                <input
                  id="helper-phone"
                  type="tel"
                  placeholder="Tu número de contacto…"
                  value={helperPhone}
                  onChange={(e) => setHelperPhone(e.target.value)}
                />
              </div>
            </div>
            <button
              className="helper-modal-btn"
              disabled={!helperAlias.trim() || !helperPhone.trim()}
              onClick={handleHelperSubmit}
            >
              🤝 COMENZAR a AYUDAR
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header>
        <div className="header-title">
          <img src={logoAuxiah} alt="AUXIAH Logo" className="header-logo" />
          <h1>
            <Link to="/" style={{ color: '#FFD700', textDecoration: 'none' }}>
              Monitor AUXIAH *  Yancuic Tlachialoyan (Observatorio Moderno)
            </Link>
          </h1>
        </div>
        <div className="monitor-status">
          {envAlias && envPhone && helperAlias === envAlias && helperPhone === envPhone && (
            <button className="btn-audit" onClick={handleOpenAudit} title="Ver auditoría de solicitudes">
              📋 Auditoría
            </button>
          )}
          <span className={`conn-indicator ${connected ? 'connected' : ''}`} title="Estado de conexión" />
          <span>{connected ? 'Conectado' : 'Reconectando…'}</span>
          &nbsp;|&nbsp;
          <span className={`notif-badge ${unreadCount > 0 ? 'visible' : ''}`} aria-label="Solicitudes nuevas">
            {unreadCount}
          </span>
          solicitudes nuevas
          {helperReady && (
            <span className="helper-info-badge" title={`Apoyo: ${helperAlias} | ${helperPhone}`}>
              👤 {helperAlias}
            </span>
          )}
        </div>
      </header>

      {/* App layout: Map + Sidebar */}
      <div className="app-layout">
        {/* Map */}
        <div className="map-container">
          <MapContainer center={monitorPos} zoom={14} style={{ width: '100%', height: '100%' }} zoomControl>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              subdomains="abcd"
              maxZoom={19}
            />

            {/* Monitor location marker */}
            <CircleMarker
              center={monitorPos}
              radius={12}
              pathOptions={{ fillColor: '#FFD700', color: '#fff', weight: 3, fillOpacity: 0.95 }}
            >
              <Popup>
                <strong>📍 Monitor AUXIAH</strong>
                <br />
                Tu ubicación actual
              </Popup>
            </CircleMarker>

            {/* Request markers from DB lat/lng */}
            {visibleRequests
              .filter((r) => r.location)
              .map((r) => {
                const cfg = TYPE_CONFIG[r.requestType] || {};
                return (
                  <Marker key={r.id} position={[r.location.lat, r.location.lng]} icon={createIcon(r.requestType)}>
                    <Popup>
                      <div style={{ minWidth: 180 }}>
                        <strong style={{ color: cfg.color || '#fff' }}>
                          {cfg.emoji} {r.requestType}
                        </strong>
                        <br />
                        <em style={{ color: '#aaa', fontSize: '0.8em' }}>{formatTime(r.timestamp)}</em>
                        <br />
                        <br />
                        {r.message ? <span>{r.message}</span> : <span style={{ color: '#666' }}>Sin mensaje</span>}
                      </div>
                    </Popup>
                  </Marker>
                );
              })}

            {/* Route polyline from monitor to selected incident */}
            {routeCoords && (
              <Polyline
                positions={routeCoords}
                pathOptions={{ color: '#FFD700', weight: 4, opacity: 0.85, dashArray: '10, 8' }}
              />
            )}

            <FlyTo position={flyTarget} />
          </MapContainer>
        </div>

        {/* Sidebar */}
        <aside className="sidebar" aria-label="Lista de solicitudes">
          <div className="sidebar-header">
            <h2>Solicitudes</h2>
          </div>

          {/* Filter buttons */}
          <div className="filter-bar" role="group" aria-label="Filtrar por tipo">
            {filters.map((f) => (
              <button
                key={f.key}
                className={`filter-btn ${f.cls} ${activeFilter === f.key ? 'active' : ''}`}
                aria-pressed={activeFilter === f.key}
                onClick={() => setActiveFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Request list */}
          <div className="request-list" role="list" aria-live="polite" aria-label="Solicitudes activas">
            {filteredRequests.length === 0 && (
              <div className="empty-list">Sin solicitudes activas</div>
            )}
            {[...filteredRequests].reverse().map((r) => {
              const cfg = TYPE_CONFIG[r.requestType] || {};
              const safeType = TYPE_CONFIG[r.requestType] ? r.requestType : 'UNKNOWN';
              const estatus = r.estatus || 'ABIERTO';
              const distance = r.location
                ? haversineDistance(monitorPos, [r.location.lat, r.location.lng])
                : null;
              return (
                <div
                  key={r.id}
                  className={`req-card ${safeType} ${newIdsRef.current.has(r.id) ? 'new' : ''}`}
                  role="listitem"
                  onClick={() => handleCardClick(r)}
                  onContextMenu={(e) => handleCardContextMenu(e, r)}
                >
                  <div className="req-card-type">
                    {cfg.emoji || ''} {r.requestType}
                    <span className={`estatus-badge estatus-${estatus.toLowerCase()}`}>
                      {estatus}
                    </span>
                  </div>
                  <div className="req-card-msg">{r.message || <em>Sin mensaje</em>}</div>
                  <div className="req-card-meta">
                    🕐 {formatTime(r.timestamp)}
                    {r.location
                      ? ` | 📍 ${r.location.lat.toFixed(5)}, ${r.location.lng.toFixed(5)}`
                      : ' | 📍 Sin ubicación'}
                    {distance !== null && (
                      <span className="req-card-distance"> | 📏 {formatDistance(distance)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>

      {/* Audit Modal */}
      {auditOpen && (
        <div className="audit-overlay" onClick={() => setAuditOpen(false)}>
          <div className="audit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="audit-header">
              <h2>📋 Auditoría de Solicitudes</h2>
              <button className="audit-close" onClick={() => setAuditOpen(false)} aria-label="Cerrar auditoría">✕</button>
            </div>

            <div className="audit-filters">
              <div className="audit-filter-group">
                <label htmlFor="audit-country">🌎 País:</label>
                <input
                  id="audit-country"
                  type="text"
                  placeholder="Filtrar por país…"
                  value={auditFilterCountry}
                  onChange={(e) => setAuditFilterCountry(e.target.value)}
                />
              </div>
              <div className="audit-filter-group">
                <label htmlFor="audit-type">🏷️ Tipo de Ayuda:</label>
                <select
                  id="audit-type"
                  value={auditFilterType}
                  onChange={(e) => setAuditFilterType(e.target.value)}
                >
                  <option value="">Todos</option>
                  <option value="ASISTENCIA">🆘 Asistencia</option>
                  <option value="EMERGENCIA">🚨 Emergencia</option>
                  <option value="URGENCIA">⚠️ Urgencia</option>
                </select>
              </div>
              <button className="audit-apply-btn" onClick={handleAuditFilter}>🔍 Filtrar</button>
            </div>

            <div className="audit-count">
              {auditLoading ? 'Cargando…' : `${auditData.length} registro(s) encontrado(s)`}
            </div>

            <div className="audit-table-wrap">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Fecha / Hora</th>
                    <th>Tipo</th>
                    <th>Estatus</th>
                    <th>País</th>
                    <th>Mensaje</th>
                    <th>Ubicación</th>
                    <th>Apoyo</th>
                    <th>Info de Apoyo</th>
                  </tr>
                </thead>
                <tbody>
                  {auditData.length === 0 && !auditLoading && (
                    <tr>
                      <td colSpan="9" className="audit-empty">Sin registros</td>
                    </tr>
                  )}
                  {auditData.map((r) => {
                    const cfg = TYPE_CONFIG[r.requestType] || {};
                    return (
                      <tr key={r.id}>
                        <td className="audit-id">{r.id}</td>
                        <td>{r.timestamp ? new Date(r.timestamp).toLocaleString('es-MX') : '—'}</td>
                        <td style={{ color: cfg.color || '#fff' }}>
                          {cfg.emoji || ''} {r.requestType}
                        </td>
                        <td>
                          <span className={`estatus-badge estatus-${(r.estatus || 'abierto').toLowerCase()}`}>
                            {r.estatus || 'ABIERTO'}
                          </span>
                        </td>
                        <td>{r.country || '—'}</td>
                        <td className="audit-msg">{r.message || <em>Sin mensaje</em>}</td>
                        <td>
                          {r.location
                            ? `${r.location.lat.toFixed(5)}, ${r.location.lng.toFixed(5)}`
                            : '—'}
                        </td>
                        <td>{r.aliasapoyo ? `${r.aliasapoyo} | ${r.contactoapoyo}` : '—'}</td>
                        <td className="audit-msg">{r.infodeapoyo || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Archive (Terminado) Modal */}
      {archiveModal && (
        <div className="archive-overlay" onClick={() => setArchiveModal(null)}>
          <div className="archive-modal" onClick={(e) => e.stopPropagation()}>
            <div className="archive-modal-header">
              <h2>📝 Archivar Incidente</h2>
              <button className="audit-close" onClick={() => setArchiveModal(null)} aria-label="Cerrar">✕</button>
            </div>
            <div className="archive-modal-body">
              <label htmlFor="archive-info">¿Cómo se ayudó?</label>
              <textarea
                id="archive-info"
                placeholder="Describe cómo se brindó la ayuda…"
                rows={4}
                value={archiveInfo}
                onChange={(e) => setArchiveInfo(e.target.value)}
                autoFocus
              />
            </div>
            <button
              className="archive-modal-btn"
              onClick={handleArchiveSubmit}
            >
              📦 Archivar Incidente
            </button>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-btn ctx-asistiendo"
            onClick={() => handleStatusChange(contextMenu.request.id, 'ATENDIENDO')}
          >
            🟡 Atendiendo
          </button>
          <button
            className="context-menu-btn ctx-terminado"
            onClick={() => handleStatusChange(contextMenu.request.id, 'TERMINADO')}
          >
            ✅ Terminado
          </button>
        </div>
      )}
    </div>
  );
}
