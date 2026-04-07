import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, useMap } from 'react-leaflet';
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
  const { connected, lastMessage } = useWebSocket('monitor');
  const [requests, setRequests] = useState([]);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [unreadCount, setUnreadCount] = useState(0);
  const [monitorPos, setMonitorPos] = useState([19.4326, -99.1332]);
  const [flyTarget, setFlyTarget] = useState(null);
  const newIdsRef = useRef(new Set());

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
    }
  }, [lastMessage]);

  // Reset unread count on window focus
  useEffect(() => {
    const handleFocus = () => setUnreadCount(0);
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  const handleCardClick = useCallback((req) => {
    if (req.location) {
      setFlyTarget([req.location.lat, req.location.lng]);
    }
  }, []);

  const filteredRequests =
    activeFilter === 'ALL' ? requests : requests.filter((r) => r.requestType === activeFilter);

  const filters = [
    { key: 'ALL', label: 'Todas', cls: 'f-all' },
    { key: 'ASISTENCIA', label: '🆘 Asistencia', cls: 'f-asistencia' },
    { key: 'EMERGENCIA', label: '🚨 Emergencia', cls: 'f-emergencia' },
    { key: 'URGENCIA', label: '⚠️ Urgencia', cls: 'f-urgencia' },
  ];

  return (
    <div className="monitor-page">
      {/* Header */}
      <header>
        <div className="header-title">
          <img src={logoAuxiah} alt="AUXIAH Logo" className="header-logo" />
          <h1>
            <Link to="/" style={{ color: '#FFD700', textDecoration: 'none' }}>
              Monitor AUXIAH - Tlapalehuiliztli kal (casa de ayuda)
            </Link>
          </h1>
        </div>
        <div className="monitor-status">
          <span className={`conn-indicator ${connected ? 'connected' : ''}`} title="Estado de conexión" />
          <span>{connected ? 'Conectado' : 'Reconectando…'}</span>
          &nbsp;|&nbsp;
          <span className={`notif-badge ${unreadCount > 0 ? 'visible' : ''}`} aria-label="Solicitudes nuevas">
            {unreadCount}
          </span>
          solicitudes nuevas
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

            {/* Request markers */}
            {requests
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
              return (
                <div
                  key={r.id}
                  className={`req-card ${safeType} ${newIdsRef.current.has(r.id) ? 'new' : ''}`}
                  role="listitem"
                  onClick={() => handleCardClick(r)}
                >
                  <div className="req-card-type">
                    {cfg.emoji || ''} {r.requestType}
                  </div>
                  <div className="req-card-msg">{r.message || <em>Sin mensaje</em>}</div>
                  <div className="req-card-meta">
                    🕐 {formatTime(r.timestamp)}
                    {r.location
                      ? ` | 📍 ${r.location.lat.toFixed(5)}, ${r.location.lng.toFixed(5)}`
                      : ' | 📍 Sin ubicación'}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
