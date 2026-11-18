const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// Mappa stanze: nomeCanale -> Set di WebSocket client
const rooms = new Map();
let nextSid = 1;

// 1. Server HTTP (mostra stato nel browser e serve per 'svegliare' il server)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  const roomCount = rooms.size;
  let clientCount = 0;
  for (const set of rooms.values()) clientCount += set.size;

  res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Mörk Borg Relay</title>
  <style>
    body { background: #0a0a0c; color: #ffe600; font-family: monospace; padding: 2rem; max-width: 600px; margin: auto; }
    h1 { color: #fe2857; margin-bottom: 0.5rem; }
    .card { border: 2px solid #ffe600; padding: 1.5rem; background: #141418; border-radius: 4px; box-shadow: 0 4px 20px rgba(0,0,0,0.6); }
    .badge { background: #22c55e; color: black; font-weight: bold; padding: 2px 8px; border-radius: 3px; }
    code { background: #222; padding: 3px 6px; color: #fe2857; }
  </style>
</head>
<body>
  <div class="card">
    <h1>💀 MÖRK BORG RELAY</h1>
    <p>Stato: <span class="badge">ONLINE</span></p>
    <p>Stanze attive: <strong>${roomCount}</strong></p>
    <p>Giocatori collegati: <strong>${clientCount}</strong></p>
    <hr style="border-color:#333;margin:1.5rem 0;">
    <p style="color:#bbb;font-size:0.9rem;">
      Per usare questo relay nel gioco:<br>
      Incolla l'indirizzo con prefisso <code>wss://</code> nel campo <strong>Relay personalizzato</strong> del menu Rete.
    </p>
  </div>
</body>
</html>`);
});

// 2. Server WebSocket (compatibile con il protocollo Achex del gioco)
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const sid = 's_' + (nextSid++) + '_' + Math.random().toString(36).slice(2, 6);
  ws.sid = sid;
  ws.currentChannel = null;
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return;
    }

    // A) Registrazione / Cambio Stanza: { setID: 'morkABCD', passwd: '...' }
    if (data.setID) {
      const channel = String(data.setID).trim();
      if (ws.currentChannel && rooms.has(ws.currentChannel)) {
        rooms.get(ws.currentChannel).delete(ws);
      }
      ws.currentChannel = channel;
      if (!rooms.has(channel)) {
        rooms.set(channel, new Set());
      }
      rooms.get(channel).add(ws);

      // Risposta auth compatibile con il gioco
      ws.send(JSON.stringify({
        auth: 'ok',
        SID: sid,
        channel: channel
      }));
      return;
    }

    // B) Broadcast alla stanza: { to: 'morkABCD', mb: '...' }
    if (data.to && data.mb) {
      const channel = String(data.to).trim();
      const targetRoom = rooms.get(channel);
      if (targetRoom) {
        const envelope = JSON.stringify({
          FROM: sid,
          to: channel,
          mb: data.mb
        });
        for (const client of targetRoom) {
          if (client !== ws && client.readyState === 1) { // 1 = OPEN
            client.send(envelope);
          }
        }
      }
    }
  });

  ws.on('close', () => {
    if (ws.currentChannel && rooms.has(ws.currentChannel)) {
      const set = rooms.get(ws.currentChannel);
      set.delete(ws);
      if (set.size === 0) rooms.delete(ws.currentChannel);
    }
  });

  ws.on('error', () => {});
});

// Keepalive interno ogni 25 secondi contro disconnessioni silenziose
const interval = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000);

wss.on('close', () => clearInterval(interval));

server.listen(PORT, () => {
  console.log(`Relay attivo sulla porta ${PORT}`);
});
