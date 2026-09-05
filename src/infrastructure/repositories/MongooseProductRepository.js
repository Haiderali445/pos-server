const { ProductRepository } = require("../../domain/repositories/RepositoryContracts");

class MongooseProductRepository extends ProductRepository {
  constructor(ItemModel) {
    super();
    this.ItemModel = ItemModel;
  }

  async findAll(context = {}) {
    let query = this.ItemModel.find();
    if (context.session) query = query.session(context.session);
    return query.exec();
  }

  async findById(id, context = {}) {
    let query = this.ItemModel.findById(id);
    if (context.session) query = query.session(context.session);
    return query.exec();
  }

  async create(data, context = {}) {
    const products = await this.ItemModel.create([data], {
      session: context.session,
    });
    return products[0];
  }

  async updateById(id, data, context = {}) {
    let query = this.ItemModel.findByIdAndUpdate(id, data, { new: true });
    if (context.session) query = query.session(context.session);
    return query.exec();
  }

  async deleteById(id, context = {}) {
    let query = this.ItemModel.findByIdAndDelete(id);
    if (context.session) query = query.session(context.session);
    return query.exec();
  }

  async decreaseStockIfAvailable(itemId, quantity, context = {}) {
    let query = this.ItemModel.findOneAndUpdate(
      {
        _id: itemId,
        stock: { $gte: quantity },
      },
      { $inc: { stock: -quantity } },
      { new: true }
    );

    if (context.session) query = query.session(context.session);
    return query.lean();
  }
}

module.exports = MongooseProductRepository;
