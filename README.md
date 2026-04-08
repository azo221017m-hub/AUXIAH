# AUXIAH
**Auxilio Humano con Inteligencia Artificial**

Sistema web de ayuda por geolocalización en tiempo real, construido con **Vite + React**.

---

## Páginas

### 🆘 Página del Cliente Especial (`/`)
Diseñada para usuarios con capacidades diferentes. Interfaz accesible con botones grandes y alto contraste.

- **Sección 1 – Tipo de Ayuda:** Tres botones grandes: `ASISTENCIA` | `EMERGENCIA` | `URGENCIA`
- **Sección 2 – Ubicación:** Captura la ubicación GPS actual del usuario
- **Sección 3 – Mensaje:** Campo de texto + grabación de voz de 10 segundos con envío automático al Monitor

### 🖥 Página del Monitor AUXIAH (`/monitor`)
Panel de monitoreo en tiempo real para el equipo de respuesta.

- Mapa interactivo (React Leaflet) centrado en la ubicación del monitorista
- Íconos en el mapa para cada solicitud de `ASISTENCIA` | `EMERGENCIA` | `URGENCIA`
- Lista filtrable de solicitudes en tiempo real
- Actualización automática vía **WebSocket**

---

## Tecnologías

| Capa | Tecnología |
|------|-----------|
| Frontend | React 19 + Vite |
| Routing | React Router |
| Backend | Node.js + Express |
| Tiempo real | WebSocket (`ws`) |
| Mapas | React Leaflet |
| Voz | Web Speech API (nativa del navegador) |
| Geolocalización | Geolocation API (nativa del navegador) |

---

## Instalación y Ejecución

### Desarrollo

```bash
# Instalar dependencias
npm install

# Iniciar Vite dev server (frontend)
npm run dev

# En otra terminal, iniciar el backend WebSocket
npm run server
```

- Frontend (Vite): `http://localhost:5173`
- Backend (WebSocket): `http://localhost:3000`

### Producción

```bash
# Instalar dependencias y compilar
npm install
npm run build

# Iniciar el servidor de producción
npm start
```

El servidor quedará disponible en `http://localhost:3000`.

- Cliente: `http://localhost:3000/`
- Monitor: `http://localhost:3000/monitor`

---

## Despliegue

### Render
El archivo `render.yaml` está configurado para desplegar automáticamente:
- Build: `npm install && npm run build`
- Start: `npm start`

### Vercel
El archivo `vercel.json` está configurado para desplegar como sitio estático con Vite:
- Build: `npm install && npm run build`
- Output: `dist/`

> **Nota:** Vercel despliega solo el frontend estático. Para WebSocket en tiempo real, despliega el backend en Render u otro servicio con soporte WebSocket.

---

## Base de Datos

### Migración: agregar campo teléfono de persona incidente

Ejecutar el siguiente SQL en la base de datos para agregar el campo opcional de teléfono:

```sql
ALTER TABLE auxiah_tblincidentes
  ADD COLUMN telefonopersonaincidente VARCHAR(45) DEFAULT NULL
  AFTER paisincidente;
```

---

## Screenshots

### Cliente Especial
![Cliente AUXIAH](https://github.com/user-attachments/assets/898240a1-04a6-4b2e-b623-08493639224f)

### Monitor AUXIAH (con solicitud de Emergencia en tiempo real)
![Monitor AUXIAH](https://github.com/user-attachments/assets/a84255b5-811b-4356-9b10-d9e601c42d0c)
