import type { providers } from "near-api-js";
import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import {
  NEAR_ACCOUNT_ID_REGEX,
  NEAR_TX_HASH_REGEX,
  NONCE_HEX_REGEX,
} from "../../constants";
import { SettlementCache } from "../../settlement-cache";
import type { FacilitatorNearSigner } from "../../signer";
import type { ExactNearPayloadV2, FtTransferArgs } from "../../types";
import { createNearProvider } from "../../utils";

/**
 * NEAR facilitator implementation for the Exact payment scheme.
 *
 * The NEAR exact scheme uses a client-settles model: the client submits the
 * ft_transfer transaction, and the facilitator verifies it on-chain.
 * Settlement is confirmation-only — no new transactions are submitted.
 */
export class ExactNearScheme implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "near:*";

  private readonly settlementCache: SettlementCache;

  /**
   * @param signer - Facilitator identity and optional RPC config
   * @param settlementCache - Optional shared settlement cache
   */
  constructor(
    private readonly signer: FacilitatorNearSigner,
    settlementCache?: SettlementCache,
  ) {
    this.settlementCache = settlementCache ?? new SettlementCache();
  }

  /**
   * Get mechanism-specific extra data.
   * NEAR clients pay their own gas, so no feePayer is needed.
   */
  getExtra(_network: string): Record<string, unknown> | undefined {
    return undefined;
  }

  /**
   * Get the facilitator's NEAR account ID for identification.
   */
  getSigners(_network: string): string[] {
    return [this.signer.accountId];
  }

  /**
   * Verify a NEAR payment by looking up the transaction on-chain.
   *
   * @param payload - The payment payload containing the tx hash
   * @param requirements - The expected payment requirements
   * @returns VerifyResponse indicating whether the payment is valid
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    if (payload.accepted.scheme !== "exact" || requirements.scheme !== "exact") {
      return { isValid: false, invalidReason: "unsupported_scheme", payer: "" };
    }

    if (payload.accepted.network !== requirements.network) {
      return { isValid: false, invalidReason: "network_mismatch", payer: "" };
    }

    const nearPayload = payload.payload as ExactNearPayloadV2;

    // Validate payload structure
    const structureError = this.validatePayloadStructure(nearPayload);
    if (structureError) {
      return { isValid: false, invalidReason: structureError, payer: "" };
    }

    const payer = nearPayload.senderId;

    // Fetch transaction from NEAR RPC
    let txResult: Awaited<ReturnType<providers.JsonRpcProvider["txStatus"]>>;
    try {
      const provider = createNearProvider(
        requirements.network,
        this.signer.rpcUrls?.[requirements.network],
      );
      txResult = await provider.txStatus(nearPayload.transactionHash, nearPayload.senderId, "FINAL");
    } catch {
      return {
        isValid: false,
        invalidReason: "transaction_not_found",
        payer,
      };
    }

    // Check top-level transaction outcome
    if (
      !txResult.status ||
      typeof txResult.status !== "object" ||
      !("SuccessValue" in txResult.status)
    ) {
      return {
        isValid: false,
        invalidReason: "transaction_failed_or_pending",
        payer,
      };
    }

    // Verify signer matches senderId
    if (txResult.transaction.signer_id !== nearPayload.senderId) {
      return {
        isValid: false,
        invalidReason: "signer_mismatch",
        payer,
      };
    }

    // Verify the transaction was sent to the correct token contract
    if (txResult.transaction.receiver_id !== requirements.asset) {
      return {
        isValid: false,
        invalidReason: "token_contract_mismatch",
        payer,
      };
    }

    // Find and validate the FunctionCall action
    const actionError = this.validateFunctionCallAction(
      txResult.transaction.actions,
      requirements,
      nearPayload.nonce,
      payer,
    );
    if (actionError) {
      return { isValid: false, invalidReason: actionError, payer };
    }

    // Validate transaction age against maxTimeoutSeconds
    if (requirements.maxTimeoutSeconds) {
      const ageError = await this.validateTransactionAge(
        txResult.transaction_outcome.block_hash,
        requirements.network,
        requirements.maxTimeoutSeconds,
        this.signer.rpcUrls?.[requirements.network],
      );
      if (ageError) {
        return { isValid: false, invalidReason: ageError, payer };
      }
    }

    return { isValid: true, invalidReason: undefined, payer };
  }

  /**
   * Settle a NEAR payment — re-verifies and returns the existing transaction hash.
   *
   * Since the client already submitted the transaction, settlement is confirmation-only.
   *
   * @param payload - The payment payload
   * @param requirements - The payment requirements
   * @returns SettleResponse with the transaction hash
   */
  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const nearPayload = payload.payload as ExactNearPayloadV2;
    const txHash = nearPayload?.transactionHash ?? "";

    const verified = await this.verify(payload, requirements);
    if (!verified.isValid) {
      return {
        success: false,
        network: payload.accepted.network,
        transaction: "",
        errorReason: verified.invalidReason ?? "verification_failed",
        payer: verified.payer || "",
      };
    }

    // Duplicate settlement check: reject if this tx hash was already settled
    if (this.settlementCache.isDuplicate(txHash)) {
      return {
        success: false,
        network: payload.accepted.network,
        transaction: "",
        errorReason: "duplicate_settlement",
        payer: verified.payer || "",
      };
    }

    return {
      success: true,
      transaction: txHash,
      network: payload.accepted.network,
      payer: verified.payer,
    };
  }

  // --- Private helpers ---

  private validatePayloadStructure(nearPayload: ExactNearPayloadV2): string | null {
    if (!nearPayload?.transactionHash || !nearPayload.senderId || !nearPayload.nonce) {
      return "invalid_near_payload_missing_fields";
    }
    if (!NEAR_TX_HASH_REGEX.test(nearPayload.transactionHash)) {
      return "invalid_near_payload_transaction_hash";
    }
    if (!NEAR_ACCOUNT_ID_REGEX.test(nearPayload.senderId)) {
      return "invalid_near_payload_sender_id";
    }
    if (!NONCE_HEX_REGEX.test(nearPayload.nonce)) {
      return "invalid_near_payload_nonce";
    }
    return null;
  }

  private validateFunctionCallAction(
    actions: Array<Record<string, unknown>>,
    requirements: PaymentRequirements,
    nonce: string,
    _payer: string,
  ): string | null {
    const functionCallActions = actions.filter(
      (a): a is { FunctionCall: Record<string, unknown> } => "FunctionCall" in a,
    );

    if (functionCallActions.length !== 1) {
      return "invalid_near_payload_unexpected_actions";
    }

    const fc = functionCallActions[0].FunctionCall;

    if (fc.method_name !== "ft_transfer") {
      return "invalid_near_payload_wrong_method";
    }

    // Decode base64-encoded args
    let args: FtTransferArgs;
    try {
      const decoded = Buffer.from(fc.args as string, "base64").toString("utf8");
      args = JSON.parse(decoded) as FtTransferArgs;
    } catch {
      return "invalid_near_payload_args_decode_failed";
    }

    if (args.receiver_id !== requirements.payTo) {
      return "invalid_near_payload_recipient_mismatch";
    }

    if (args.amount !== requirements.amount) {
      return "invalid_near_payload_amount_mismatch";
    }

    if (args.memo !== nonce) {
      return "invalid_near_payload_nonce_mismatch";
    }

    return null;
  }

  private async validateTransactionAge(
    blockHash: string,
    network: string,
    maxTimeoutSeconds: number,
    rpcUrl?: string,
  ): Promise<string | null> {
    try {
      const provider = createNearProvider(network, rpcUrl);
      // Fetch block details to get the timestamp
      const block = await provider.block({ blockId: blockHash });
      const blockTimestampNs = BigInt(block.header.timestamp);
      const blockTimestampSec = Number(blockTimestampNs / 1_000_000_000n);
      const nowSec = Math.floor(Date.now() / 1000);

      if (nowSec - blockTimestampSec > maxTimeoutSeconds) {
        return "transaction_expired";
      }
    } catch {
      return "block_fetch_failed";
    }
    return null;
  }
}
