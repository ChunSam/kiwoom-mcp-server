import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { isIsaEnabled } from "./config.js";
import { registerAccountBalanceTool } from "./tools/account-balance.js";
import { registerAccountHoldingsTool } from "./tools/account-holdings.js";
import { registerAccountTodayTool } from "./tools/account-today.js";
import { registerAccountTrendTool } from "./tools/account-trend.js";
import { registerAfterHoursTool } from "./tools/after-hours.js";
import { registerBrokerActivityTool } from "./tools/broker-activity.js";
import { registerCreditTrendTool } from "./tools/credit-trend.js";
import { registerDailyTradingTool } from "./tools/daily-trading.js";
import { registerEtfInfoTool } from "./tools/etf-info.js";
import { registerEqualNetTradeTool } from "./tools/equal-net-trade.js";
import { registerEtfRankTool } from "./tools/etf-rank.js";
import { registerGoldPriceTool } from "./tools/gold-price.js";
import { registerEtfReturnsTool } from "./tools/etf-returns.js";
import { registerExecutionStrengthTool } from "./tools/execution-strength.js";
import { registerExpectedExecutionTool } from "./tools/expected-execution.js";
import { registerForeignHoldingTool } from "./tools/foreign-holding.js";
import { registerForeignIntradayTool } from "./tools/foreign-intraday.js";
import { registerInvestorRankTool } from "./tools/investor-rank.js";
import { registerInstitutionTrendTool } from "./tools/institution-trend.js";
import { registerInvestorTrendTool } from "./tools/investor-trend.js";
import { registerIsaTaxStatusTool } from "./tools/isa-tax-status.js";
import { registerMarketIndexTool } from "./tools/market-index.js";
import { registerMarketMoversTool } from "./tools/market-movers.js";
import { registerNetBuyRankTool } from "./tools/net-buy-rank.js";
import { registerOrderExecutionsTool } from "./tools/order-executions.js";
import { registerOrderbookRankTool } from "./tools/orderbook-rank.js";
import { registerOrderbookTool } from "./tools/orderbook.js";
import { registerPendingOrdersTool } from "./tools/pending-orders.js";
import { registerPingTool } from "./tools/ping.js";
import { registerProgramTradingTool } from "./tools/program-trading.js";
import { registerRankingTool } from "./tools/ranking.js";
import { registerSectorChartTool } from "./tools/sector-chart.js";
import { registerSectorFlowTool } from "./tools/sector-flow.js";
import { registerSectorPriceTool, registerSectorStocksTool } from "./tools/sector.js";
import { registerShortSellingTool } from "./tools/short-selling.js";
import { registerStockChartTool } from "./tools/stock-chart.js";
import { registerStockLendingTool } from "./tools/stock-lending.js";
import { registerStockPriceTool } from "./tools/stock-price.js";
import { registerStockQuotesTool } from "./tools/stock-quotes.js";
import { registerStockSearchTool } from "./tools/stock-search.js";
import { registerSupplyConcentrationTool } from "./tools/supply-concentration.js";
import { registerThemeGroupsTool, registerThemeStocksTool } from "./tools/theme.js";
import { registerTradingJournalTool } from "./tools/trading-journal.js";
import { registerTransactionsTool } from "./tools/transactions.js";
import { registerValuationRankTool } from "./tools/valuation-rank.js";
import { registerViStocksTool } from "./tools/vi-stocks.js";
import { registerWatchlistGroupsTool, registerWatchlistTool } from "./tools/watchlist.js";

export const SERVER_NAME = "kiwoom-mcp-server";
export const SERVER_VERSION = "0.47.0";

export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerPingTool(server);

  // Market data (account-independent)
  registerStockSearchTool(server);
  registerStockPriceTool(server);
  registerStockQuotesTool(server);
  registerStockChartTool(server);
  registerDailyTradingTool(server);
  registerOrderbookTool(server);
  registerOrderbookRankTool(server);
  registerMarketIndexTool(server);
  registerSectorPriceTool(server);
  registerSectorStocksTool(server);
  registerSectorChartTool(server);
  registerSectorFlowTool(server);
  registerRankingTool(server);
  registerValuationRankTool(server);
  registerSupplyConcentrationTool(server);
  registerMarketMoversTool(server);
  registerViStocksTool(server);
  registerExpectedExecutionTool(server);
  registerInvestorTrendTool(server);
  registerInstitutionTrendTool(server);
  registerInvestorRankTool(server);
  registerNetBuyRankTool(server);
  registerEqualNetTradeTool(server);
  registerForeignIntradayTool(server);
  registerBrokerActivityTool(server);
  registerEtfInfoTool(server);
  registerEtfReturnsTool(server);
  registerEtfRankTool(server);
  registerGoldPriceTool(server);
  registerExecutionStrengthTool(server);
  registerShortSellingTool(server);
  registerStockLendingTool(server);
  registerCreditTrendTool(server);
  registerForeignHoldingTool(server);
  registerProgramTradingTool(server);
  registerAfterHoursTool(server);

  // Watchlist (HTS 저장 관심종목 — read-only; ka01300/ka01301)
  registerWatchlistGroupsTool(server);
  registerWatchlistTool(server);

  // Theme (테마 그룹 + 구성종목; ka90001/ka90002)
  registerThemeGroupsTool(server);
  registerThemeStocksTool(server);

  // Account (bound to the app key)
  registerAccountBalanceTool(server);
  registerAccountHoldingsTool(server);
  registerAccountTrendTool(server);
  registerAccountTodayTool(server);
  registerTransactionsTool(server);
  registerPendingOrdersTool(server);
  registerOrderExecutionsTool(server);
  registerTradingJournalTool(server);

  // ISA tax tool — opt-in, general-account-first. Enable with ISA_ENABLED=true
  // (see .env.example). A non-ISA / general account simply won't see this tool.
  if (isIsaEnabled()) {
    registerIsaTaxStatusTool(server);
  }

  return server;
}
