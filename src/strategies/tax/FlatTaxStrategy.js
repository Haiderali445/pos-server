const ITaxStrategy = require("./ITaxStrategy");

class FlatTaxStrategy extends ITaxStrategy {
  calculateTax(subtotal, _items = [], rate = 0) {
    const sub = Number(subtotal || 0);
    const taxRate = Number(rate || 0);
    const taxAmount = Number(((sub * taxRate) / 100).toFixed(2));
    return {
      taxableAmount: sub,
      taxRate,
      taxAmount,
      total: Number((sub + taxAmount).toFixed(2)),
    };
  }
}

module.exports = FlatTaxStrategy;
