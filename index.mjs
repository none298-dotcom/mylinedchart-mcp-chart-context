#!/usr/bin/env node
/**
 * MyLinedChart read-only MCP server (Stage 4 — local desktop).
 *
 * Transport: stdio (add to claude_desktop_config.json or ~/.claude/settings.json).
 * State source: ~/Library/Application Support/MyLinedChart/agent-context.json
 *   — written atomically by the desktop app's native bridge whenever the chart
 *     loads a new dataset, workspace changes, or provider state changes.
 *
 * READ-ONLY. No mutations. No trading. No order entry. No secrets exposed.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// State file location
// ---------------------------------------------------------------------------

function defaultContextPath() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || os.homedir(), "MyLinedChart", "agent-context.json");
  }
  return path.join(os.homedir(), "Library", "Application Support", "MyLinedChart", "agent-context.json");
}
const CONTEXT_FILE = process.env.MLC_CONTEXT_FILE || defaultContextPath();

// ---------------------------------------------------------------------------
// Redaction — hard deny-list applied before any context leaves this process
// ---------------------------------------------------------------------------

const REDACTED_FIELD_PATTERNS = [
  /account/i,
  /token/i,
  /password/i,
  /secret/i,
  /credential/i,
  /bridge.*url/i,
  /session.*key/i,
  /auth.*key/i,
  /api.*key/i,
  /ibkr.*url/i,
  /connector.*url/i,
];

function isRedactedKey(key) {
  const str = String(key || "").trim().toLowerCase();
  // Always allow these safe keys even if they superficially match a pattern
  const SAFE_ALLOWLIST = new Set([
    "symbol", "timeframe", "range", "provider", "feed", "state", "connection_state",
    "diagnostics_id", "last_updated", "candle_count", "drawing_count",
    "indicator_count", "note_count", "has_account", "data_freshness_ms",
    "market_data_status", "error_message", "runtime",
  ]);
  if (SAFE_ALLOWLIST.has(str)) return false;
  return REDACTED_FIELD_PATTERNS.some(re => re.test(str));
}

function deepRedact(obj, depth = 0) {
  if (depth > 8 || obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(item => deepRedact(item, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isRedactedKey(k)) continue;
    out[k] = deepRedact(v, depth + 1);
  }
  return out;
}

// Candle fields: only OHLCV — enforced at read time regardless of what's in the file
const CANDLE_ALLOWED = new Set(["timestamp", "open", "high", "low", "close", "volume"]);
function sanitizeCandle(c) {
  if (!c || typeof c !== "object") return null;
  const out = {};
  for (const f of CANDLE_ALLOWED) {
    if (c[f] !== undefined) out[f] = c[f];
  }
  // Must have at least timestamp + OHLC to be meaningful
  if (!("timestamp" in out) || !("open" in out)) return null;
  return out;
}

// ---------------------------------------------------------------------------
// Context file reader
// ---------------------------------------------------------------------------

function readContextFile() {
  let raw;
  try {
    raw = fs.readFileSync(CONTEXT_FILE, "utf8");
  } catch (err) {
    return {
      error: "context_file_not_found",
      detail: "The MyLinedChart desktop app has not written a context snapshot yet. " +
        "Open the app, load a chart, and this file will appear at: " + CONTEXT_FILE,
      context_file: CONTEXT_FILE,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "context_file_invalid_json", context_file: CONTEXT_FILE };
  }
  return deepRedact(parsed);
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

function toolGetChartContext() {
  const ctx = readContextFile();
  if (ctx.error) return { error: ctx.error, detail: ctx.detail ?? "", context_file: ctx.context_file };

  const summary = ctx.summary ?? ctx;
  return {
    symbol: summary.symbol ?? "",
    timeframe: summary.timeframe ?? "",
    range: summary.range ?? "",
    provider: summary.provider ?? "",
    runtime: summary.runtime ?? "",
    feed: summary.feed ?? "",
    connection_state: summary.connection_state ?? "",
    market_data_status: summary.market_data_status ?? "",
    has_account: summary.has_account ?? false,
    candle_count: summary.candle_count ?? 0,
    drawing_count: summary.drawing_count ?? 0,
    indicator_count: summary.indicator_count ?? 0,
    note_count: summary.note_count ?? 0,
    data_freshness_ms: summary.data_freshness_ms ?? null,
    last_updated: summary.last_updated ?? "",
    diagnostics_id: summary.diagnostics_id ?? "",
    error_message: summary.error_message ?? "",
    _context_file: CONTEXT_FILE,
  };
}

function toolGetCandles(args) {
  const ctx = readContextFile();
  if (ctx.error) return { error: ctx.error, detail: ctx.detail ?? "" };

  const raw = Array.isArray(ctx.candles) ? ctx.candles : [];
  const limit = Math.min(Math.max(1, Number(args?.limit) || 500), 2000);
  const candles = raw.slice(-limit).map(sanitizeCandle).filter(Boolean);

  return {
    symbol: ctx.summary?.symbol ?? "",
    timeframe: ctx.summary?.timeframe ?? "",
    range: ctx.summary?.range ?? "",
    provider: ctx.summary?.provider ?? "",
    feed: ctx.summary?.feed ?? "",
    candle_count: candles.length,
    total_available: raw.length,
    candles,
  };
}

function toolGetDrawings() {
  const ctx = readContextFile();
  if (ctx.error) return { error: ctx.error, detail: ctx.detail ?? "" };

  const raw = Array.isArray(ctx.drawings) ? ctx.drawings : [];
  const drawings = raw.map(d => {
    if (!d || typeof d !== "object") return null;
    return {
      id: d.id ?? "",
      ticker: d.ticker ?? "",
      name: d.name ?? "",
      points: Array.isArray(d.points) ? d.points : [],
      label: d.extendData?.label ?? d.label ?? "",
    };
  }).filter(Boolean);

  return {
    symbol: ctx.summary?.symbol ?? "",
    drawing_count: drawings.length,
    drawings,
  };
}

function toolGetIndicators() {
  const ctx = readContextFile();
  if (ctx.error) return { error: ctx.error, detail: ctx.detail ?? "" };

  const raw = Array.isArray(ctx.indicators) ? ctx.indicators : [];
  // Return only config (name/params/placement) — NOT series data, which can be large
  const indicators = raw.map(ind => {
    if (!ind || typeof ind !== "object") return null;
    return {
      id: ind.id ?? "",
      name: ind.name ?? "",
      calc_params: Array.isArray(ind.calcParams) ? ind.calcParams : [],
      placement: ind.placement ?? "main",
      visible: ind.visible !== false,
    };
  }).filter(Boolean);

  return {
    symbol: ctx.summary?.symbol ?? "",
    indicator_count: indicators.length,
    indicators,
  };
}

function toolGetProviderStatus() {
  const ctx = readContextFile();
  if (ctx.error) return { error: ctx.error, detail: ctx.detail ?? "" };

  const summary = ctx.summary ?? ctx;
  return {
    provider: summary.provider ?? "",
    runtime: summary.runtime ?? "",
    connection_state: summary.connection_state ?? "",
    market_data_status: summary.market_data_status ?? "",
    feed: summary.feed ?? "",
    has_account: summary.has_account ?? false,
    diagnostics_id: summary.diagnostics_id ?? "",
    error_message: summary.error_message ?? "",
    data_freshness_ms: summary.data_freshness_ms ?? null,
    last_updated: summary.last_updated ?? "",
    connector_state: ctx.connector_state ?? {},
  };
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "get_chart_context",
    description:
      "Returns the current MyLinedChart chart and workspace summary: symbol, timeframe, " +
      "range, provider, connection state, feed type, candle/drawing/indicator counts, " +
      "diagnostics ID, and data freshness. Read-only.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_candles",
    description:
      "Returns the most-recent OHLCV candle bars for the current chart. " +
      "Fields: timestamp (epoch ms), open, high, low, close, volume. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of most-recent bars to return (1–2000, default 500).",
        },
      },
      required: [],
    },
  },
  {
    name: "get_drawings",
    description:
      "Returns all drawings and price levels for the current chart symbol: " +
      "trend lines, horizontal levels, note labels, and other overlays. Read-only.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_indicators",
    description:
      "Returns the configured indicators for the current chart: name, calculation " +
      "parameters, placement (main/lower), and visibility. Does NOT include series data. Read-only.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_provider_status",
    description:
      "Returns IBKR connector and market-data provider status: connection state, " +
      "MarketDataStatus code, feed type (delayed/live), diagnostics ID, and last-updated. " +
      "Never exposes account IDs, credentials, or bridge URLs. Read-only.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

async function main() {
  const server = new Server(
    {
      name: "mlc-chart-context",
      version: "0.1.0",
    },
    {
      capabilities: { tools: {} },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    let result;
    switch (name) {
      case "get_chart_context":   result = toolGetChartContext();         break;
      case "get_candles":         result = toolGetCandles(args);          break;
      case "get_drawings":        result = toolGetDrawings();             break;
      case "get_indicators":      result = toolGetIndicators();           break;
      case "get_provider_status": result = toolGetProviderStatus();       break;
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  process.stderr.write(`mlc-mcp fatal: ${err?.message ?? err}\n`);
  process.exit(1);
});
