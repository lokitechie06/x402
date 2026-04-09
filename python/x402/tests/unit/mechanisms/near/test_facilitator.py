"""Tests for NEAR ExactNearScheme facilitator."""

from __future__ import annotations

import base64
import json
import time
from unittest.mock import MagicMock, patch

import pytest

from x402.mechanisms.near import (
    NEAR_MAINNET_CAIP2,
    NEAR_TESTNET_CAIP2,
    USDC_MAINNET_ADDRESS,
    ERR_AMOUNT_MISMATCH,
    ERR_DUPLICATE_SETTLEMENT,
    ERR_INVALID_NONCE,
    ERR_INVALID_PAYLOAD_MISSING_FIELDS,
    ERR_INVALID_SENDER_ID,
    ERR_INVALID_TX_HASH,
    ERR_NETWORK_MISMATCH,
    ERR_NONCE_MISMATCH,
    ERR_RECIPIENT_MISMATCH,
    ERR_SIGNER_MISMATCH,
    ERR_TOKEN_CONTRACT_MISMATCH,
    ERR_TRANSACTION_EXPIRED,
    ERR_TRANSACTION_FAILED,
    ERR_TRANSACTION_NOT_FOUND,
    ERR_UNSUPPORTED_SCHEME,
)
from x402.mechanisms.near.exact.facilitator import ExactNearScheme
from x402.mechanisms.near.settlement_cache import SettlementCache
from x402.schemas import PaymentPayload, PaymentRequirements, ResourceInfo

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

VALID_TX_HASH = "FvV7QXPW2JKhNMBYi5hHbUvEdGpNj7z7fFcKhbVp6W1"
VALID_NONCE = "a3f7c2d891e04b6f00112233445566ff"
VALID_SENDER = "payer.near"
VALID_MERCHANT = "merchant.near"
FACILITATOR_ACCOUNT = "facilitator.near"


class MockFacilitatorSigner:
    def __init__(self, account_id: str = FACILITATOR_ACCOUNT, rpc_url: str | None = None):
        self._account_id = account_id
        self._rpc_url = rpc_url

    @property
    def account_id(self) -> str:
        return self._account_id

    def get_rpc_url(self, network: str) -> str | None:
        return self._rpc_url


def _make_transfer_args(receiver_id: str, amount: str, memo: str) -> str:
    return base64.b64encode(
        json.dumps({"receiver_id": receiver_id, "amount": amount, "memo": memo}).encode()
    ).decode()


def _make_tx_result(
    sender_id: str = VALID_SENDER,
    contract_id: str = USDC_MAINNET_ADDRESS,
    receiver_id: str = VALID_MERCHANT,
    amount: str = "1000000",
    memo: str = VALID_NONCE,
    block_hash: str = "BlockHash111111111111111111111111",
    success: bool = True,
) -> dict:
    status = {"SuccessValue": ""} if success else {"Failure": {}}
    return {
        "status": status,
        "transaction": {
            "signer_id": sender_id,
            "receiver_id": contract_id,
            "actions": [
                {
                    "FunctionCall": {
                        "method_name": "ft_transfer",
                        "args": _make_transfer_args(receiver_id, amount, memo),
                        "gas": 30_000_000_000_000,
                        "deposit": "1",
                    }
                }
            ],
        },
        "transaction_outcome": {"block_hash": block_hash},
    }


def _make_block(offset_sec: float = 0) -> dict:
    ts_ns = int((time.time() + offset_sec) * 1_000_000_000)
    return {"header": {"timestamp": ts_ns}}


def _make_payload(**payload_overrides) -> PaymentPayload:
    inner = {
        "transactionHash": VALID_TX_HASH,
        "senderId": VALID_SENDER,
        "nonce": VALID_NONCE,
        **payload_overrides,
    }
    return PaymentPayload(
        x402_version=2,
        resource=ResourceInfo(url="https://example.com/resource", description="Test", mime_type="application/json"),
        accepted=PaymentRequirements(
            scheme="exact",
            network=NEAR_MAINNET_CAIP2,
            asset=USDC_MAINNET_ADDRESS,
            amount="1000000",
            pay_to=VALID_MERCHANT,
            max_timeout_seconds=300,
        ),
        payload=inner,
    )


VALID_REQUIREMENTS = PaymentRequirements(
    scheme="exact",
    network=NEAR_MAINNET_CAIP2,
    asset=USDC_MAINNET_ADDRESS,
    amount="1000000",
    pay_to=VALID_MERCHANT,
    max_timeout_seconds=300,
)

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestExactNearSchemeMetadata:
    def test_scheme_is_exact(self):
        f = ExactNearScheme(MockFacilitatorSigner())
        assert f.scheme == "exact"

    def test_caip_family(self):
        f = ExactNearScheme(MockFacilitatorSigner())
        assert f.caip_family == "near:*"

    def test_get_signers_returns_account_id(self):
        f = ExactNearScheme(MockFacilitatorSigner())
        assert f.get_signers(NEAR_MAINNET_CAIP2) == [FACILITATOR_ACCOUNT]

    def test_get_extra_returns_none(self):
        f = ExactNearScheme(MockFacilitatorSigner())
        assert f.get_extra(NEAR_MAINNET_CAIP2) is None


class TestVerifyPayloadStructure:
    """Payload validation tests — no RPC calls needed."""

    def setup_method(self):
        self.f = ExactNearScheme(MockFacilitatorSigner())

    def test_rejects_wrong_scheme_in_payload(self):
        p = _make_payload()
        p.accepted.scheme = "wrong"
        r = self.f.verify(p, VALID_REQUIREMENTS)
        assert r.is_valid is False
        assert r.invalid_reason == ERR_UNSUPPORTED_SCHEME

    def test_rejects_network_mismatch(self):
        p = _make_payload()
        p.accepted.network = NEAR_TESTNET_CAIP2
        r = self.f.verify(p, VALID_REQUIREMENTS)
        assert r.is_valid is False
        assert r.invalid_reason == ERR_NETWORK_MISMATCH

    def test_rejects_missing_transaction_hash(self):
        p = _make_payload(transactionHash="")
        r = self.f.verify(p, VALID_REQUIREMENTS)
        assert r.is_valid is False
        assert r.invalid_reason == ERR_INVALID_PAYLOAD_MISSING_FIELDS

    def test_rejects_missing_sender_id(self):
        p = _make_payload(senderId="")
        r = self.f.verify(p, VALID_REQUIREMENTS)
        assert r.is_valid is False
        assert r.invalid_reason == ERR_INVALID_PAYLOAD_MISSING_FIELDS

    def test_rejects_missing_nonce(self):
        p = _make_payload(nonce="")
        r = self.f.verify(p, VALID_REQUIREMENTS)
        assert r.is_valid is False
        assert r.invalid_reason == ERR_INVALID_PAYLOAD_MISSING_FIELDS

    def test_rejects_invalid_tx_hash_format(self):
        p = _make_payload(transactionHash="not-a-valid-hash!!")
        r = self.f.verify(p, VALID_REQUIREMENTS)
        assert r.is_valid is False
        assert r.invalid_reason == ERR_INVALID_TX_HASH

    def test_rejects_invalid_sender_id(self):
        p = _make_payload(senderId="INVALID ACCOUNT ID")
        r = self.f.verify(p, VALID_REQUIREMENTS)
        assert r.is_valid is False
        assert r.invalid_reason == ERR_INVALID_SENDER_ID

    def test_rejects_nonce_too_short(self):
        p = _make_payload(nonce="abc")
        r = self.f.verify(p, VALID_REQUIREMENTS)
        assert r.is_valid is False
        assert r.invalid_reason == ERR_INVALID_NONCE

    def test_rejects_nonce_with_non_hex_chars(self):
        p = _make_payload(nonce="ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ")
        r = self.f.verify(p, VALID_REQUIREMENTS)
        assert r.is_valid is False
        assert r.invalid_reason == ERR_INVALID_NONCE


class TestVerifyRpc:
    """RPC-dependent tests — patched to avoid real network calls."""

    def _make_facilitator(self) -> ExactNearScheme:
        return ExactNearScheme(MockFacilitatorSigner())

    @patch("x402.mechanisms.near.exact.facilitator.get_transaction")
    def test_rejects_when_rpc_throws(self, mock_get_tx):
        mock_get_tx.side_effect = RuntimeError("not found")
        r = self._make_facilitator().verify(_make_payload(), VALID_REQUIREMENTS)
        assert r.is_valid is False
        assert r.invalid_reason == ERR_TRANSACTION_NOT_FOUND

    @patch("x402.mechanisms.near.exact.facilitator.get_block")
    @patch("x402.mechanisms.near.exact.facilitator.get_transaction")
    def test_rejects_failed_transaction(self, mock_get_tx, mock_get_block):
        mock_get_tx.return_value = _make_tx_result(success=False)
        mock_get_block.return_value = _make_block()
        r = self._make_facilitator().verify(_make_payload(), VALID_REQUIREMENTS)
        assert r.is_valid is False
        assert r.invalid_reason == ERR_TRANSACTION_FAILED

    @patch("x402.mechanisms.near.exact.facilitator.get_block")
    @patch("x402.mechanisms.near.exact.facilitator.get_transaction")
    def test_rejects_signer_id_mismatch(self, mock_get_tx, mock_get_block):
        mock_get_tx.return_value = _make_tx_result(sender_id="other.near")
        mock_get_block.return_value = _make_block()
        r = self._make_facilitator().verify(_make_payload(), VALID_REQUIREMENTS)
        assert r.is_valid is False
        assert r.invalid_reason == ERR_SIGNER_MISMATCH

    @patch("x402.mechanisms.near.exact.facilitator.get_block")
    @patch("x402.mechanisms.near.exact.facilitator.get_transaction")
    def test_rejects_wrong_token_contract(self, mock_get_tx, mock_get_block):
        mock_get_tx.return_value = _make_tx_result(contract_id="wrong-token.near")
        mock_get_block.return_value = _make_block()
        r = self._make_facilitator().verify(_make_payload(), VALID_REQUIREMENTS)
        assert r.is_valid is False
        assert r.invalid_reason == ERR_TOKEN_CONTRACT_MISMATCH

    @patch("x402.mechanisms.near.exact.facilitator.get_block")
    @patch("x402.mechanisms.near.exact.facilitator.get_transaction")
    def test_rejects_wrong_recipient(self, mock_get_tx, mock_get_block):
        mock_get_tx.return_value = _make_tx_result(receiver_id="attacker.near")
        mock_get_block.return_value = _make_block()
        r = self._make_facilitator().verify(_make_payload(), VALID_REQUIREMENTS)
        assert r.is_valid is False
        assert r.invalid_reason == ERR_RECIPIENT_MISMATCH

    @patch("x402.mechanisms.near.exact.facilitator.get_block")
    @patch("x402.mechanisms.near.exact.facilitator.get_transaction")
    def test_rejects_wrong_amount(self, mock_get_tx, mock_get_block):
        mock_get_tx.return_value = _make_tx_result(amount="1")
        mock_get_block.return_value = _make_block()
        r = self._make_facilitator().verify(_make_payload(), VALID_REQUIREMENTS)
        assert r.is_valid is False
        assert r.invalid_reason == ERR_AMOUNT_MISMATCH

    @patch("x402.mechanisms.near.exact.facilitator.get_block")
    @patch("x402.mechanisms.near.exact.facilitator.get_transaction")
    def test_rejects_wrong_nonce_in_memo(self, mock_get_tx, mock_get_block):
        mock_get_tx.return_value = _make_tx_result(memo="different00000000000000000000000000")
        mock_get_block.return_value = _make_block()
        r = self._make_facilitator().verify(_make_payload(), VALID_REQUIREMENTS)
        assert r.is_valid is False
        assert r.invalid_reason == ERR_NONCE_MISMATCH

    @patch("x402.mechanisms.near.exact.facilitator.get_block")
    @patch("x402.mechanisms.near.exact.facilitator.get_transaction")
    def test_rejects_expired_transaction(self, mock_get_tx, mock_get_block):
        mock_get_tx.return_value = _make_tx_result()
        mock_get_block.return_value = _make_block(offset_sec=-600)  # 10 minutes ago
        r = self._make_facilitator().verify(_make_payload(), VALID_REQUIREMENTS)
        assert r.is_valid is False
        assert r.invalid_reason == ERR_TRANSACTION_EXPIRED

    @patch("x402.mechanisms.near.exact.facilitator.get_block")
    @patch("x402.mechanisms.near.exact.facilitator.get_transaction")
    def test_accepts_valid_payment(self, mock_get_tx, mock_get_block):
        mock_get_tx.return_value = _make_tx_result()
        mock_get_block.return_value = _make_block()
        r = self._make_facilitator().verify(_make_payload(), VALID_REQUIREMENTS)
        assert r.is_valid is True
        assert r.payer == VALID_SENDER


class TestSettle:
    """Tests for the settle method."""

    @patch("x402.mechanisms.near.exact.facilitator.get_block")
    @patch("x402.mechanisms.near.exact.facilitator.get_transaction")
    def test_settle_success(self, mock_get_tx, mock_get_block):
        mock_get_tx.return_value = _make_tx_result()
        mock_get_block.return_value = _make_block()
        f = ExactNearScheme(MockFacilitatorSigner())
        r = f.settle(_make_payload(), VALID_REQUIREMENTS)
        assert r.success is True
        assert r.transaction == VALID_TX_HASH
        assert r.payer == VALID_SENDER

    @patch("x402.mechanisms.near.exact.facilitator.get_transaction")
    def test_settle_fails_when_verify_fails(self, mock_get_tx):
        mock_get_tx.side_effect = RuntimeError("not found")
        f = ExactNearScheme(MockFacilitatorSigner())
        r = f.settle(_make_payload(), VALID_REQUIREMENTS)
        assert r.success is False
        assert r.error_reason == ERR_TRANSACTION_NOT_FOUND

    @patch("x402.mechanisms.near.exact.facilitator.get_block")
    @patch("x402.mechanisms.near.exact.facilitator.get_transaction")
    def test_duplicate_settlement_rejected(self, mock_get_tx, mock_get_block):
        mock_get_tx.return_value = _make_tx_result()
        mock_get_block.return_value = _make_block()
        f = ExactNearScheme(MockFacilitatorSigner())

        r1 = f.settle(_make_payload(), VALID_REQUIREMENTS)
        assert r1.success is True

        r2 = f.settle(_make_payload(), VALID_REQUIREMENTS)
        assert r2.success is False
        assert r2.error_reason == ERR_DUPLICATE_SETTLEMENT

    @patch("x402.mechanisms.near.exact.facilitator.get_block")
    @patch("x402.mechanisms.near.exact.facilitator.get_transaction")
    def test_two_different_hashes_settle_independently(self, mock_get_tx, mock_get_block):
        mock_get_tx.return_value = _make_tx_result()
        mock_get_block.return_value = _make_block()
        f = ExactNearScheme(MockFacilitatorSigner(), SettlementCache())

        p1 = _make_payload(transactionHash="Tx1111111111111111111111111111111111111111111")
        p2 = _make_payload(transactionHash="Tx2222222222222222222222222222222222222222222")

        r1 = f.settle(p1, VALID_REQUIREMENTS)
        r2 = f.settle(p2, VALID_REQUIREMENTS)

        assert r1.success is True
        assert r2.success is True
