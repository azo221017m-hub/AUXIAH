/**
 * AUXIAH - Auxilio Humano con Inteligencia Artificial
 * WebSocket + HTTP server
 *
 * In production, serves the Vite-built React app from /dist.
 * In development, use `npm run dev` (Vite) + `npm run server` separately.
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve the Vite build output
app.use(express.static(path.join(__dirname, 'dist')));

// Track connected clients by role
const monitors = new Set();
const clients = new Set();

// In-memory store of active requests (for new monitors connecting)
const activeRequests = [];

wss.on('connection', (ws) => {
  ws.role = null;

  ws.on('message', (rawData) => {
    let msg;
    try {
      msg = JSON.parse(rawData);
    } catch {
      return;
    }

    switch (msg.type) {
      // Client or monitor registers itself
      case 'register':
        ws.role = msg.role; // 'client' or 'monitor'
        if (msg.role === 'monitor') {
          monitors.add(ws);
          // Send all active requests to the newly connected monitor
          ws.send(JSON.stringify({ type: 'history', requests: activeRequests }));
        } else {
          clients.add(ws);
        }
        break;

      // A client sends an emergency/assistance/urgency request
      case 'request': {
        const request = {
          id: Date.now(),
          requestType: msg.requestType, // ASISTENCIA | EMERGENCIA | URGENCIA
          message: msg.message || '',
          location: msg.location || null,
          timestamp: new Date().toISOString()
        };
        activeRequests.push(request);
        // Keep only last 100 requests in memory
        if (activeRequests.length > 100) activeRequests.shift();

        // Broadcast to all connected monitors
        const payload = JSON.stringify({ type: 'new_request', request });
        for (const monitor of monitors) {
          if (monitor.readyState === WebSocket.OPEN) {
            monitor.send(payload);
          }
        }
        // Acknowledge to the client
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ack', id: request.id }));
        }
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    monitors.delete(ws);
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

// SPA fallback: serve index.html for any non-API routes (React Router)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  console.log(`AUXIAH server running at ${baseUrl}`);
  console.log(`  Client page : ${baseUrl}/`);
  console.log(`  Monitor page: ${baseUrl}/monitor`);
});
