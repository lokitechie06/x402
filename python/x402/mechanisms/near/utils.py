"""NEAR mechanism utility functions."""

from __future__ import annotations

import re
import time

import requests

from .constants import (
    DEFAULT_DECIMALS,
    NEAR_ACCOUNT_ID_REGEX,
    NEAR_MAINNET_CAIP2,
    NEAR_MAINNET_RPC_URL,
    NEAR_TESTNET_CAIP2,
    NEAR_TESTNET_RPC_URL,
    NONCE_HEX_REGEX,
    NEAR_TX_HASH_REGEX,
    USDC_MAINNET_ADDRESS,
    USDC_TESTNET_ADDRESS,
)


def get_rpc_url(network: str) -> str:
    """Return the default NEAR RPC URL for a CAIP-2 network identifier.

    Args:
        network: CAIP-2 network identifier (e.g. 'near:mainnet').

    Returns:
        RPC URL string.

    Raises:
        ValueError: If the network is not recognised.
    """
    if network == NEAR_MAINNET_CAIP2:
        return NEAR_MAINNET_RPC_URL
    if network == NEAR_TESTNET_CAIP2:
        return NEAR_TESTNET_RPC_URL
    raise ValueError(f"Unsupported NEAR network: {network}")


def get_network_id(network: str) -> str:
    """Extract the NEAR network ID from a CAIP-2 identifier.

    Args:
        network: CAIP-2 network identifier (e.g. 'near:mainnet').

    Returns:
        NEAR network ID string (e.g. 'mainnet').

    Raises:
        ValueError: If the identifier is not a valid NEAR CAIP-2 string.
    """
    parts = network.split(":")
    if len(parts) != 2 or parts[0] != "near":
        raise ValueError(f"Invalid NEAR CAIP-2 network identifier: {network}")
    return parts[1]


def get_usdc_address(network: str) -> str:
    """Return the default USDC contract account ID for a NEAR network.

    Args:
        network: CAIP-2 network identifier.

    Returns:
        USDC NEP-141 contract account ID.

    Raises:
        ValueError: If there is no default USDC address for the network.
    """
    if network == NEAR_MAINNET_CAIP2:
        return USDC_MAINNET_ADDRESS
    if network == NEAR_TESTNET_CAIP2:
        return USDC_TESTNET_ADDRESS
    raise ValueError(f"No default USDC address for NEAR network: {network}")


def convert_to_usdc_units(amount: float) -> str:
    """Convert a decimal USD amount to USDC token units (6 decimals).

    Args:
        amount: Decimal amount (e.g. 1.5 for $1.50).

    Returns:
        Token amount string in smallest units (e.g. '1500000').
    """
    return str(round(amount * (10 ** DEFAULT_DECIMALS)))


def parse_money_to_decimal(money: str | float) -> float:
    """Parse a money string or number to a decimal float.

    Handles formats like '$1.50', '1.50', 1.50.

    Args:
        money: The money value to parse.

    Returns:
        Decimal float value.

    Raises:
        ValueError: If the format is invalid.
    """
    if isinstance(money, (int, float)):
        return float(money)
    cleaned = str(money).lstrip("$").strip()
    try:
        return float(cleaned)
    except ValueError as e:
        raise ValueError(f"Invalid money format: {money}") from e


def validate_near_account_id(account_id: str) -> bool:
    """Check whether a string is a valid NEAR account ID.

    Args:
        account_id: String to validate.

    Returns:
        True if valid, False otherwise.
    """
    return bool(re.match(NEAR_ACCOUNT_ID_REGEX, account_id))


def validate_near_tx_hash(tx_hash: str) -> bool:
    """Check whether a string is a valid base58 NEAR transaction hash.

    Args:
        tx_hash: String to validate.

    Returns:
        True if valid, False otherwise.
    """
    return bool(re.match(NEAR_TX_HASH_REGEX, tx_hash))


def validate_nonce(nonce: str) -> bool:
    """Check whether a nonce is a valid 32-character hex string (16 bytes).

    Args:
        nonce: String to validate.

    Returns:
        True if valid, False otherwise.
    """
    return bool(re.match(NONCE_HEX_REGEX, nonce))


def near_rpc(
    url: str,
    method: str,
    params: object,
    timeout: int = 30,
) -> dict:
    """Make a synchronous NEAR JSON-RPC call.

    Args:
        url: NEAR RPC URL.
        method: JSON-RPC method name.
        params: Method parameters.
        timeout: Request timeout in seconds.

    Returns:
        The 'result' field of the JSON-RPC response.

    Raises:
        RuntimeError: If the RPC call returns an error or times out.
    """
    payload = {
        "jsonrpc": "2.0",
        "id": "x402",
        "method": method,
        "params": params,
    }
    try:
        resp = requests.post(url, json=payload, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        raise RuntimeError(f"NEAR RPC request failed: {e}") from e

    if "error" in data:
        raise RuntimeError(f"NEAR RPC error: {data['error']}")

    return data.get("result", {})


def get_transaction(rpc_url: str, tx_hash: str, sender_id: str) -> dict:
    """Fetch a NEAR transaction by hash and sender.

    Args:
        rpc_url: NEAR RPC URL.
        tx_hash: Base58 transaction hash.
        sender_id: NEAR account ID of the sender.

    Returns:
        Transaction result dict from NEAR RPC.

    Raises:
        RuntimeError: If the transaction cannot be fetched.
    """
    return near_rpc(rpc_url, "tx", [tx_hash, sender_id, "FINAL"])


def get_block(rpc_url: str, block_hash: str) -> dict:
    """Fetch a NEAR block by hash.

    Args:
        rpc_url: NEAR RPC URL.
        block_hash: Base58 block hash.

    Returns:
        Block dict from NEAR RPC.

    Raises:
        RuntimeError: If the block cannot be fetched.
    """
    return near_rpc(rpc_url, "block", {"block_id": block_hash})


def get_block_timestamp_seconds(block: dict) -> float:
    """Extract the block timestamp in Unix seconds from a NEAR block dict.

    Args:
        block: NEAR block dict from JSON-RPC.

    Returns:
        Timestamp in seconds (float).
    """
    timestamp_ns = int(block["header"]["timestamp"])
    return timestamp_ns / 1_000_000_000
