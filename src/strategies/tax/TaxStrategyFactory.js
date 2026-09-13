const ZeroTaxStrategy = require("./ZeroTaxStrategy");
const FlatTaxStrategy = require("./FlatTaxStrategy");
const VatTaxStrategy = require("./VatTaxStrategy");

class TaxStrategyFactory {
  static getStrategy(strategyType = "zero") {
    switch (String(strategyType).toLowerCase()) {
      case "flat":
        return new FlatTaxStrategy();
      case "vat":
        return new VatTaxStrategy();
      case "zero":
      default:
        return new ZeroTaxStrategy();
    }
  }
}

module.exports = TaxStrategyFactory;
