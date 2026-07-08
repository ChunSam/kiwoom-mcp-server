import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerAccountBalanceTool } from "./tools/account-balance.js";
import { registerAccountHoldingsTool } from "./tools/account-holdings.js";
import { registerEtfInfoTool } from "./tools/etf-info.js";
import { registerForeignHoldingTool } from "./tools/foreign-holding.js";
import { registerInvestorTrendTool } from "./tools/investor-trend.js";
import { registerIsaTaxStatusTool } from "./tools/isa-tax-status.js";
import { registerMarketIndexTool } from "./tools/market-index.js";
import { registerOrderbookTool } from "./tools/orderbook.js";
import { registerPendingOrdersTool } from "./tools/pending-orders.js";
import { registerPingTool } from "./tools/ping.js";
import { registerRankingTool } from "./tools/ranking.js";
import { registerShortSellingTool } from "./tools/short-selling.js";
import { registerStockChartTool } from "./tools/stock-chart.js";
import { registerStockPriceTool } from "./tools/stock-price.js";
import { registerStockSearchTool } from "./tools/stock-search.js";
import { registerThemeGroupsTool, registerThemeStocksTool } from "./tools/theme.js";
import { registerTradingJournalTool } from "./tools/trading-journal.js";
import { registerTransactionsTool } from "./tools/transactions.js";
import { registerWatchlistGroupsTool, registerWatchlistTool } from "./tools/watchlist.js";

export const SERVER_NAME = "kiwoom-mcp-server";
export const SERVER_VERSION = "0.8.0";

export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerPingTool(server);

  // Market data (account-independent)
  registerStockSearchTool(server);
  registerStockPriceTool(server);
  registerStockChartTool(server);
  registerOrderbookTool(server);
  registerMarketIndexTool(server);
  registerRankingTool(server);
  registerInvestorTrendTool(server);
  registerEtfInfoTool(server);
  registerShortSellingTool(server);
  registerForeignHoldingTool(server);

  // Watchlist (HTS 저장 관심종목 — read-only; ka01300/ka01301)
  registerWatchlistGroupsTool(server);
  registerWatchlistTool(server);

  // Theme (테마 그룹 + 구성종목; ka90001/ka90002)
  registerThemeGroupsTool(server);
  registerThemeStocksTool(server);

  // Account (bound to the app key)
  registerAccountBalanceTool(server);
  registerAccountHoldingsTool(server);
  registerTransactionsTool(server);
  registerPendingOrdersTool(server);
  registerTradingJournalTool(server);
  registerIsaTaxStatusTool(server);

  return server;
}
