const Thermal80mmReceiptStrategy = require("./Thermal80mmReceiptStrategy");
const StandardA4ReceiptStrategy = require("./StandardA4ReceiptStrategy");

class ReceiptStrategyFactory {
  static getStrategy(templateType = "thermal80mm") {
    switch (String(templateType).toLowerCase()) {
      case "standarda4":
      case "a4":
        return new StandardA4ReceiptStrategy();
      case "thermal80mm":
      case "thermal":
      default:
        return new Thermal80mmReceiptStrategy();
    }
  }
}

module.exports = ReceiptStrategyFactory;
