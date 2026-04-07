# AUXIAH
**Auxilio Humano con Inteligencia Artificial**

Sistema web de ayuda por geolocalización en tiempo real.

---

## Páginas

### 🆘 Página del Cliente Especial (`/`)
Diseñada para usuarios con capacidades diferentes. Interfaz accesible con botones grandes y alto contraste.

- **Sección 1 – Tipo de Ayuda:** Tres botones grandes: `ASISTENCIA` | `EMERGENCIA` | `URGENCIA`
- **Sección 2 – Ubicación:** Captura la ubicación GPS actual del usuario
- **Sección 3 – Mensaje:** Campo de texto + grabación de voz de 10 segundos con envío automático al Monitor

### 🖥 Página del Monitor AUXIAH (`/monitor.html`)
Panel de monitoreo en tiempo real para el equipo de respuesta.

- Mapa interactivo (Leaflet.js) centrado en la ubicación del monitorista
- Íconos en el mapa para cada solicitud de `ASISTENCIA` | `EMERGENCIA` | `URGENCIA`
- Lista filtrable de solicitudes en tiempo real
- Actualización automática vía **WebSocket**

---

## Tecnologías

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + Express |
| Tiempo real | WebSocket (`ws`) |
| Mapas | Leaflet.js (local) |
| Voz | Web Speech API (nativa del navegador) |
| Geolocalización | Geolocation API (nativa del navegador) |

---

## Instalación y Ejecución

```bash
# Instalar dependencias
npm install

# Iniciar el servidor
npm start
```

El servidor quedará disponible en `http://localhost:3000`.

- Cliente: `http://localhost:3000/`
- Monitor: `http://localhost:3000/monitor.html`

---

## Screenshots

### Cliente Especial
![Cliente AUXIAH](https://github.com/user-attachments/assets/898240a1-04a6-4b2e-b623-08493639224f)

### Monitor AUXIAH (con solicitud de Emergencia en tiempo real)
![Monitor AUXIAH](https://github.com/user-attachments/assets/a84255b5-811b-4356-9b10-d9e601c42d0c)
