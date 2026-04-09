import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExactNearScheme } from "../../src/exact/facilitator/scheme";
import { SettlementCache } from "../../src/settlement-cache";
import type { FacilitatorNearSigner } from "../../src/signer";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { NEAR_MAINNET_CAIP2, NEAR_TESTNET_CAIP2, USDC_MAINNET_ADDRESS } from "../../src/constants";

// ---- helpers ----------------------------------------------------------------

const VALID_TX_HASH = "FvV7QXPW2JKhNMBYi5hHbUvEdGpNj7z7fFcKhbVp6W1";
const VALID_NONCE = "a3f7c2d891e04b6f00112233445566ff"; // 32 hex chars
const VALID_SENDER = "payer.near";
const VALID_MERCHANT = "merchant.near";
const FACILITATOR_ACCOUNT = "facilitator.near";

function makeValidPayload(overrides: Partial<PaymentPayload["payload"]> = {}): PaymentPayload {
  return {
    x402Version: 2,
    resource: {
      url: "https://example.com/resource",
      description: "Test",
      mimeType: "application/json",
    },
    accepted: {
      scheme: "exact",
      network: NEAR_MAINNET_CAIP2,
      asset: USDC_MAINNET_ADDRESS,
      amount: "1000000",
      payTo: VALID_MERCHANT,
      maxTimeoutSeconds: 300,
    },
    payload: {
      transactionHash: VALID_TX_HASH,
      senderId: VALID_SENDER,
      nonce: VALID_NONCE,
      ...overrides,
    },
  };
}

const VALID_REQUIREMENTS: PaymentRequirements = {
  scheme: "exact",
  network: NEAR_MAINNET_CAIP2,
  asset: USDC_MAINNET_ADDRESS,
  amount: "1000000",
  payTo: VALID_MERCHANT,
  maxTimeoutSeconds: 300,
};

// Simulate the ft_transfer call args encoded as base64
function makeTransferArgs(receiverId: string, amount: string, memo: string): string {
  return Buffer.from(JSON.stringify({ receiver_id: receiverId, amount, memo })).toString("base64");
}

// Mock tx result that represents a successful ft_transfer
function makeSuccessTxResult(
  senderId = VALID_SENDER,
  contractId = USDC_MAINNET_ADDRESS,
  receiverId = VALID_MERCHANT,
  amount = "1000000",
  memo = VALID_NONCE,
  blockHash = "BlockHash111111111111111111111111",
) {
  return {
    status: { SuccessValue: "" },
    transaction: {
      signer_id: senderId,
      receiver_id: contractId,
      actions: [
        {
          FunctionCall: {
            method_name: "ft_transfer",
            args: makeTransferArgs(receiverId, amount, memo),
            gas: 30000000000000,
            deposit: "1",
          },
        },
      ],
    },
    transaction_outcome: {
      block_hash: blockHash,
    },
  };
}

// Mock block result (~now, within maxTimeoutSeconds)
function makeBlockResult(offsetSec = 0) {
  const nowNs = BigInt(Math.floor(Date.now() / 1000) + offsetSec) * 1_000_000_000n;
  return { header: { timestamp: nowNs.toString() } };
}

// ---- setup ------------------------------------------------------------------

let signer: FacilitatorNearSigner;
let createNearProvider: ReturnType<typeof vi.fn>;

beforeEach(() => {
  signer = { accountId: FACILITATOR_ACCOUNT };

  // Mock createNearProvider so facilitator never makes real HTTP calls
  createNearProvider = vi.fn();
  vi.mock("../../src/utils", async importOriginal => {
    const orig = await importOriginal<typeof import("../../src/utils")>();
    return {
      ...orig,
      createNearProvider: (...args: unknown[]) => createNearProvider(...args),
    };
  });
});

// ---- tests ------------------------------------------------------------------

describe("ExactNearScheme (facilitator)", () => {
  describe("constructor / metadata", () => {
    it("has scheme 'exact'", () => {
      const f = new ExactNearScheme(signer);
      expect(f.scheme).toBe("exact");
    });

    it("has caipFamily 'near:*'", () => {
      const f = new ExactNearScheme(signer);
      expect(f.caipFamily).toBe("near:*");
    });

    it("getSigners returns facilitator accountId", () => {
      const f = new ExactNearScheme(signer);
      expect(f.getSigners(NEAR_MAINNET_CAIP2)).toEqual([FACILITATOR_ACCOUNT]);
    });

    it("getExtra returns undefined (client pays gas)", () => {
      const f = new ExactNearScheme(signer);
      expect(f.getExtra(NEAR_MAINNET_CAIP2)).toBeUndefined();
    });
  });

  describe("verify — payload structure checks (no RPC needed)", () => {
    const f = new ExactNearScheme({ accountId: FACILITATOR_ACCOUNT });

    it("rejects wrong scheme in payload", async () => {
      const p = makeValidPayload();
      p.accepted.scheme = "wrong";
      const r = await f.verify(p, VALID_REQUIREMENTS);
      expect(r.isValid).toBe(false);
      expect(r.invalidReason).toBe("unsupported_scheme");
    });

    it("rejects wrong scheme in requirements", async () => {
      const p = makeValidPayload();
      const req = { ...VALID_REQUIREMENTS, scheme: "wrong" };
      const r = await f.verify(p, req as never);
      expect(r.isValid).toBe(false);
      expect(r.invalidReason).toBe("unsupported_scheme");
    });

    it("rejects network mismatch", async () => {
      const p = makeValidPayload();
      p.accepted.network = NEAR_TESTNET_CAIP2;
      const r = await f.verify(p, VALID_REQUIREMENTS);
      expect(r.isValid).toBe(false);
      expect(r.invalidReason).toBe("network_mismatch");
    });

    it("rejects missing transactionHash", async () => {
      const p = makeValidPayload({ transactionHash: undefined as never });
      const r = await f.verify(p, VALID_REQUIREMENTS);
      expect(r.isValid).toBe(false);
      expect(r.invalidReason).toBe("invalid_near_payload_missing_fields");
    });

    it("rejects missing senderId", async () => {
      const p = makeValidPayload({ senderId: undefined as never });
      const r = await f.verify(p, VALID_REQUIREMENTS);
      expect(r.isValid).toBe(false);
      expect(r.invalidReason).toBe("invalid_near_payload_missing_fields");
    });

    it("rejects missing nonce", async () => {
      const p = makeValidPayload({ nonce: undefined as never });
      const r = await f.verify(p, VALID_REQUIREMENTS);
      expect(r.isValid).toBe(false);
      expect(r.invalidReason).toBe("invalid_near_payload_missing_fields");
    });

    it("rejects invalid transaction hash format", async () => {
      const p = makeValidPayload({ transactionHash: "not-a-valid-hash!!" });
      const r = await f.verify(p, VALID_REQUIREMENTS);
      expect(r.isValid).toBe(false);
      expect(r.invalidReason).toBe("invalid_near_payload_transaction_hash");
    });

    it("rejects invalid sender ID", async () => {
      const p = makeValidPayload({ senderId: "INVALID ACCOUNT ID" });
      const r = await f.verify(p, VALID_REQUIREMENTS);
      expect(r.isValid).toBe(false);
      expect(r.invalidReason).toBe("invalid_near_payload_sender_id");
    });

    it("rejects nonce that is too short", async () => {
      const p = makeValidPayload({ nonce: "abc" }); // should be 32 hex chars
      const r = await f.verify(p, VALID_REQUIREMENTS);
      expect(r.isValid).toBe(false);
      expect(r.invalidReason).toBe("invalid_near_payload_nonce");
    });

    it("rejects nonce with non-hex characters", async () => {
      const p = makeValidPayload({ nonce: "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ" }); // uppercase, not hex
      const r = await f.verify(p, VALID_REQUIREMENTS);
      expect(r.isValid).toBe(false);
      expect(r.invalidReason).toBe("invalid_near_payload_nonce");
    });
  });

  describe("verify — RPC-dependent checks (mocked)", () => {
    it("rejects when RPC call throws (tx not found)", async () => {
      const provider = { txStatus: vi.fn().mockRejectedValue(new Error("not found")) };
      createNearProvider.mockReturnValue(provider);
      const f = new ExactNearScheme(signer);

      const r = await f.verify(makeValidPayload(), VALID_REQUIREMENTS);
      expect(r.isValid).toBe(false);
      expect(r.invalidReason).toBe("transaction_not_found");
    });

    it("rejects when transaction status is Failure", async () => {
      const provider = {
        txStatus: vi.fn().mockResolvedValue({ ...makeSuccessTxResult(), status: { Failure: {} } }),
        block: vi.fn().mockResolvedValue(makeBlockResult()),
      };
      createNearProvider.mockReturnValue(provider);
      const f = new ExactNearScheme(signer);

      const r = await f.verify(makeValidPayload(), VALID_REQUIREMENTS);
      expect(r.isValid).toBe(false);
      expect(r.invalidReason).toBe("transaction_failed_or_pending");
    });

    it("rejects when signer_id does not match senderId", async () => {
      const tx = makeSuccessTxResult("other-account.near");
      const provider = {
        txStatus: vi.fn().mockResolvedValue(tx),
        block: vi.fn().mockResolvedValue(makeBlockResult()),
      };
      createNearProvider.mockReturnValue(provider);
      const f = new ExactNearScheme(signer);

      const r = await f.verify(makeValidPayload(), VALID_REQUIREMENTS);
      expect(r.isValid).toBe(false);
      expect(r.invalidReason).toBe("signer_mismatch");
    });

    it("rejects when receiver_id (token contract) does not match requirements.asset", async () => {
      const tx = makeSuccessTxResult(VALID_SENDER, "wrong-token.near");
      const provider = {
        txStatus: vi.fn().mockResolvedValue(tx),
        block: vi.fn().mockResolvedValue(makeBlockResult()),
      };
      createNearProvider.mockReturnValue(provider);
      const f = new ExactNearScheme(signer);

      const r = await f.verify(makeValidPayload(), VALID_REQUIREMENTS);
      expect(r.isValid).toBe(false);
      expect(r.invalidReason).toBe("token_contract_mismatch");
    });

    it("rejects when recipient (receiver_id in args) does not match payTo", async () => {
      const tx = makeSuccessTxResult(VALID_SENDER, USDC_MAINNET_ADDRESS, "attacker.near");
      const provider = {
        txStatus: vi.fn().mockResolvedValue(tx),
        block: vi.fn().mockResolvedValue(makeBlockResult()),
      };
      createNearProvider.mockReturnValue(provider);
      const f = new ExactNearScheme(signer);

      const r = await f.verify(makeValidPayload(), VALID_REQUIREMENTS);
      expect(r.isValid).toBe(false);
      expect(r.invalidReason).toBe("invalid_near_payload_recipient_mismatch");
    });

    it("rejects when amount in args does not match requirements.amount", async () => {
      const tx = makeSuccessTxResult(VALID_SENDER, USDC_MAINNET_ADDRESS, VALID_MERCHANT, "1"); // 1 unit, not 1000000
      const provider = {
        txStatus: vi.fn().mockResolvedValue(tx),
        block: vi.fn().mockResolvedValue(makeBlockResult()),
      };
      createNearProvider.mockReturnValue(provider);
      const f = new ExactNearScheme(signer);

      const r = await f.verify(makeValidPayload(), VALID_REQUIREMENTS);
      expect(r.isValid).toBe(false);
      expect(r.invalidReason).toBe("invalid_near_payload_amount_mismatch");
    });

    it("rejects when memo (nonce) in args does not match payload nonce", async () => {
      const tx = makeSuccessTxResult(
        VALID_SENDER,
        USDC_MAINNET_ADDRESS,
        VALID_MERCHANT,
        "1000000",
        "different-nonce-0000000000000000",
      );
      const provider = {
        txStatus: vi.fn().mockResolvedValue(tx),
        block: vi.fn().mockResolvedValue(makeBlockResult()),
      };
      createNearProvider.mockReturnValue(provider);
      const f = new ExactNearScheme(signer);

      const r = await f.verify(makeValidPayload(), VALID_REQUIREMENTS);
      expect(r.isValid).toBe(false);
      expect(r.invalidReason).toBe("invalid_near_payload_nonce_mismatch");
    });

    it("rejects when transaction is expired (block too old)", async () => {
      const tx = makeSuccessTxResult();
      const expiredBlock = {
        header: {
          timestamp: (
            BigInt(Math.floor(Date.now() / 1000) - 600) * 1_000_000_000n
          ).toString(), // 10 min ago
        },
      };
      const provider = {
        txStatus: vi.fn().mockResolvedValue(tx),
        block: vi.fn().mockResolvedValue(expiredBlock),
      };
      createNearProvider.mockReturnValue(provider);
      const f = new ExactNearScheme(signer);

      const r = await f.verify(makeValidPayload(), VALID_REQUIREMENTS); // maxTimeoutSeconds=300
      expect(r.isValid).toBe(false);
      expect(r.invalidReason).toBe("transaction_expired");
    });

    it("accepts a valid payment", async () => {
      const tx = makeSuccessTxResult();
      const provider = {
        txStatus: vi.fn().mockResolvedValue(tx),
        block: vi.fn().mockResolvedValue(makeBlockResult()),
      };
      createNearProvider.mockReturnValue(provider);
      const f = new ExactNearScheme(signer);

      const r = await f.verify(makeValidPayload(), VALID_REQUIREMENTS);
      expect(r.isValid).toBe(true);
      expect(r.payer).toBe(VALID_SENDER);
    });
  });

  describe("settle", () => {
    it("returns success with tx hash on valid payment", async () => {
      const tx = makeSuccessTxResult();
      const provider = {
        txStatus: vi.fn().mockResolvedValue(tx),
        block: vi.fn().mockResolvedValue(makeBlockResult()),
      };
      createNearProvider.mockReturnValue(provider);
      const f = new ExactNearScheme(signer);

      const r = await f.settle(makeValidPayload(), VALID_REQUIREMENTS);
      expect(r.success).toBe(true);
      expect(r.transaction).toBe(VALID_TX_HASH);
      expect(r.payer).toBe(VALID_SENDER);
    });

    it("returns failure when verify fails", async () => {
      const provider = {
        txStatus: vi.fn().mockRejectedValue(new Error("not found")),
      };
      createNearProvider.mockReturnValue(provider);
      const f = new ExactNearScheme(signer);

      const r = await f.settle(makeValidPayload(), VALID_REQUIREMENTS);
      expect(r.success).toBe(false);
      expect(r.errorReason).toBe("transaction_not_found");
    });

    it("rejects duplicate settlement of the same tx hash", async () => {
      const tx = makeSuccessTxResult();
      const provider = {
        txStatus: vi.fn().mockResolvedValue(tx),
        block: vi.fn().mockResolvedValue(makeBlockResult()),
      };
      createNearProvider.mockReturnValue(provider);
      const f = new ExactNearScheme(signer);

      const r1 = await f.settle(makeValidPayload(), VALID_REQUIREMENTS);
      expect(r1.success).toBe(true);

      const r2 = await f.settle(makeValidPayload(), VALID_REQUIREMENTS);
      expect(r2.success).toBe(false);
      expect(r2.errorReason).toBe("duplicate_settlement");
    });

    it("allows two different tx hashes to settle independently", async () => {
      const tx = makeSuccessTxResult();
      const provider = {
        txStatus: vi.fn().mockResolvedValue(tx),
        block: vi.fn().mockResolvedValue(makeBlockResult()),
      };
      createNearProvider.mockReturnValue(provider);
      const sharedCache = new SettlementCache();
      const f = new ExactNearScheme(signer, sharedCache);

      const p1 = makeValidPayload({ transactionHash: "Tx1111111111111111111111111111111111111111111" });
      const p2 = makeValidPayload({ transactionHash: "Tx2222222222222222222222222222222222222222222" });

      const r1 = await f.settle(p1, VALID_REQUIREMENTS);
      const r2 = await f.settle(p2, VALID_REQUIREMENTS);

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
    });
  });
});
