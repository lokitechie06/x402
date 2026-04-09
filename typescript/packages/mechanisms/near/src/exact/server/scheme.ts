import type {
  AssetAmount,
  MoneyParser,
  Network,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
} from "@x402/core/types";
import { getUsdcAddress, convertToUsdcUnits } from "../../utils";

/**
 * NEAR server implementation for the Exact payment scheme.
 */
export class ExactNearScheme implements SchemeNetworkServer {
  readonly scheme = "exact";
  private moneyParsers: MoneyParser[] = [];

  /**
   * Register a custom money parser in the parser chain.
   *
   * @param parser - Function to convert a decimal USD amount to an AssetAmount
   * @returns This instance for chaining
   */
  registerMoneyParser(parser: MoneyParser): ExactNearScheme {
    this.moneyParsers.push(parser);
    return this;
  }

  /**
   * Parse a price into an AssetAmount for NEAR.
   *
   * If `price` is already an AssetAmount it is returned as-is.
   * If `price` is a Money string/number it is converted to USDC units on the given network.
   *
   * @param price - USD amount (e.g. 1.5, "$1.50") or explicit AssetAmount
   * @param network - CAIP-2 NEAR network identifier
   * @returns Resolved AssetAmount
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    if (typeof price === "object" && price !== null && "amount" in price) {
      if (!price.asset) {
        throw new Error(`Asset address must be specified for AssetAmount on network ${network}`);
      }
      return {
        amount: price.amount,
        asset: price.asset,
        extra: price.extra ?? {},
      };
    }

    const decimal = this.parseMoneyToDecimal(price);

    for (const parser of this.moneyParsers) {
      const result = await parser(decimal, network);
      if (result !== null) {
        return result;
      }
    }

    return this.defaultMoneyConversion(decimal, network);
  }

  /**
   * Enhance payment requirements with NEAR-specific fields.
   * No additional extra fields are required for NEAR (the client pays its own gas).
   *
   * @param paymentRequirements - The base payment requirements
   * @returns The requirements unchanged
   */
  enhancePaymentRequirements(
    paymentRequirements: PaymentRequirements,
  ): Promise<PaymentRequirements> {
    return Promise.resolve(paymentRequirements);
  }

  private parseMoneyToDecimal(money: string | number): number {
    if (typeof money === "number") {
      return money;
    }
    const cleaned = money.replace(/^\$/, "").trim();
    const amount = parseFloat(cleaned);
    if (isNaN(amount)) {
      throw new Error(`Invalid money format: ${money}`);
    }
    return amount;
  }

  private defaultMoneyConversion(amount: number, network: Network): AssetAmount {
    return {
      amount: convertToUsdcUnits(amount),
      asset: getUsdcAddress(network),
      extra: {},
    };
  }
}
