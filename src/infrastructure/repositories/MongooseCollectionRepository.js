const CollectionRepository = require("../../domain/repositories/CollectionRepository");

class MongooseCollectionRepository extends CollectionRepository {
  constructor(Model) {
    super();
    this.Model = Model;
  }

  findAll(context = {}) {
    let query = this.Model.find();
    if (context.session) query = query.session(context.session);
    return query.exec();
  }

  findById(id, context = {}) {
    let query = this.Model.findById(id);
    if (context.session) query = query.session(context.session);
    return query.exec();
  }

  create(data, context = {}) {
    return this.Model.create([data], { session: context.session }).then(
      (documents) => documents[0]
    );
  }

  updateById(id, data, context = {}) {
    let query = this.Model.findByIdAndUpdate(id, data, { new: true });
    if (context.session) query = query.session(context.session);
    return query.exec();
  }

  deleteById(id, context = {}) {
    let query = this.Model.findByIdAndDelete(id);
    if (context.session) query = query.session(context.session);
    return query.exec();
  }
}

module.exports = MongooseCollectionRepository;
