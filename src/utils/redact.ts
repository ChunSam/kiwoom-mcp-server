/**
 * Removes secret values (app key/secret, tokens) from text that may be logged
 * or returned to the MCP client, e.g. raw API response snippets in errors.
 */
export function redactSecrets(text: string, secrets: ReadonlyArray<string | null | undefined>): string {
  let out = text;
  for (const secret of secrets) {
    // Very short strings would over-redact; real keys/tokens are much longer.
    if (secret && secret.length >= 8) {
      out = out.replaceAll(secret, "***REDACTED***");
    }
  }
  return out;
}
