"""NEAR server implementation for the Exact payment scheme."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from ....schemas import AssetAmount, Network, PaymentRequirements, Price, SupportedKind
from ..constants import DEFAULT_DECIMALS, SCHEME_EXACT
from ..utils import convert_to_usdc_units, get_usdc_address, parse_money_to_decimal

MoneyParser = Callable[[float, str], AssetAmount | None]


class ExactNearScheme:
    """NEAR server implementation for the Exact payment scheme.

    Parses prices to USDC token units for NEAR networks.
    No feePayer injection is needed because clients pay their own gas.

    Attributes:
        scheme: The scheme identifier ("exact").
    """

    scheme = SCHEME_EXACT

    def __init__(self) -> None:
        self._money_parsers: list[MoneyParser] = []

    def register_money_parser(self, parser: MoneyParser) -> "ExactNearScheme":
        """Register a custom money parser in the chain.

        Args:
            parser: Function taking (decimal_amount, network) and returning AssetAmount or None.

        Returns:
            Self for chaining.
        """
        self._money_parsers.append(parser)
        return self

    def parse_price(self, price: Price, network: Network) -> AssetAmount:
        """Parse a price into an AssetAmount for NEAR.

        If price is already an AssetAmount it is returned as-is.
        If price is a Money string/number it is converted to USDC units.

        Args:
            price: USD amount (e.g. 1.5, '$1.50') or explicit AssetAmount.
            network: CAIP-2 NEAR network identifier.

        Returns:
            AssetAmount with amount, asset, and extra fields.
        """
        # Already an AssetAmount object
        if isinstance(price, AssetAmount):
            if not price.asset:
                raise ValueError(f"Asset address required for AssetAmount on {network}")
            return price

        # Already an AssetAmount dict
        if isinstance(price, dict) and "amount" in price:
            if not price.get("asset"):
                raise ValueError(f"Asset address required for AssetAmount on {network}")
            return AssetAmount(
                amount=price["amount"],
                asset=price["asset"],
                extra=price.get("extra", {}),
            )

        decimal = parse_money_to_decimal(price)

        for parser in self._money_parsers:
            result = parser(decimal, str(network))
            if result is not None:
                return result

        return self._default_money_conversion(decimal, str(network))

    def enhance_payment_requirements(
        self,
        requirements: PaymentRequirements,
        supported_kind: SupportedKind | None = None,
        extension_keys: list[str] | None = None,
    ) -> PaymentRequirements:
        """Return requirements unchanged.

        NEAR clients pay their own gas so no feePayer injection is needed.

        Args:
            requirements: Base payment requirements.
            supported_kind: Unused for NEAR.
            extension_keys: Unused for NEAR.

        Returns:
            The requirements unchanged.
        """
        return requirements

    def _default_money_conversion(self, amount: float, network: str) -> AssetAmount:
        return AssetAmount(
            amount=convert_to_usdc_units(amount),
            asset=get_usdc_address(network),
            extra={},
        )
