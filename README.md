# @mylinedchart/mcp-chart-context

Read-only MCP server giving AI agents read-only access to your live [MyLinedChart](https://mylinedchart.com) desktop chart and workspace context. Requires the MyLinedChart desktop app. Full docs: [mylinedchart.com/mcp](https://mylinedchart.com/mcp)

## Tools

| Tool | Purpose |
|------|---------|
| `get_chart_context` | Returns the current MyLinedChart chart and workspace summary: symbol, timeframe, range, provider, connection state, feed type, candle/drawing/indicator counts, diagnostics ID, and data freshness. Read-only. |
| `get_candles` | Returns the most-recent OHLCV candle bars for the current chart. Fields: timestamp (epoch ms), open, high, low, close, volume. Read-only. |
| `get_drawings` | Returns all drawings and price levels for the current chart symbol: trend lines, horizontal levels, note labels, and other overlays. Read-only. |
| `get_indicators` | Returns the configured indicators for the current chart: name, calculation parameters, placement (main/lower), and visibility. Does NOT include series data. Read-only. |
| `get_provider_status` | Returns IBKR connector and market-data provider status: connection state, MarketDataStatus code, feed type (delayed/live), diagnostics ID, and last-updated. Never exposes account IDs, credentials, or bridge URLs. Read-only. |

## Privacy & safety

- **Read-only.** No mutations, no order entry, no trading.
- **Local.** The server runs on your machine alongside the desktop app. Nothing leaves your machine.
- **Redacted.** Account IDs, credentials, bridge URLs, and session tokens are stripped before any context is returned.

## Install

```bash
npm install -g @mylinedchart/mcp-chart-context
```

Node 18 or later required.

## Usage

Add to your AI agent's MCP config (`claude_desktop_config.json` or `~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "mylinedchart": {
      "command": "mlc-mcp"
    }
  }
}
```

Then:

1. Download and open the MyLinedChart desktop app ([mylinedchart.com/resources/downloads](https://mylinedchart.com/resources/downloads)).
2. Enable the MCP server in-app (Settings → MCP).
3. Load a chart. Your AI agent can now call the five read-only tools above.

### Override the context file path

```bash
MLC_CONTEXT_FILE=/custom/path/agent-context.json mlc-mcp
```

## Links

- Product: [mylinedchart.com](https://mylinedchart.com)
- MCP docs: [mylinedchart.com/mcp](https://mylinedchart.com/mcp)
- Downloads: [mylinedchart.com/resources/downloads](https://mylinedchart.com/resources/downloads)
