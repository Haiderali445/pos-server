const IReceiptStrategy = require("./IReceiptStrategy");

class StandardA4ReceiptStrategy extends IReceiptStrategy {
  formatReceipt(billData, tenantData = {}) {
    return {
      template: "standardA4",
      store: {
        name: tenantData.name || "Enterprise Commercial Store",
        phone: tenantData.contactPhone || "",
        address: tenantData.address || "",
        currency: tenantData.currency || "PKR",
      },
      invoice: {
        invoiceNumber: billData._id,
        invoiceDate: billData.date || new Date(),
        billedTo: {
          name: billData.costumerName || "Walk-in Customer",
          phone: billData.costumerNumber || "N/A",
        },
        payment: {
          method: billData.paymentMethod,
          status: (billData.paidAmount >= billData.totalAmount) ? "PAID" : "PARTIAL / DUE",
        },
        lineItems: (billData.cartItems || []).map((item) => ({
          description: item.name,
          qty: item.quantity,
          rate: item.salePrice || item.price,
          amount: (item.quantity || 1) * (item.salePrice || item.price || 0),
        })),
        financials: {
          subtotal: billData.subtotal || billData.totalAmount,
          tax: billData.taxAmount || 0,
          grandTotal: billData.totalAmount,
          amountReceived: billData.paidAmount,
          balanceRemaining: Math.max(0, (billData.totalAmount || 0) - (billData.paidAmount || 0)),
        },
      },
    };
  }
}

module.exports = StandardA4ReceiptStrategy;
