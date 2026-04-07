import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import useWebSocket from '../hooks/useWebSocket';
import useVoiceRecognition from '../hooks/useVoiceRecognition';
import Toast from '../components/Toast';
import '../styles/client.css';

const logoAuxiah = '/logoauxiah.png';

const TYPES = [
  { key: 'ASISTENCIA', icon: '🆘', label: 'ASISTENCIA' },
  { key: 'EMERGENCIA', icon: '⚠️', label: 'EMERGENCIA' },
  { key: 'URGENCIA', icon: '🚨', label: 'URGENCIA' },
];

export default function ClientPage() {
  const { connected, lastMessage, send } = useWebSocket('client');
  const { isRecording, countdown, isSupported, start, stop } = useVoiceRecognition();

  const [selectedType, setSelectedType] = useState(null);
  const [location, setLocation] = useState(null);
  const [message, setMessage] = useState('');
  const [locationStatus, setLocationStatus] = useState('📍 Ubicación no capturada');
  const [hasLocation, setHasLocation] = useState(false);
  const [toast, setToast] = useState(null);
  const [status, setStatus] = useState('Conectando…');
  const [locationLoading, setLocationLoading] = useState(false);

  useEffect(() => {
    setStatus(connected ? '✅ Conectado al servidor AUXIAH' : '⚠️ Sin conexión — reconectando…');
  }, [connected]);

  useEffect(() => {
    if (lastMessage?.type === 'ack') {
      showToast('✅ Solicitud enviada al monitor', 'success');
    }
  }, [lastMessage]);

  const showToast = useCallback((msg, type) => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const handleSend = useCallback(() => {
    if (!selectedType) {
      showToast('⚠️ Selecciona un tipo: ASISTENCIA, EMERGENCIA o URGENCIA', 'error');
      return;
    }
    if (!connected) {
      showToast('⚠️ Sin conexión al servidor. Reintentando…', 'error');
      return;
    }
    send({
      type: 'request',
      requestType: selectedType,
      message: message.trim(),
      location,
    });
    setMessage('');
    setStatus(`📡 Solicitud de ${selectedType} enviada`);
  }, [selectedType, message, location, connected, send, showToast]);

  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      showToast('Geolocalización no disponible en este navegador', 'error');
      return;
    }
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        setLocation(loc);
        setHasLocation(true);
        setLocationStatus(
          `📍 Lat: ${loc.lat.toFixed(6)} | Lng: ${loc.lng.toFixed(6)} | 🎯 ±${Math.round(loc.accuracy)} m`
        );
        setLocationLoading(false);
        showToast('📍 Ubicación capturada', 'success');
      },
      (err) => {
        setLocationLoading(false);
        const messages = {
          1: 'Permiso de ubicación denegado.',
          2: 'Ubicación no disponible.',
          3: 'Tiempo de espera agotado.',
        };
        showToast(messages[err.code] || 'Error al obtener ubicación', 'error');
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  const handleVoice = () => {
    if (isRecording) {
      stop();
    } else {
      setMessage('');
      start(
        (transcript) => setMessage(transcript),
        () => {
          // Auto-send after voice capture
          setTimeout(() => {
            if (selectedType) handleSend();
          }, 300);
        }
      );
    }
  };

  return (
    <div className="client-page">
      {/* Header */}
      <header>
        <img src={logoAuxiah} alt="AUXIAH Logo" className="header-logo" />
        <h1>AUXIAH</h1>
        <p>Auxilio Humano con Inteligencia Artificial</p>
        <p> Tlapalehuiliztli kal (casa de ayuda) </p>
      </header>

      {/* Status bar */}
      <div className="status-bar" role="status" aria-live="polite">
        <span className={`conn-indicator ${connected ? 'connected' : ''}`} aria-hidden="true" />
        {status}
      </div>

      {/* Main 3-column grid */}
      <main className="main-grid" role="main">
        {/* Section 1: Alert type */}
        <section className="section-card" aria-labelledby="sec1-title">
          <h2 className="section-title" id="sec1-title">1 · Tipo de Ayuda</h2>
          {TYPES.map((t) => (
            <button
              key={t.key}
              className={`btn-alert btn-${t.key.toLowerCase()} ${selectedType === t.key ? 'selected' : ''}`}
              aria-label={`Solicitar ${t.label}`}
              aria-pressed={selectedType === t.key}
              onClick={() => {
                setSelectedType(t.key);
                setStatus(`Tipo seleccionado: ${t.key}`);
              }}
            >
              <span className="btn-icon" aria-hidden="true">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </section>

        {/* Section 2: Geolocation */}
        <section className="section-card" aria-labelledby="sec2-title">
          <h2 className="section-title" id="sec2-title">2 · Mi Ubicación</h2>
          <button
            className="btn-location"
            aria-label="Obtener ubicación actual"
            disabled={locationLoading}
            onClick={handleGetLocation}
          >
            <span aria-hidden="true">📍</span>
            {locationLoading
              ? '📡 Obteniendo ubicación…'
              : hasLocation
              ? '🔄 Actualizar Ubicación'
              : 'CLICK PARA OBTENER UBICACIÓN ACTUAL'}
          </button>
          <div className={`location-display ${hasLocation ? 'has-location' : ''}`} aria-live="polite" role="status">
            {locationStatus}
          </div>
        </section>

        {/* Section 3: Message / Voice */}
        <section className="section-card" aria-labelledby="sec3-title">
          <h2 className="section-title" id="sec3-title">3 · Mensaje</h2>
          <textarea
            className="message-area"
            placeholder="Escribe aquí tu mensaje…"
            aria-label="Escribe tu mensaje de ayuda"
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="voice-row">
            <button
              className={`btn-voice ${isRecording ? 'recording' : ''}`}
              aria-label="Iniciar grabación de voz por 10 segundos"
              disabled={!isSupported}
              title={!isSupported ? 'Reconocimiento de voz no disponible' : ''}
              onClick={handleVoice}
            >
              {isRecording ? '⏹ DETENER' : '🎙 ESCUCHAR (10s)'}
            </button>
            <button className="btn-send" aria-label="Enviar solicitud al monitor" onClick={handleSend}>
              📤 ENVIAR
            </button>
          </div>
          {isRecording && countdown > 0 && (
            <div className="voice-countdown active" aria-live="assertive" role="status">
              🎙 Grabando… {countdown}s
            </div>
          )}
        </section>
      </main>

      {/* Toast */}
      <Toast toast={toast} />

      {/* Footer */}
      <footer>
        <Link to="/monitor" style={{ color: '#555', textDecoration: 'none' }}>
          🖥 Monitor AUXIAH
        </Link>
        &nbsp;|&nbsp; AUXIAH © 2026 — Auxilio Humano con Inteligencia Artificial
      </footer>
    </div>
  );
}
