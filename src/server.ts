/**
 * Shared MCP Server — Fixed version
 *
 * FIX: Use low-level Server class instead of McpServer to declare tool
 * capabilities explicitly, bypassing the Zod schema requirement of registerTool().
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
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
  // Use low-level Server with explicit capabilities instead of McpServer
  const server = new Server(
    { name: 'binance-mcp', version: '1.0.0' },
    {
      capabilities: {
        tools: {},
        prompts: {},
      },
    }
  );

  // tools/list
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOLS.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    })),
  }));

  // tools/call
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    const tool = TOOLS.find(t => t.name === toolName);
    if (!tool) {
      return {
        content: [{ type: 'text' as const, text: `Error: Unknown tool "${toolName}"` }],
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
        content: [{ type: 'text' as const, text: 'Error: BINANCE_API_KEY and BINANCE_SECRET_KEY are required.' }],
        isError: true,
      };
    }

    const client = new BinanceClient({ apiKey: apiKey || '', secretKey: secretKey || '' });

    try {
      const result = await handleToolCall(toolName, args, client);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        isError: false,
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  // prompts/list
  server.setRequestHandler(ListPromptsRequestSchema, () => ({
    prompts: [
      { name: 'market-data-analysis', description: 'Guide for fetching and analyzing Binance market data' },
      { name: 'trading-guide', description: 'Guide for placing and managing orders on Binance' },
    ],
  }));

  // prompts/get
  server.setRequestHandler(GetPromptRequestSchema, (request) => {
    if (request.params.name === 'market-data-analysis') {
      return {
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'Binance market data analyst. Public tools (no API key): bn_ping, bn_ticker_price, bn_ticker_24hr, bn_klines, bn_order_book, bn_avg_price, bn_book_ticker, bn_recent_trades, bn_aggregate_trades, bn_exchange_info, bn_server_time. Symbol format: BTCUSDT.' } }],
      };
    }
    return {
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'WARNING: Real money. Always bn_test_order first. Tools: bn_new_order, bn_test_order, bn_query_order, bn_cancel_order, bn_cancel_all_orders, bn_open_orders, bn_all_orders, bn_account_info, bn_my_trades.' } }],
    };
  });

  return server;
}