const ITaxStrategy = require("./ITaxStrategy");

class ZeroTaxStrategy extends ITaxStrategy {
  calculateTax(subtotal, _items = [], _rate = 0) {
    return {
      taxableAmount: Number(subtotal || 0),
      taxRate: 0,
      taxAmount: 0,
      total: Number(subtotal || 0),
    };
  }
}

module.exports = ZeroTaxStrategy;
