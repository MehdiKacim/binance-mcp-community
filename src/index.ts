#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from './server.js';
import { TOOLS } from './tools.js';

function getConfig() {
  const apiKey = process.env.BINANCE_API_KEY;
  const secretKey = process.env.BINANCE_SECRET_KEY;
  if (!apiKey || !secretKey) return null;
  return { apiKey, secretKey };
}

async function startStdio() {
  const config = getConfig();
  const server = createServer(config ?? undefined);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Binance MCP Server running on stdio');
}

async function startHttp() {
  const port = parseInt(process.env.PORT || '3000', 10);
  const app = createMcpExpressApp({ host: '0.0.0.0' });
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  // ── Binance API Proxy ──────────────────────────────────────────
  // Routes /binance/* → https://api.binance.com/*
  // Set BINANCE_BASE_URL=https://YOUR-RAILWAY-URL/binance in Railway vars
  app.use('/binance', async (req: any, res: any) => {
    try {
      const path = req.url || '/';
      const target = `https://api.binance.com${path}`;
      const headers: Record<string, string> = {};
      if (req.headers['x-mbx-apikey']) headers['X-MBX-APIKEY'] = req.headers['x-mbx-apikey'];
      if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

      const response = await fetch(target, {
        method: req.method,
        headers,
        body: req.method !== 'GET' && req.method !== 'DELETE' ? JSON.stringify(req.body) : undefined,
      });

      const text = await response.text();
      res.status(response.status)
        .set('Content-Type', 'application/json')
        .set('Access-Control-Allow-Origin', '*')
        .send(text);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  // ──────────────────────────────────────────────────────────────

  app.post('/mcp', async (req: any, res: any) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const qApiKey = url.searchParams.get('BINANCE_API_KEY');
    const qSecretKey = url.searchParams.get('BINANCE_SECRET_KEY');
    if (qApiKey) process.env.BINANCE_API_KEY = qApiKey;
    if (qSecretKey) process.env.BINANCE_SECRET_KEY = qSecretKey;

    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    try {
      let transport: StreamableHTTPServerTransport;
      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => { transports[sid] = transport; },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) delete transports[sid];
        };
        const config = getConfig();
        const server = createServer(config ?? undefined);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request' }, id: null });
        return;
      }
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  });

  app.get('/mcp', async (req: any, res: any) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) { res.status(400).send('Invalid or missing session ID'); return; }
    await transports[sessionId].handleRequest(req, res);
  });

  app.delete('/mcp', async (req: any, res: any) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) { res.status(400).send('Invalid or missing session ID'); return; }
    await transports[sessionId].handleRequest(req, res);
  });

  app.get('/', (_req: any, res: any) => {
    res.json({ name: 'binance-mcp', version: '1.0.0', status: 'ok', tools: TOOLS.length, transport: 'streamable-http', endpoints: { mcp: '/mcp', proxy: '/binance/*' } });
  });

  app.listen(port, () => {
    console.log(`Binance MCP Server (HTTP) listening on port ${port}`);
    console.log(`Tools available: ${TOOLS.length}`);
    console.log(`MCP endpoint: http://localhost:${port}/mcp`);
    console.log(`Proxy endpoint: http://localhost:${port}/binance/*`);
  });

  process.on('SIGINT', async () => {
    for (const sessionId in transports) { try { await transports[sessionId].close(); delete transports[sessionId]; } catch {} }
    process.exit(0);
  });
}

async function main() {
  const useHttp = process.argv.includes('--http');
  if (useHttp) await startHttp();
  else await startStdio();
}

export default function createSmitheryServer(opts?: { config?: { BINANCE_API_KEY?: string; BINANCE_SECRET_KEY?: string } }) {
  if (opts?.config?.BINANCE_API_KEY) process.env.BINANCE_API_KEY = opts.config.BINANCE_API_KEY;
  if (opts?.config?.BINANCE_SECRET_KEY) process.env.BINANCE_SECRET_KEY = opts.config.BINANCE_SECRET_KEY;
  return createServer(getConfig() ?? undefined);
}

main().catch((error) => { console.error('Fatal error:', error); process.exit(1); });