const IReceiptStrategy = require("./IReceiptStrategy");

class Thermal80mmReceiptStrategy extends IReceiptStrategy {
  formatReceipt(billData, tenantData = {}) {
    const storeName = tenantData.name || "HARDWARE POINT";
    const phone = tenantData.contactPhone || "+92 (300) 000-0000";
    const address = tenantData.address || "Main Retail Terminal, Branch 01";

    return {
      template: "thermal80mm",
      store: {
        name: storeName,
        phone,
        address,
      },
      invoice: {
        _id: billData._id,
        date: billData.date || new Date(),
        customerName: billData.costumerName || "Walk-in Customer",
        customerPhone: billData.costumerNumber || "—",
        paymentMethod: (billData.paymentMethod || "cash").toUpperCase(),
        items: (billData.cartItems || []).map((item) => ({
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.salePrice || item.price,
          lineTotal: (item.quantity || 1) * (item.salePrice || item.price || 0),
        })),
        subtotal: billData.subtotal || billData.totalAmount,
        taxAmount: billData.taxAmount || 0,
        totalAmount: billData.totalAmount,
        paidAmount: billData.paidAmount,
        balanceDue: Math.max(0, (billData.totalAmount || 0) - (billData.paidAmount || 0)),
      },
      footerNote: "*** Thank You for Your Business! ***",
    };
  }
}

module.exports = Thermal80mmReceiptStrategy;
