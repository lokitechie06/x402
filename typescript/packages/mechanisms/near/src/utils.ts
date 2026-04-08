import { providers } from "near-api-js";
import {
  NEAR_MAINNET_CAIP2,
  NEAR_MAINNET_RPC_URL,
  NEAR_TESTNET_CAIP2,
  NEAR_TESTNET_RPC_URL,
  USDC_MAINNET_ADDRESS,
  USDC_TESTNET_ADDRESS,
} from "./constants";

/**
 * Get the NEAR RPC URL for a given CAIP-2 network identifier.
 *
 * @param network - CAIP-2 network identifier (e.g. "near:mainnet")
 * @returns RPC URL string
 * @throws If the network is not recognised
 */
export function getRpcUrl(network: string): string {
  switch (network) {
    case NEAR_MAINNET_CAIP2:
      return NEAR_MAINNET_RPC_URL;
    case NEAR_TESTNET_CAIP2:
      return NEAR_TESTNET_RPC_URL;
    default:
      throw new Error(`Unsupported NEAR network: ${network}`);
  }
}

/**
 * Get the NEAR network ID (e.g. "mainnet", "testnet") from a CAIP-2 identifier.
 *
 * @param network - CAIP-2 network identifier
 * @returns NEAR network ID string
 */
export function getNetworkId(network: string): string {
  const parts = network.split(":");
  if (parts.length !== 2 || parts[0] !== "near") {
    throw new Error(`Invalid NEAR CAIP-2 network identifier: ${network}`);
  }
  return parts[1];
}

/**
 * Get the default USDC contract address for a given NEAR network.
 *
 * @param network - CAIP-2 network identifier
 * @returns USDC NEP-141 contract account ID
 */
export function getUsdcAddress(network: string): string {
  switch (network) {
    case NEAR_MAINNET_CAIP2:
      return USDC_MAINNET_ADDRESS;
    case NEAR_TESTNET_CAIP2:
      return USDC_TESTNET_ADDRESS;
    default:
      throw new Error(`No default USDC address for NEAR network: ${network}`);
  }
}

/**
 * Create a NEAR JSON-RPC provider for a given network.
 *
 * @param network - CAIP-2 network identifier or explicit RPC URL
 * @param rpcUrl - Optional override RPC URL
 * @returns near-api-js JsonRpcProvider
 */
export function createNearProvider(
  network: string,
  rpcUrl?: string,
): providers.JsonRpcProvider {
  const url = rpcUrl ?? getRpcUrl(network);
  return new providers.JsonRpcProvider({ url });
}

/**
 * Convert a decimal USD amount to USDC token units (6 decimals).
 *
 * @param amount - Decimal amount (e.g. 1.5 for $1.50)
 * @returns Token amount string in smallest units (e.g. "1500000")
 */
export function convertToUsdcUnits(amount: number): string {
  const units = Math.round(amount * 1_000_000);
  return units.toString();
}

/**
 * Generate a cryptographically random 16-byte nonce as a hex string.
 *
 * @returns 32-character hex string
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
