const ITaxStrategy = require("./ITaxStrategy");

class VatTaxStrategy extends ITaxStrategy {
  calculateTax(subtotal, items = [], rate = 0) {
    const defaultRate = Number(rate || 0);
    let totalTax = 0;
    let taxableBase = 0;

    for (const item of items) {
      const lineSubtotal = Number(item.salePrice || item.price || 0) * Number(item.quantity || 1);
      // If item has a custom taxRate override, use it, else default tenant VAT rate
      const itemTaxRate = item.taxRate !== undefined ? Number(item.taxRate) : defaultRate;
      const itemTax = (lineSubtotal * itemTaxRate) / 100;
      totalTax += itemTax;
      taxableBase += lineSubtotal;
    }

    const roundedTax = Number(totalTax.toFixed(2));
    const roundedSubtotal = Number(taxableBase.toFixed(2));

    return {
      taxableAmount: roundedSubtotal,
      taxRate: defaultRate,
      taxAmount: roundedTax,
      total: Number((roundedSubtotal + roundedTax).toFixed(2)),
    };
  }
}

module.exports = VatTaxStrategy;
