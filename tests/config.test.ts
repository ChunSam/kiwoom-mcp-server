import { describe, expect, it } from "vitest";

import { buildConfig } from "../src/config.js";

const creds = { KIWOOM_APP_KEY: "app-key", KIWOOM_APP_SECRET: "app-secret" };

describe("buildConfig", () => {
  it("treats a blank ISA_OPENED_ON (the shipped .env.example default) as unset, not an error", () => {
    // A mock/general account never uses ISA; a blank value must not break config load.
    const cfg = buildConfig({ ...creds, ISA_OPENED_ON: "" });
    expect(cfg.isaOpenedOn).toBeUndefined();
    expect(cfg.isaType).toBe("GENERAL");
  });

  it("treats a blank ISA_TYPE / KIWOOM_MODE as their defaults", () => {
    const cfg = buildConfig({ ...creds, ISA_TYPE: "", KIWOOM_MODE: "" });
    expect(cfg.isaType).toBe("GENERAL");
    expect(cfg.mode).toBe("VIRTUAL");
  });

  it("defaults to VIRTUAL / 모의투자 / mockapi when mode is omitted", () => {
    const cfg = buildConfig({ ...creds });
    expect(cfg.mode).toBe("VIRTUAL");
    expect(cfg.modeLabel).toBe("모의투자");
    expect(cfg.baseUrl).toBe("https://mockapi.kiwoom.com");
  });

  it("honors REAL mode → 실전투자 / api.kiwoom.com", () => {
    const cfg = buildConfig({ ...creds, KIWOOM_MODE: "REAL" });
    expect(cfg.modeLabel).toBe("실전투자");
    expect(cfg.baseUrl).toBe("https://api.kiwoom.com");
  });

  it("normalizes a valid ISA_OPENED_ON to yyyyMMdd (dashed or not)", () => {
    expect(buildConfig({ ...creds, ISA_OPENED_ON: "2024-01-02" }).isaOpenedOn).toBe("20240102");
    expect(buildConfig({ ...creds, ISA_OPENED_ON: "20240102" }).isaOpenedOn).toBe("20240102");
  });

  it("still rejects a malformed ISA_OPENED_ON", () => {
    expect(() => buildConfig({ ...creds, ISA_OPENED_ON: "2024/01/02" })).toThrow(/환경설정/);
  });

  it("requires the app key + secret", () => {
    expect(() => buildConfig({ KIWOOM_APP_SECRET: "s" } as NodeJS.ProcessEnv)).toThrow(
      /KIWOOM_APP_KEY/,
    );
  });
});
