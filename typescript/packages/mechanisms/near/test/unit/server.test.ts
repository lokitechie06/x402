import { describe, it, expect } from "vitest";
import { ExactNearScheme } from "../../src/exact/server/scheme";
import {
  NEAR_MAINNET_CAIP2,
  NEAR_TESTNET_CAIP2,
  USDC_MAINNET_ADDRESS,
  USDC_TESTNET_ADDRESS,
} from "../../src/constants";

describe("ExactNearScheme (server)", () => {
  const server = new ExactNearScheme();

  describe("scheme", () => {
    it("has scheme 'exact'", () => {
      expect(server.scheme).toBe("exact");
    });
  });

  describe("parsePrice", () => {
    describe("mainnet", () => {
      it("parses dollar string", async () => {
        const result = await server.parsePrice("$1.00", NEAR_MAINNET_CAIP2);
        expect(result.amount).toBe("1000000");
        expect(result.asset).toBe(USDC_MAINNET_ADDRESS);
        expect(result.extra).toEqual({});
      });

      it("parses plain number string", async () => {
        const result = await server.parsePrice("0.50", NEAR_MAINNET_CAIP2);
        expect(result.amount).toBe("500000");
      });

      it("parses JS number", async () => {
        const result = await server.parsePrice(2.5, NEAR_MAINNET_CAIP2);
        expect(result.amount).toBe("2500000");
      });

      it("handles whole number", async () => {
        const result = await server.parsePrice("10", NEAR_MAINNET_CAIP2);
        expect(result.amount).toBe("10000000");
      });

      it("handles fractional cents correctly", async () => {
        const result = await server.parsePrice("$4.02", NEAR_MAINNET_CAIP2);
        expect(result.amount).toBe("4020000");
      });
    });

    describe("testnet", () => {
      it("uses testnet USDC address", async () => {
        const result = await server.parsePrice("1.00", NEAR_TESTNET_CAIP2);
        expect(result.asset).toBe(USDC_TESTNET_ADDRESS);
        expect(result.amount).toBe("1000000");
      });
    });

    describe("pre-parsed AssetAmount", () => {
      it("returns AssetAmount unchanged when asset is specified", async () => {
        const result = await server.parsePrice(
          { amount: "999", asset: "custom.token.near", extra: { foo: "bar" } },
          NEAR_MAINNET_CAIP2,
        );
        expect(result.amount).toBe("999");
        expect(result.asset).toBe("custom.token.near");
        expect(result.extra).toEqual({ foo: "bar" });
      });

      it("throws when asset is missing", async () => {
        await expect(
          server.parsePrice({ amount: "999" } as never, NEAR_MAINNET_CAIP2),
        ).rejects.toThrow("Asset address must be specified");
      });
    });

    describe("error cases", () => {
      it("throws for invalid money string", async () => {
        await expect(server.parsePrice("not-a-number", NEAR_MAINNET_CAIP2)).rejects.toThrow(
          "Invalid money format",
        );
      });
    });

    describe("custom money parser", () => {
      it("uses custom parser when it returns a value", async () => {
        const customServer = new ExactNearScheme();
        customServer.registerMoneyParser((_amount, _network) => ({
          amount: "777",
          asset: "custom.near",
          extra: {},
        }));
        const result = await customServer.parsePrice("1.00", NEAR_MAINNET_CAIP2);
        expect(result.amount).toBe("777");
        expect(result.asset).toBe("custom.near");
      });

      it("falls back to default when custom parser returns null", async () => {
        const customServer = new ExactNearScheme();
        customServer.registerMoneyParser(() => null);
        const result = await customServer.parsePrice("1.00", NEAR_MAINNET_CAIP2);
        expect(result.asset).toBe(USDC_MAINNET_ADDRESS);
      });

      it("chains multiple parsers and uses first non-null", async () => {
        const customServer = new ExactNearScheme();
        customServer.registerMoneyParser(() => null);
        customServer.registerMoneyParser((_amount, _network) => ({
          amount: "123",
          asset: "second.near",
          extra: {},
        }));
        const result = await customServer.parsePrice("1.00", NEAR_MAINNET_CAIP2);
        expect(result.amount).toBe("123");
      });
    });
  });

  describe("enhancePaymentRequirements", () => {
    it("returns requirements unchanged (no feePayer needed for NEAR)", async () => {
      const req = {
        scheme: "exact",
        network: NEAR_MAINNET_CAIP2,
        asset: USDC_MAINNET_ADDRESS,
        amount: "1000000",
        payTo: "merchant.near",
        maxTimeoutSeconds: 300,
      };
      const result = await server.enhancePaymentRequirements(req as never);
      expect(result).toEqual(req);
    });
  });
});
