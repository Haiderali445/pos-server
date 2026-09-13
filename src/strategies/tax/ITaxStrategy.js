class ITaxStrategy {
  calculateTax(subtotal, items = [], rate = 0) {
    throw new Error("calculateTax method must be implemented by concrete strategy.");
  }
}

module.exports = ITaxStrategy;
