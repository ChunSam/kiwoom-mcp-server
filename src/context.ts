import { getConfig, type AppConfig } from "./config.js";
import { TokenManager } from "./kiwoom/auth.js";
import { KiwoomClient } from "./kiwoom/client.js";

export interface KiwoomContext {
  config: AppConfig;
  client: KiwoomClient;
}

let context: KiwoomContext | null = null;

/**
 * Lazily builds the shared Kiwoom client. Config errors (missing .env) are
 * thrown here — at tool-call time — so the server still starts and `ping`
 * works without credentials.
 */
export function getKiwoomContext(): KiwoomContext {
  if (!context) {
    const config = getConfig();
    context = { config, client: new KiwoomClient(config, new TokenManager(config)) };
  }
  return context;
}
