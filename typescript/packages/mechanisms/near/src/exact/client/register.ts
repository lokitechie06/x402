import type { x402Client } from "@x402/core/client";
import type { Network } from "@x402/core/types";
import type { ClientNearSigner } from "../../signer";
import { ExactNearScheme } from "./scheme";

/**
 * Configuration options for registering NEAR schemes to an x402Client
 */
export interface NearClientConfig {
  /**
   * The NEAR signer for creating and submitting ft_transfer transactions
   */
  signer: ClientNearSigner;

  /**
   * Optional specific networks to register.
   * Defaults to registering a wildcard "near:*" pattern.
   */
  networks?: Network[];
}

/**
 * Register NEAR payment schemes to an existing x402Client instance.
 *
 * @param client - The x402Client instance to register schemes to
 * @param config - Configuration for NEAR client registration
 * @returns The client instance for chaining
 *
 * @example
 * ```ts
 * import { x402Client } from "@x402/core/client";
 * import { toClientNearSigner, registerExactNearScheme } from "@x402/near/exact/client";
 *
 * const signer = toClientNearSigner("alice.near", "ed25519:3VV...", "near:mainnet");
 * const client = new x402Client();
 * registerExactNearScheme(client, { signer });
 * ```
 */
export function registerExactNearScheme(
  client: x402Client,
  config: NearClientConfig,
): x402Client {
  const scheme = new ExactNearScheme(config.signer);

  if (config.networks && config.networks.length > 0) {
    for (const network of config.networks) {
      client.register(network, scheme);
    }
  } else {
    client.register("near:*", scheme);
  }

  return client;
}
