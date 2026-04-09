"""Tests for NEAR ExactNearScheme server."""

import pytest

from x402.mechanisms.near import NEAR_MAINNET_CAIP2, NEAR_TESTNET_CAIP2, USDC_MAINNET_ADDRESS, USDC_TESTNET_ADDRESS
from x402.mechanisms.near.exact.server import ExactNearScheme
from x402.schemas import AssetAmount


class TestExactNearSchemeServer:
    """Tests for ExactNearScheme server."""

    def setup_method(self):
        self.server = ExactNearScheme()

    def test_scheme_is_exact(self):
        assert self.server.scheme == "exact"

    # --- parsePrice ---

    def test_parse_dollar_string_mainnet(self):
        result = self.server.parse_price("$1.00", NEAR_MAINNET_CAIP2)
        assert result.amount == "1000000"
        assert result.asset == USDC_MAINNET_ADDRESS
        assert result.extra == {}

    def test_parse_plain_number_string(self):
        result = self.server.parse_price("0.50", NEAR_MAINNET_CAIP2)
        assert result.amount == "500000"

    def test_parse_float(self):
        result = self.server.parse_price(2.5, NEAR_MAINNET_CAIP2)
        assert result.amount == "2500000"

    def test_parse_whole_number(self):
        result = self.server.parse_price("10", NEAR_MAINNET_CAIP2)
        assert result.amount == "10000000"

    def test_no_floating_point_rounding_error(self):
        result = self.server.parse_price("$4.02", NEAR_MAINNET_CAIP2)
        assert result.amount == "4020000"

    def test_testnet_uses_testnet_usdc(self):
        result = self.server.parse_price("1.00", NEAR_TESTNET_CAIP2)
        assert result.asset == USDC_TESTNET_ADDRESS
        assert result.amount == "1000000"

    def test_asset_amount_passthrough(self):
        result = self.server.parse_price(
            {"amount": "999", "asset": "custom.token.near", "extra": {"x": 1}},
            NEAR_MAINNET_CAIP2,
        )
        assert result.amount == "999"
        assert result.asset == "custom.token.near"
        assert result.extra == {"x": 1}

    def test_asset_amount_object_passthrough(self):
        asset_amount = AssetAmount(amount="42", asset="other.near", extra={})
        result = self.server.parse_price(asset_amount, NEAR_MAINNET_CAIP2)
        assert result.amount == "42"
        assert result.asset == "other.near"

    def test_asset_amount_missing_asset_raises(self):
        with pytest.raises(ValueError, match="Asset address required"):
            self.server.parse_price({"amount": "999"}, NEAR_MAINNET_CAIP2)

    def test_invalid_money_string_raises(self):
        with pytest.raises(ValueError, match="Invalid money format"):
            self.server.parse_price("not-a-price!", NEAR_MAINNET_CAIP2)

    # --- custom money parsers ---

    def test_custom_parser_used_when_it_returns_value(self):
        server = ExactNearScheme()
        server.register_money_parser(lambda _amount, _net: AssetAmount(amount="777", asset="custom.near", extra={}))
        result = server.parse_price("1.00", NEAR_MAINNET_CAIP2)
        assert result.amount == "777"
        assert result.asset == "custom.near"

    def test_custom_parser_falls_back_when_none(self):
        server = ExactNearScheme()
        server.register_money_parser(lambda _a, _n: None)
        result = server.parse_price("1.00", NEAR_MAINNET_CAIP2)
        assert result.asset == USDC_MAINNET_ADDRESS

    def test_parser_chain_uses_first_non_none(self):
        server = ExactNearScheme()
        server.register_money_parser(lambda _a, _n: None)
        server.register_money_parser(lambda _a, _n: AssetAmount(amount="55", asset="second.near", extra={}))
        result = server.parse_price("1.00", NEAR_MAINNET_CAIP2)
        assert result.amount == "55"

    # --- enhancePaymentRequirements ---

    def test_enhance_returns_requirements_unchanged(self):
        from x402.schemas import PaymentRequirements
        req = PaymentRequirements(
            scheme="exact",
            network=NEAR_MAINNET_CAIP2,
            asset=USDC_MAINNET_ADDRESS,
            amount="1000000",
            pay_to="merchant.near",
            max_timeout_seconds=300,
        )
        result = self.server.enhance_payment_requirements(req)
        assert result == req
