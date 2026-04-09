import type { x402ResourceServer } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { ExactNearScheme } from "./scheme";

/**
 * Configuration options for registering NEAR schemes to an x402ResourceServer
 */
export interface NearResourceServerConfig {
  /**
   * Optional specific networks to register.
   * Defaults to registering a wildcard "near:*" pattern.
   */
  networks?: Network[];
}

/**
 * Register NEAR payment schemes to an existing x402ResourceServer instance.
 *
 * @param server - The x402ResourceServer instance to register schemes to
 * @param config - Configuration for NEAR resource server registration
 * @returns The server instance for chaining
 *
 * @example
 * ```ts
 * import { x402ResourceServer } from "@x402/core/server";
 * import { registerExactNearScheme } from "@x402/near/exact/server";
 *
 * const server = new x402ResourceServer({ facilitatorUrl: "https://facilitator.example.com" });
 * registerExactNearScheme(server);
 * ```
 */
export function registerExactNearScheme(
  server: x402ResourceServer,
  config: NearResourceServerConfig = {},
): x402ResourceServer {
  const scheme = new ExactNearScheme();

  if (config.networks && config.networks.length > 0) {
    for (const network of config.networks) {
      server.register(network, scheme);
    }
  } else {
    server.register("near:*", scheme);
  }

  return server;
}
