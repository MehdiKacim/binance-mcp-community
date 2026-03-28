/**
 * Shared MCP Server — used by both Node.js (index.ts) and CF Worker (worker.ts)
 *
 * FIX: registerTool() in MCP SDK v1.26+ expects Zod schemas, not raw JSON Schema.
 * Calling it with plain objects causes "v3Schema.safeParseAsync is not a function".
 * Solution: bypass registerTool() entirely and use raw request handlers instead.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { BinanceClient } from './binance-client.js';
import { TOOLS } from './tools.js';

export interface BinanceMcpConfig {
  apiKey: string;
  secretKey: string;
}

export function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  client: BinanceClient
) {
  const { _fields, ...params } = args;

  switch (toolName) {
    case 'bn_ping': return client.ping();
    case 'bn_server_time': return client.getServerTimePublic();
    case 'bn_exchange_info':
      return client.getExchangeInfo(
        Object.keys(params).length ? (params as { symbol?: string; symbols?: string }) : undefined
      );
    case 'bn_order_book':
      return client.getOrderBook(params as { symbol: string; limit?: number });
    case 'bn_recent_trades':
      return client.getRecentTrades(params as { symbol: string; limit?: number });
    case 'bn_aggregate_trades': return client.getAggregateTrades(params);
    case 'bn_klines': return client.getKlines(params);
    case 'bn_avg_price': return client.getAvgPrice(params as { symbol: string });
    case 'bn_ticker_24hr':
      return client.getTicker24hr(
        Object.keys(params).length ? (params as { symbol?: string }) : undefined
      );
    case 'bn_ticker_price':
      return client.getTickerPrice(
        Object.keys(params).length ? (params as { symbol?: string }) : undefined
      );
    case 'bn_book_ticker':
      return client.getBookTicker(
        Object.keys(params).length ? (params as { symbol?: string }) : undefined
      );
    case 'bn_new_order': return client.newOrder(params);
    case 'bn_test_order': return client.testOrder(params);
    case 'bn_query_order': return client.queryOrder(params);
    case 'bn_cancel_order': return client.cancelOrder(params);
    case 'bn_cancel_all_orders': return client.cancelAllOrders(params);
    case 'bn_open_orders':
      return client.getOpenOrders(Object.keys(params).length ? params : undefined);
    case 'bn_all_orders': return client.getAllOrders(params);
    case 'bn_account_info':
      return client.getAccountInfo(Object.keys(params).length ? params : undefined);
    case 'bn_my_trades': return client.getMyTrades(params);
    case 'bn_create_listen_key': return client.createListenKey();
    case 'bn_keepalive_listen_key': return client.keepaliveListenKey(params.listenKey as string);
    case 'bn_close_listen_key': return client.closeListenKey(params.listenKey as string);
    default: throw new Error(`Unknown tool: ${toolName}`);
  }
}

const PUBLIC_TOOLS = [
  'bn_ping', 'bn_server_time', 'bn_exchange_info',
  'bn_order_book', 'bn_recent_trades', 'bn_aggregate_trades',
  'bn_klines', 'bn_avg_price', 'bn_ticker_24hr', 'bn_ticker_price',
  'bn_book_ticker',
];

export function createServer(config?: BinanceMcpConfig) {
  const server = new McpServer({ name: 'binance-mcp', version: '1.0.0' });

  // FIX: Use raw handlers instead of registerTool() to avoid Zod schema issue
  (server as any).server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOLS.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    })),
  }));

  (server as any).server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const toolName = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    const tool = TOOLS.find(t => t.name === toolName);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Error: Unknown tool "${toolName}"` }],
        isError: true,
      };
    }

    const apiKey =
      config?.apiKey ||
      (args.BINANCE_API_KEY as string) ||
      (typeof process !== 'undefined' ? process.env?.BINANCE_API_KEY : '') || '';
    const secretKey =
      config?.secretKey ||
      (args.BINANCE_SECRET_KEY as string) ||
      (typeof process !== 'undefined' ? process.env?.BINANCE_SECRET_KEY : '') || '';

    if (!PUBLIC_TOOLS.includes(toolName) && (!apiKey || !secretKey)) {
      return {
        content: [{ type: 'text', text: 'Error: BINANCE_API_KEY and BINANCE_SECRET_KEY are required for this operation.' }],
        isError: true,
      };
    }

    const client = new BinanceClient({ apiKey: apiKey || '', secretKey: secretKey || '' });

    try {
      const result = await handleToolCall(toolName, args, client);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: false,
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  server.prompt('market-data-analysis', 'Guide for fetching and analyzing Binance market data', async () => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'Binance market data analyst. Tools: bn_ping, bn_ticker_price, bn_ticker_24hr, bn_klines, bn_order_book, bn_avg_price, bn_book_ticker, bn_recent_trades, bn_aggregate_trades, bn_exchange_info, bn_server_time. Symbol format: BTCUSDT. All public, no API key needed.' } }],
  }));

  server.prompt('trading-guide', 'Guide for placing and managing orders on Binance', async () => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'WARNING: Real money. Always bn_test_order first. Tools: bn_new_order, bn_test_order, bn_query_order, bn_cancel_order, bn_cancel_all_orders, bn_open_orders, bn_all_orders, bn_account_info, bn_my_trades.' } }],
  }));

  return server;
}