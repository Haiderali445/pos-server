class CollectionService {
  constructor({ repository }) {
    this.repository = repository;
  }

  getAll(context) {
    return this.repository.findAll(context);
  }

  getById(id, context) {
    return this.repository.findById(id, context);
  }

  create(data, context) {
    return this.repository.create(data, context);
  }

  update(id, data, context) {
    return this.repository.updateById(id, data, context);
  }

  remove(id, context) {
    return this.repository.deleteById(id, context);
  }
}

module.exports = CollectionService;
