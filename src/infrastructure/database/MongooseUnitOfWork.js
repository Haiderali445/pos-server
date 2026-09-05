const mongoose = require("mongoose");

class MongooseUnitOfWork {
  constructor({ userRepositoryFactory, productRepositoryFactory, billRepositoryFactory }) {
    this.userRepositoryFactory = userRepositoryFactory;
    this.productRepositoryFactory = productRepositoryFactory;
    this.billRepositoryFactory = billRepositoryFactory;
  }

  async withTransaction(work) {
    const session = await mongoose.startSession();

    try {
      let result;

      await session.withTransaction(async () => {
        const context = { session };

        result = await work({
          context,
          users: this.userRepositoryFactory(),
          products: this.productRepositoryFactory(),
          bills: this.billRepositoryFactory(),
        });
      });

      return result;
    } finally {
      await session.endSession();
    }
  }
}

module.exports = MongooseUnitOfWork;
