/**
 * @module @x402/near - x402 Payment Protocol NEAR Implementation
 *
 * This module provides the NEAR-specific implementation of the x402 payment protocol
 * using the NEP-141 fungible token standard (USDC) on NEAR Protocol.
 *
 * @example Client usage
 * ```ts
 * import { toClientNearSigner, registerExactNearScheme } from "@x402/near";
 * import { x402Client } from "@x402/core/client";
 *
 * const signer = toClientNearSigner("alice.near", "ed25519:3VV...", "near:mainnet");
 * const client = new x402Client();
 * registerExactNearScheme(client, { signer });
 * ```
 *
 * @example Facilitator usage
 * ```ts
 * import { toFacilitatorNearSigner } from "@x402/near";
 * import { registerExactNearScheme } from "@x402/near/exact/facilitator";
 * import { x402Facilitator } from "@x402/core/facilitator";
 *
 * const signer = toFacilitatorNearSigner("facilitator.near");
 * const facilitator = new x402Facilitator();
 * registerExactNearScheme(facilitator, { signer, networks: "near:mainnet" });
 * ```
 */

// Re-export exact scheme (most common use case)
export { ExactNearScheme } from "./exact";

// Signer utilities and types
export { toClientNearSigner, toFacilitatorNearSigner } from "./signer";
export type { ClientNearSigner, FacilitatorNearSigner } from "./signer";

// Payload types
export type { ExactNearPayloadV2, FtTransferArgs } from "./types";

// Settlement cache (shared across facilitator instances)
export { SettlementCache } from "./settlement-cache";

// Constants
export * from "./constants";

// Utilities
export * from "./utils";

// Register helpers
export { registerExactNearScheme as registerExactNearClientScheme } from "./exact/client/register";
export { registerExactNearScheme as registerExactNearServerScheme } from "./exact/server/register";
export { registerExactNearScheme as registerExactNearFacilitatorScheme } from "./exact/facilitator/register";
