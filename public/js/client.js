/**
 * AUXIAH - Client Page JavaScript
 * Handles: alert type selection, geolocation, voice/text input, WebSocket
 */

(function () {
  'use strict';

  /* ---- State ---- */
  let selectedType = null;      // ASISTENCIA | EMERGENCIA | URGENCIA
  let currentLocation = null;   // { lat, lng, accuracy }
  let isRecording = false;
  let recognition = null;
  let countdownTimer = null;
  let ws = null;
  let wsReconnectTimer = null;

  /* ---- DOM refs ---- */
  const btnAsistencia  = document.getElementById('btn-asistencia');
  const btnEmergencia  = document.getElementById('btn-emergencia');
  const btnUrgencia    = document.getElementById('btn-urgencia');
  const btnLocation    = document.getElementById('btn-location');
  const locationDisplay = document.getElementById('location-display');
  const messageArea    = document.getElementById('message-area');
  const btnVoice       = document.getElementById('btn-voice');
  const btnSend        = document.getElementById('btn-send');
  const voiceCountdown = document.getElementById('voice-countdown');
  const statusBar      = document.getElementById('status-bar');
  const toast          = document.getElementById('toast');
  const connIndicator  = document.getElementById('conn-indicator');

  /* ======================================================
     WebSocket
  ====================================================== */
  function wsConnect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'register', role: 'client' }));
      connIndicator.classList.add('connected');
      setStatus('✅ Conectado al servidor AUXIAH');
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'ack') {
        showToast('✅ Solicitud enviada al monitor', 'success');
      }
    };

    ws.onclose = () => {
      connIndicator.classList.remove('connected');
      setStatus('⚠️ Sin conexión — reconectando…');
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = setTimeout(wsConnect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  function sendRequest(overrideType) {
    const type = overrideType || selectedType;
    if (!type) {
      showToast('⚠️ Selecciona un tipo: ASISTENCIA, EMERGENCIA o URGENCIA', 'error');
      return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      showToast('⚠️ Sin conexión al servidor. Reintentando…', 'error');
      return;
    }
    const msg = {
      type: 'request',
      requestType: type,
      message: messageArea.value.trim(),
      location: currentLocation
    };
    ws.send(JSON.stringify(msg));
    messageArea.value = '';
    setStatus(`📡 Solicitud de ${type} enviada`);
  }

  /* ======================================================
     Alert type buttons
  ====================================================== */
  function selectType(type) {
    selectedType = type;
    [btnAsistencia, btnEmergencia, btnUrgencia].forEach(b => b.classList.remove('selected'));
    const map = {
      ASISTENCIA: btnAsistencia,
      EMERGENCIA: btnEmergencia,
      URGENCIA:   btnUrgencia
    };
    if (map[type]) map[type].classList.add('selected');
    setStatus(`Tipo seleccionado: ${type}`);
  }

  btnAsistencia.addEventListener('click', () => selectType('ASISTENCIA'));
  btnEmergencia.addEventListener('click', () => selectType('EMERGENCIA'));
  btnUrgencia.addEventListener('click',   () => selectType('URGENCIA'));

  /* ======================================================
     Geolocation
  ====================================================== */
  btnLocation.addEventListener('click', () => {
    if (!navigator.geolocation) {
      showToast('Geolocalización no disponible en este navegador', 'error');
      return;
    }
    btnLocation.disabled = true;
    btnLocation.textContent = '📡 Obteniendo ubicación…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        currentLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };
        locationDisplay.innerHTML =
          `📍 <strong>Lat:</strong> ${currentLocation.lat.toFixed(6)}<br>` +
          `📍 <strong>Lng:</strong> ${currentLocation.lng.toFixed(6)}<br>` +
          `🎯 Precisión: ±${Math.round(currentLocation.accuracy)} m`;
        locationDisplay.classList.add('has-location');
        btnLocation.textContent = '🔄 Actualizar Ubicación';
        btnLocation.disabled = false;
        showToast('📍 Ubicación capturada', 'success');
      },
      (err) => {
        btnLocation.textContent = '📍 OBTENER UBICACIÓN ACTUAL';
        btnLocation.disabled = false;
        const messages = {
          1: 'Permiso de ubicación denegado.',
          2: 'Ubicación no disponible.',
          3: 'Tiempo de espera agotado.'
        };
        showToast(messages[err.code] || 'Error al obtener ubicación', 'error');
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  });

  /* ======================================================
     Voice recognition
  ====================================================== */
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    btnVoice.disabled = true;
    btnVoice.title = 'Reconocimiento de voz no disponible en este navegador';
  } else {
    recognition = new SpeechRecognition();
    recognition.lang = 'es-MX';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = true;

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      messageArea.value = transcript;
    };

    recognition.onerror = (event) => {
      stopVoice();
      if (event.error !== 'aborted') {
        showToast('Error de voz: ' + event.error, 'error');
      }
    };

    recognition.onend = () => {
      if (isRecording) stopVoice(true);
    };
  }

  function startVoice() {
    if (!recognition) return;
    isRecording = true;
    btnVoice.classList.add('recording');
    btnVoice.innerHTML = '⏹ DETENER';
    messageArea.value = '';

    recognition.start();

    let remaining = 10;
    voiceCountdown.classList.add('active');
    voiceCountdown.textContent = `🎙 Grabando… ${remaining}s`;

    countdownTimer = setInterval(() => {
      remaining--;
      voiceCountdown.textContent = `🎙 Grabando… ${remaining}s`;
      if (remaining <= 0) {
        stopVoice(true);
      }
    }, 1000);
  }

  function stopVoice(autoSend) {
    isRecording = false;
    clearInterval(countdownTimer);
    voiceCountdown.classList.remove('active');
    voiceCountdown.textContent = '';
    btnVoice.classList.remove('recording');
    btnVoice.innerHTML = '🎙 ESCUCHAR (10s)';

    try { recognition.stop(); } catch {}

    if (autoSend && messageArea.value.trim()) {
      // Auto-send after voice capture
      setTimeout(() => sendRequest(), 300);
    }
  }

  btnVoice.addEventListener('click', () => {
    if (isRecording) {
      stopVoice(false);
    } else {
      startVoice();
    }
  });

  /* ======================================================
     Send button
  ====================================================== */
  btnSend.addEventListener('click', () => sendRequest());

  /* ======================================================
     Helpers
  ====================================================== */
  function setStatus(text) {
    statusBar.textContent = text;
  }

  let toastTimer = null;
  function showToast(message, type) {
    toast.textContent = message;
    toast.className = 'show ' + (type || 'info');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 3500);
  }

  /* ======================================================
     Init
  ====================================================== */
  wsConnect();
})();
