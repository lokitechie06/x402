/**
 * NEAR RPC endpoints
 */
export const NEAR_MAINNET_RPC_URL = "https://rpc.mainnet.near.org";
export const NEAR_TESTNET_RPC_URL = "https://rpc.testnet.near.org";

/**
 * USDC NEP-141 token contract account IDs
 * Mainnet: Native USDC bridged via Circle (Wormhole)
 * Testnet: Fake USDC for testing purposes
 */
export const USDC_MAINNET_ADDRESS =
  "17208628f84f5d6ad33f0da3bbbeb27ffed7bc96e875c955409ce0a82620f408";
export const USDC_TESTNET_ADDRESS = "usdc.fakes.testnet";

/**
 * CAIP-2 network identifiers for NEAR
 */
export const NEAR_MAINNET_CAIP2 = "near:mainnet";
export const NEAR_TESTNET_CAIP2 = "near:testnet";

/**
 * Gas limit for ft_transfer calls (in gas units)
 * 30 TGas is standard for NEP-141 ft_transfer
 */
export const FT_TRANSFER_GAS = "30000000000000";

/**
 * Deposit required by NEP-141 security model for ft_transfer (1 yoctoNEAR)
 * This prevents potential storage denial-of-service attacks.
 */
export const FT_TRANSFER_DEPOSIT = "1";

/**
 * How long to hold transaction hashes in the duplicate settlement cache (ms).
 * Should be at least 2x the maxTimeoutSeconds to prevent replay after expiry.
 */
export const SETTLEMENT_TTL_MS = 600_000; // 10 minutes

/**
 * NEAR account ID validation regex
 * Accounts can be implicit (64 hex chars) or named (e.g. alice.near, alice.testnet)
 */
export const NEAR_ACCOUNT_ID_REGEX =
  /^(([a-z\d]([a-z\d-_]*[a-z\d])?\.)+[a-z\d]([a-z\d-_]*[a-z\d])?|[a-f\d]{64})$/;

/**
 * NEAR transaction hash validation regex (base58, 43-44 characters)
 */
export const NEAR_TX_HASH_REGEX = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

/**
 * Nonce hex string validation regex (exactly 32 hex characters = 16 bytes)
 */
export const NONCE_HEX_REGEX = /^[0-9a-f]{32}$/;
