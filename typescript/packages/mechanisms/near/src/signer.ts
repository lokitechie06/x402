import { connect, KeyPair, keyStores } from "near-api-js";
import {
  FT_TRANSFER_DEPOSIT,
  FT_TRANSFER_GAS,
  NEAR_MAINNET_CAIP2,
  NEAR_TESTNET_CAIP2,
} from "./constants";
import { getNetworkId, getRpcUrl } from "./utils";

/**
 * Client-side signer for NEAR.
 *
 * Because NEAR does not support delegated transfers, the client must sign and
 * submit the ft_transfer transaction themselves. This interface abstracts that
 * operation so the mechanism can be used with any NEAR wallet or key store.
 */
export interface ClientNearSigner {
  /**
   * The NEAR account ID of the payer.
   */
  accountId: string;

  /**
   * Execute an ft_transfer call on a NEP-141 contract and return the tx hash.
   *
   * @param contractId - NEP-141 token contract account ID (e.g. USDC contract)
   * @param receiverId - Recipient NEAR account ID
   * @param amount - Token amount in smallest units as a string
   * @param memo - Nonce string to embed in the transfer memo for replay protection
   * @returns Base58-encoded transaction hash of the submitted transaction
   */
  ftTransfer(
    contractId: string,
    receiverId: string,
    amount: string,
    memo: string,
  ): Promise<string>;
}

/**
 * Facilitator-side configuration for NEAR.
 *
 * In the NEAR exact scheme the facilitator only reads from the chain (no signing).
 * This interface carries the facilitator's NEAR account ID (for identification)
 * and optional per-network RPC overrides.
 */
export interface FacilitatorNearSigner {
  /**
   * The NEAR account ID of the facilitator (used in getSigners()).
   */
  accountId: string;

  /**
   * Optional per-network RPC URL overrides, keyed by CAIP-2 identifier.
   * Falls back to the default public RPC for each network if omitted.
   *
   * @example
   * ```ts
   * rpcUrls: {
   *   "near:mainnet": "https://my-archival-node.example.com",
   * }
   * ```
   */
  rpcUrls?: Partial<Record<string, string>>;
}

/**
 * Create a ClientNearSigner from a raw ed25519 private key string.
 *
 * @param accountId - The NEAR account ID (e.g. "alice.near")
 * @param privateKey - The private key string in "ed25519:BASE58" format
 * @param network - CAIP-2 network identifier
 * @param rpcUrl - Optional custom RPC URL
 * @returns A ClientNearSigner ready to submit ft_transfer transactions
 *
 * @example
 * ```ts
 * const signer = toClientNearSigner(
 *   "alice.near",
 *   "ed25519:3VV...",
 *   "near:mainnet",
 * );
 * ```
 */
export function toClientNearSigner(
  accountId: string,
  privateKey: string,
  network: string,
  rpcUrl?: string,
): ClientNearSigner {
  const networkId = getNetworkId(network);
  const nodeUrl = rpcUrl ?? getRpcUrl(network);

  return {
    accountId,

    ftTransfer: async (
      contractId: string,
      receiverId: string,
      amount: string,
      memo: string,
    ): Promise<string> => {
      const keyStore = new keyStores.InMemoryKeyStore();
      await keyStore.setKey(networkId, accountId, KeyPair.fromString(privateKey));

      const near = await connect({
        networkId,
        keyStore,
        nodeUrl,
      });

      const account = await near.account(accountId);

      const result = await account.functionCall({
        contractId,
        methodName: "ft_transfer",
        args: {
          receiver_id: receiverId,
          amount,
          memo,
        },
        gas: BigInt(FT_TRANSFER_GAS),
        attachedDeposit: BigInt(FT_TRANSFER_DEPOSIT),
      });

      return result.transaction.hash;
    },
  };
}

/**
 * Create a FacilitatorNearSigner from a NEAR account ID.
 *
 * The facilitator does not need a private key — it only reads from the chain.
 *
 * @param accountId - The facilitator's NEAR account ID
 * @param rpcUrls - Optional per-network RPC URL overrides
 * @returns A FacilitatorNearSigner
 *
 * @example
 * ```ts
 * const signer = toFacilitatorNearSigner("facilitator.near");
 *
 * // With custom RPC
 * const signer = toFacilitatorNearSigner("facilitator.near", {
 *   [NEAR_MAINNET_CAIP2]: "https://my-archival-node.example.com",
 * });
 * ```
 */
export function toFacilitatorNearSigner(
  accountId: string,
  rpcUrls?: Partial<Record<string, string>>,
): FacilitatorNearSigner {
  return { accountId, rpcUrls };
}

export { NEAR_MAINNET_CAIP2, NEAR_TESTNET_CAIP2 };
