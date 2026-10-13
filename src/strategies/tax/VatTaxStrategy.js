const ITaxStrategy = require("./ITaxStrategy");

class VatTaxStrategy extends ITaxStrategy {
  calculateTax(subtotal, items = [], rate = 0) {
    const defaultRate = Number(rate || 0);
    let totalTax = 0;
    const rawTaxableBase = items.reduce((sum, item) => {
      const lineSubtotal =
        Number(item.salePrice || item.unitPrice || item.price || 0) * Number(item.quantity || 1) -
        Number(item.unitDiscount || 0);
      return sum + Math.max(0, lineSubtotal);
    }, 0);
    const discountedTaxableBase = Math.max(0, Number(subtotal || 0));
    const discountFactor = rawTaxableBase > 0 ? discountedTaxableBase / rawTaxableBase : 0;

    for (const item of items) {
      const lineSubtotal = Math.max(
        0,
        Number(item.salePrice || item.unitPrice || item.price || 0) * Number(item.quantity || 1) -
          Number(item.unitDiscount || 0)
      ) * discountFactor;
      // If item has a custom taxRate override, use it, else default tenant VAT rate
      const itemTaxRate = item.taxRate !== undefined ? Number(item.taxRate) : defaultRate;
      const itemTax = (lineSubtotal * itemTaxRate) / 100;
      totalTax += itemTax;
    }

    const roundedTax = Number(totalTax.toFixed(2));
    const roundedSubtotal = Number(discountedTaxableBase.toFixed(2));

    return {
      taxableAmount: roundedSubtotal,
      taxRate: defaultRate,
      taxAmount: roundedTax,
      total: Number((roundedSubtotal + roundedTax).toFixed(2)),
    };
  }
}

module.exports = VatTaxStrategy;
