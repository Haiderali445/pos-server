class CheckoutService {
  constructor({ unitOfWork }) {
    this.unitOfWork = unitOfWork;
  }

  async createBill(command, currentUser = {}) {
    if (!Array.isArray(command.cartItems) || command.cartItems.length === 0) {
      const error = new Error("Cart cannot be empty");
      error.statusCode = 400;
      throw error;
    }

    return this.unitOfWork.withTransaction(async ({ products, bills, context }) => {
      const quantities = new Map();

      for (const cartItem of command.cartItems) {
        const itemId = cartItem._id;
        const quantity = Number(cartItem.quantity);

        if (!itemId || !Number.isInteger(quantity) || quantity < 1) {
          const error = new Error("Invalid cart item");
          error.statusCode = 400;
          throw error;
        }

        quantities.set(itemId, (quantities.get(itemId) || 0) + quantity);
      }

      const cartItems = [];
      let totalAmount = 0;

      for (const [itemId, quantity] of quantities) {
        const product = await products.decreaseStockIfAvailable(itemId, quantity, context);

        if (!product) {
          const error = new Error("Insufficient stock or item not found");
          error.statusCode = 409;
          throw error;
        }

        const lineTotal = product.salePrice * quantity;
        totalAmount += lineTotal;

        cartItems.push({
          _id: product._id,
          name: product.name,
          salePrice: product.salePrice,
          purchasePrice: product.purchasePrice,
          quantity,
          category: product.category,
          image: product.image,
        });
      }

      const paidAmount = Number(command.paidAmount);

      if (!Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > totalAmount) {
        const error = new Error("Invalid paid amount");
        error.statusCode = 400;
        throw error;
      }

      return bills.create(
        {
          costumerName: command.costumerName,
          costumerNumber: command.costumerNumber,
          totalAmount,
          paidAmount,
          paymentMethod: command.paymentMethod,
          cartItems,
          date: command.date || new Date(),
        },
        context
      );
    });
  }
}

module.exports = CheckoutService;
