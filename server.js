'use strict';

const express = require('express');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

function createGameServer(options = {}) {
  const app = express();
  const server = http.createServer(app);

  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    next();
  });
  app.get('/health', (_request, response) => response.json({ ok: true }));
  app.use(express.static(path.join(__dirname, 'public'), { maxAge: options.isTest ? 0 : '1h' }));

  return { app, server };
}

if (require.main === module) {
  const { server } = createGameServer();
  server.listen(PORT, HOST, () => console.log(`Factory è attivo su http://${HOST}:${PORT}`));
}

module.exports = { createGameServer };
