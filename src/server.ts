import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { isIsaEnabled } from "./config.js";
import { registerAccountBalanceTool } from "./tools/account-balance.js";
import { registerAccountHoldingsTool } from "./tools/account-holdings.js";
import { registerBrokerActivityTool } from "./tools/broker-activity.js";
import { registerEtfInfoTool } from "./tools/etf-info.js";
import { registerEtfReturnsTool } from "./tools/etf-returns.js";
import { registerForeignHoldingTool } from "./tools/foreign-holding.js";
import { registerInvestorTrendTool } from "./tools/investor-trend.js";
import { registerIsaTaxStatusTool } from "./tools/isa-tax-status.js";
import { registerMarketIndexTool } from "./tools/market-index.js";
import { registerMarketMoversTool } from "./tools/market-movers.js";
import { registerOrderbookTool } from "./tools/orderbook.js";
import { registerPendingOrdersTool } from "./tools/pending-orders.js";
import { registerPingTool } from "./tools/ping.js";
import { registerProgramTradingTool } from "./tools/program-trading.js";
import { registerRankingTool } from "./tools/ranking.js";
import { registerSectorPriceTool, registerSectorStocksTool } from "./tools/sector.js";
import { registerShortSellingTool } from "./tools/short-selling.js";
import { registerStockChartTool } from "./tools/stock-chart.js";
import { registerStockLendingTool } from "./tools/stock-lending.js";
import { registerStockPriceTool } from "./tools/stock-price.js";
import { registerStockSearchTool } from "./tools/stock-search.js";
import { registerThemeGroupsTool, registerThemeStocksTool } from "./tools/theme.js";
import { registerTradingJournalTool } from "./tools/trading-journal.js";
import { registerTransactionsTool } from "./tools/transactions.js";
import { registerViStocksTool } from "./tools/vi-stocks.js";
import { registerWatchlistGroupsTool, registerWatchlistTool } from "./tools/watchlist.js";

export const SERVER_NAME = "kiwoom-mcp-server";
export const SERVER_VERSION = "0.19.0";

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
  registerSectorPriceTool(server);
  registerSectorStocksTool(server);
  registerRankingTool(server);
  registerMarketMoversTool(server);
  registerViStocksTool(server);
  registerInvestorTrendTool(server);
  registerBrokerActivityTool(server);
  registerEtfInfoTool(server);
  registerEtfReturnsTool(server);
  registerShortSellingTool(server);
  registerStockLendingTool(server);
  registerForeignHoldingTool(server);
  registerProgramTradingTool(server);

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

  // ISA tax tool — opt-in, general-account-first. Enable with ISA_ENABLED=true
  // (see .env.example). A non-ISA / general account simply won't see this tool.
  if (isIsaEnabled()) {
    registerIsaTaxStatusTool(server);
  }

  return server;
}
