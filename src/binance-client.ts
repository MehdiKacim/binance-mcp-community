/**
 * Binance Global REST API Client
 * Supports BINANCE_BASE_URL env variable for proxy routing
 */

import type { BinanceConfig } from './types.js';

async function hmacSha256Hex(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export class BinanceClient {
  private config: BinanceConfig;
  private baseUrl: string;

  constructor(config: BinanceConfig) {
    this.config = config;
    // Allow proxy override via env variable
    this.baseUrl = (typeof process !== 'undefined' && process.env?.BINANCE_BASE_URL)
      ? process.env.BINANCE_BASE_URL.replace(/\/$/, '')
      : process.env.BINANCE_BASE_URL || 'https://api3.binance.com';
  }

  private buildQueryString(params: Record<string, unknown>): string {
    const entries = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, String(v)] as [string, string]);
    return new URLSearchParams(entries).toString();
  }

  private async getServerTime(): Promise<number> {
    const data = await this.publicGet<{ serverTime: number }>('/api/v3/time');
    return data.serverTime;
  }

  async publicGet<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    let url = `${this.baseUrl}${endpoint}`;
    if (params) {
      const qs = this.buildQueryString(params);
      if (qs) url += `?${qs}`;
    }
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Binance API Error ${response.status}: ${(error as any).msg || (error as any).message || response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  private async signedRequest<T>(method: string, endpoint: string, params?: Record<string, unknown>): Promise<T> {
    const serverTime = await this.getServerTime();
    const allParams: Record<string, unknown> = { ...params, timestamp: serverTime, recvWindow: (params?.recvWindow as number) || 5000 };
    const queryString = this.buildQueryString(allParams);
    const signature = await hmacSha256Hex(this.config.secretKey, queryString);
    const signedQs = `${queryString}&signature=${signature}`;
    const url = (method === 'GET' || method === 'DELETE') ? `${this.baseUrl}${endpoint}?${signedQs}` : `${this.baseUrl}${endpoint}`;
    const fetchOpts: RequestInit = { method, headers: { 'X-MBX-APIKEY': this.config.apiKey } };
    if (method === 'POST') {
      fetchOpts.headers = { ...fetchOpts.headers, 'Content-Type': 'application/x-www-form-urlencoded' };
      fetchOpts.body = signedQs;
    }
    const response = await fetch(url, fetchOpts);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Binance API Error ${response.status}: ${(error as any).msg || (error as any).code || response.statusText}`);
    }
    const text = await response.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  private async userStreamRequest<T>(method: string, endpoint: string, params?: Record<string, unknown>): Promise<T> {
    let url = `${this.baseUrl}${endpoint}`;
    if (params) { const qs = this.buildQueryString(params); if (qs) url += `?${qs}`; }
    const response = await fetch(url, { method, headers: { 'X-MBX-APIKEY': this.config.apiKey } });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Binance API Error ${response.status}: ${(error as any).msg || (error as any).code || response.statusText}`);
    }
    const text = await response.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  async ping() { return this.publicGet('/api/v3/ping'); }
  async getServerTimePublic() { return this.publicGet<{ serverTime: number }>('/api/v3/time'); }
  async getExchangeInfo(params?: { symbol?: string; symbols?: string }) { return this.publicGet('/api/v3/exchangeInfo', params); }
  async getOrderBook(params: { symbol: string; limit?: number }) { return this.publicGet('/api/v3/depth', params); }
  async getRecentTrades(params: { symbol: string; limit?: number }) { return this.publicGet('/api/v3/trades', params); }
  async getAggregateTrades(params: Record<string, unknown>) { return this.publicGet('/api/v3/aggTrades', params); }
  async getKlines(params: Record<string, unknown>) { return this.publicGet('/api/v3/klines', params); }
  async getAvgPrice(params: { symbol: string }) { return this.publicGet('/api/v3/avgPrice', params); }
  async getTicker24hr(params?: { symbol?: string }) { return this.publicGet('/api/v3/ticker/24hr', params); }
  async getTickerPrice(params?: { symbol?: string }) { return this.publicGet('/api/v3/ticker/price', params); }
  async getBookTicker(params?: { symbol?: string }) { return this.publicGet('/api/v3/ticker/bookTicker', params); }
  async newOrder(params: Record<string, unknown>) { return this.signedRequest('POST', '/api/v3/order', params); }
  async testOrder(params: Record<string, unknown>) { return this.signedRequest('POST', '/api/v3/order/test', params); }
  async queryOrder(params: Record<string, unknown>) { return this.signedRequest('GET', '/api/v3/order', params); }
  async cancelOrder(params: Record<string, unknown>) { return this.signedRequest('DELETE', '/api/v3/order', params); }
  async cancelAllOrders(params: Record<string, unknown>) { return this.signedRequest('DELETE', '/api/v3/openOrders', params); }
  async getOpenOrders(params?: Record<string, unknown>) { return this.signedRequest('GET', '/api/v3/openOrders', params); }
  async getAllOrders(params: Record<string, unknown>) { return this.signedRequest('GET', '/api/v3/allOrders', params); }
  async getAccountInfo(params?: Record<string, unknown>) { return this.signedRequest('GET', '/api/v3/account', params); }
  async getMyTrades(params: Record<string, unknown>) { return this.signedRequest('GET', '/api/v3/myTrades', params); }
  async createListenKey() { return this.userStreamRequest<{ listenKey: string }>('POST', '/api/v3/userDataStream'); }
  async keepaliveListenKey(listenKey: string) { return this.userStreamRequest('PUT', '/api/v3/userDataStream', { listenKey }); }
  async closeListenKey(listenKey: string) { return this.userStreamRequest('DELETE', '/api/v3/userDataStream', { listenKey }); }
}