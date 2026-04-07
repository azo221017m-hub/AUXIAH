/**
 * AUXIAH - Auxilio Humano con Inteligencia Artificial
 * WebSocket + HTTP server with MySQL persistence
 *
 * In production, serves the Vite-built React app from /dist.
 * In development, use `npm run dev` (Vite) + `npm run server` separately.
 *
 * Environment variables for DB connection:
 *   DB_HOST (default: localhost)
 *   DB_PORT (default: 3306)
 *   DB_USER
 *   DB_PASSWORD
 *   DB_NAME
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// ---- MySQL connection pool ----
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'auxiah',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
});

// Verify DB connection on startup
pool.getConnection()
  .then((conn) => {
    console.log('✅ MySQL connected to database:', process.env.DB_NAME || 'auxiah');
    conn.release();
  })
  .catch((err) => {
    console.error('❌ MySQL connection error:', err.message);
  });

// ---- Status mapping helpers ----
// DB enum: ABIERTO | ATENDIENDO | TERMINADO
const STATUS_TO_DB = { Abierto: 'ABIERTO', Asistiendo: 'ATENDIENDO', Terminado: 'TERMINADO' };
const STATUS_FROM_DB = { ABIERTO: 'ABIERTO', ATENDIENDO: 'ATENDIENDO', TERMINADO: 'TERMINADO' };

/** Convert a DB row to the API/WebSocket object format */
function rowToRequest(row) {
  return {
    id: row.idincidente,
    requestType: row.tipodeayuda,
    message: row.mensaje || '',
    country: row.paisincidente || '',
    location: (row.latitud != null && row.longitud != null)
      ? { lat: parseFloat(row.latitud), lng: parseFloat(row.longitud) }
      : null,
    timestamp: row.fechacreacion ? new Date(row.fechacreacion).toISOString() : '',
    estatus: row.estatusincidente || 'ABIERTO',
    aliasapoyo: row.aliasapoyo || '',
    contactoapoyo: row.contactoapoyo || '',
    infodeapoyo: row.infodeapoyo || '',
  };
}

// Serve the Vite build output
app.use(express.static(path.join(__dirname, 'dist')));
app.use(express.json());

// ---- REST API: Get all incidents (audit) ----
app.get('/api/solicitudes', async (req, res) => {
  try {
    let sql = 'SELECT * FROM auxiah_tblincidentes';
    const conditions = [];
    const params = [];

    if (req.query.country) {
      conditions.push('paisincidente LIKE ?');
      params.push(`%${req.query.country}%`);
    }
    if (req.query.requestType) {
      conditions.push('tipodeayuda = ?');
      params.push(req.query.requestType.toUpperCase());
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY fechacreacion DESC';

    const [rows] = await pool.query(sql, params);
    const solicitudes = rows.map(rowToRequest);
    res.json({ total: solicitudes.length, solicitudes });
  } catch (err) {
    console.error('Error fetching solicitudes:', err.message);
    res.status(500).json({ error: 'Error al consultar incidentes' });
  }
});

// ---- REST API: Create a new incident ----
app.post('/api/incidentes', async (req, res) => {
  try {
    const { requestType, message, country, location } = req.body;
    const lat = location?.lat ?? null;
    const lng = location?.lng ?? null;
    const now = new Date();

    const [result] = await pool.query(
      `INSERT INTO auxiah_tblincidentes
         (tipodeayuda, latitud, longitud, mensaje, estatusincidente, paisincidente, fechacreacion, fechaactualizacion)
       VALUES (?, ?, ?, ?, 'ABIERTO', ?, ?, ?)`,
      [requestType, lat, lng, message || '', country || '', now, now]
    );

    const newId = result.insertId;

    // Fetch the full row
    const [rows] = await pool.query(
      'SELECT * FROM auxiah_tblincidentes WHERE idincidente = ?',
      [newId]
    );
    const request = rowToRequest(rows[0]);

    // Broadcast to all connected monitors
    const payload = JSON.stringify({ type: 'new_request', request });
    for (const monitor of monitors) {
      if (monitor.readyState === WebSocket.OPEN) {
        monitor.send(payload);
      }
    }

    res.status(201).json({ id: newId, request });
  } catch (err) {
    console.error('Error creating incident:', err.message);
    res.status(500).json({ error: 'Error al crear incidente' });
  }
});

// ---- REST API: Update incident status ----
app.put('/api/incidentes/:id/estatus', async (req, res) => {
  try {
    const { id } = req.params;
    const { estatus } = req.body;
    const validStatuses = ['ABIERTO', 'ATENDIENDO', 'TERMINADO'];
    if (!validStatuses.includes(estatus)) {
      return res.status(400).json({ error: 'Estatus inválido' });
    }

    const now = new Date();
    await pool.query(
      'UPDATE auxiah_tblincidentes SET estatusincidente = ?, fechaactualizacion = ? WHERE idincidente = ?',
      [estatus, now, id]
    );

    // Broadcast status update to all monitors
    const statusPayload = JSON.stringify({
      type: 'status_updated',
      id: parseInt(id, 10),
      estatus,
    });
    for (const monitor of monitors) {
      if (monitor.readyState === WebSocket.OPEN) {
        monitor.send(statusPayload);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error updating status:', err.message);
    res.status(500).json({ error: 'Error al actualizar estatus' });
  }
});

// ---- REST API: Update support info (alias + contact) ----
app.put('/api/incidentes/:id/apoyo', async (req, res) => {
  try {
    const { id } = req.params;
    const { aliasapoyo, contactoapoyo } = req.body;
    const now = new Date();

    await pool.query(
      'UPDATE auxiah_tblincidentes SET aliasapoyo = ?, contactoapoyo = ?, fechaactualizacion = ? WHERE idincidente = ?',
      [aliasapoyo || '', contactoapoyo || '', now, id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Error updating support info:', err.message);
    res.status(500).json({ error: 'Error al actualizar info de apoyo' });
  }
});

// ---- REST API: Archive incident (set infodeapoyo + TERMINADO) ----
app.put('/api/incidentes/:id/archivar', async (req, res) => {
  try {
    const { id } = req.params;
    const { infodeapoyo } = req.body;
    const now = new Date();

    await pool.query(
      `UPDATE auxiah_tblincidentes
         SET infodeapoyo = ?, estatusincidente = 'TERMINADO', fechaactualizacion = ?
       WHERE idincidente = ?`,
      [infodeapoyo || '', now, id]
    );

    // Broadcast status update to monitors
    const statusPayload = JSON.stringify({
      type: 'status_updated',
      id: parseInt(id, 10),
      estatus: 'TERMINADO',
    });
    for (const monitor of monitors) {
      if (monitor.readyState === WebSocket.OPEN) {
        monitor.send(statusPayload);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error archiving incident:', err.message);
    res.status(500).json({ error: 'Error al archivar incidente' });
  }
});

// Track connected clients by role
const monitors = new Set();
const clients = new Set();

wss.on('connection', (ws) => {
  ws.role = null;

  ws.on('message', async (rawData) => {
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
          // Send active (non-TERMINADO) requests from DB to newly connected monitor
          try {
            const [rows] = await pool.query(
              "SELECT * FROM auxiah_tblincidentes WHERE estatusincidente != 'TERMINADO' ORDER BY fechacreacion DESC LIMIT 100"
            );
            const requests = rows.map(rowToRequest);
            ws.send(JSON.stringify({ type: 'history', requests }));
          } catch (err) {
            console.error('Error loading history:', err.message);
            ws.send(JSON.stringify({ type: 'history', requests: [] }));
          }
        } else {
          clients.add(ws);
        }
        break;

      // A client sends an emergency/assistance/urgency request
      case 'request': {
        try {
          const lat = msg.location?.lat ?? null;
          const lng = msg.location?.lng ?? null;
          const now = new Date();

          const [result] = await pool.query(
            `INSERT INTO auxiah_tblincidentes
               (tipodeayuda, latitud, longitud, mensaje, estatusincidente, paisincidente, fechacreacion, fechaactualizacion)
             VALUES (?, ?, ?, ?, 'ABIERTO', ?, ?, ?)`,
            [msg.requestType, lat, lng, msg.message || '', msg.country || '', now, now]
          );

          const newId = result.insertId;
          const [rows] = await pool.query(
            'SELECT * FROM auxiah_tblincidentes WHERE idincidente = ?',
            [newId]
          );
          const request = rowToRequest(rows[0]);

          // Broadcast to all connected monitors
          const payload = JSON.stringify({ type: 'new_request', request });
          for (const monitor of monitors) {
            if (monitor.readyState === WebSocket.OPEN) {
              monitor.send(payload);
            }
          }

          // Acknowledge to the client
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ack', id: newId }));
          }
        } catch (err) {
          console.error('Error inserting incident via WS:', err.message);
        }
        break;
      }

      // A monitor updates the status of a request
      case 'update_status': {
        const { id, estatus, aliasapoyo, contactoapoyo } = msg;
        const validStatuses = ['ABIERTO', 'ATENDIENDO', 'TERMINADO'];
        if (!id || !validStatuses.includes(estatus)) break;

        try {
          const now = new Date();
          // Update status and optionally the support info
          if (aliasapoyo || contactoapoyo) {
            await pool.query(
              'UPDATE auxiah_tblincidentes SET estatusincidente = ?, aliasapoyo = ?, contactoapoyo = ?, fechaactualizacion = ? WHERE idincidente = ?',
              [estatus, aliasapoyo || '', contactoapoyo || '', now, id]
            );
          } else {
            await pool.query(
              'UPDATE auxiah_tblincidentes SET estatusincidente = ?, fechaactualizacion = ? WHERE idincidente = ?',
              [estatus, now, id]
            );
          }

          // Broadcast status update to all monitors
          const statusPayload = JSON.stringify({ type: 'status_updated', id, estatus });
          for (const monitor of monitors) {
            if (monitor.readyState === WebSocket.OPEN) {
              monitor.send(statusPayload);
            }
          }
        } catch (err) {
          console.error('Error updating status via WS:', err.message);
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
