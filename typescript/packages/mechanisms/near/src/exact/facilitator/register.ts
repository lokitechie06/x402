import type { x402Facilitator } from "@x402/core/facilitator";
import type { Network } from "@x402/core/types";
import { SettlementCache } from "../../settlement-cache";
import type { FacilitatorNearSigner } from "../../signer";
import { ExactNearScheme } from "./scheme";

/**
 * Configuration options for registering NEAR schemes to an x402Facilitator
 */
export interface NearFacilitatorConfig {
  /**
   * The NEAR facilitator identity and RPC configuration
   */
  signer: FacilitatorNearSigner;

  /**
   * Network(s) to register. Can be a single network or array of networks.
   * Examples: "near:mainnet", ["near:mainnet", "near:testnet"]
   */
  networks: Network | Network[];
}

/**
 * Register NEAR payment schemes to an existing x402Facilitator instance.
 *
 * @param facilitator - The x402Facilitator instance to register schemes to
 * @param config - Configuration for NEAR facilitator registration
 * @returns The facilitator instance for chaining
 *
 * @example
 * ```ts
 * import { x402Facilitator } from "@x402/core/facilitator";
 * import { toFacilitatorNearSigner, registerExactNearScheme } from "@x402/near/exact/facilitator";
 *
 * const signer = toFacilitatorNearSigner("facilitator.near");
 * const facilitator = new x402Facilitator();
 * registerExactNearScheme(facilitator, {
 *   signer,
 *   networks: "near:mainnet",
 * });
 * ```
 */
export function registerExactNearScheme(
  facilitator: x402Facilitator,
  config: NearFacilitatorConfig,
): x402Facilitator {
  const settlementCache = new SettlementCache();
  const scheme = new ExactNearScheme(config.signer, settlementCache);
  facilitator.register(config.networks, scheme);
  return facilitator;
}
