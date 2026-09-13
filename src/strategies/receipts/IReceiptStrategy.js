class IReceiptStrategy {
  formatReceipt(billData, tenantData = {}) {
    throw new Error("formatReceipt method must be implemented by concrete strategy.");
  }
}

module.exports = IReceiptStrategy;
