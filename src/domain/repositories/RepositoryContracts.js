class UserRepository {
  async findByUserId() {
    throw new Error("findByUserId is not implemented");
  }

  async findByUserIdWithPassword() {
    throw new Error("findByUserIdWithPassword is not implemented");
  }

  async create() {
    throw new Error("create is not implemented");
  }

  async count() {
    throw new Error("count is not implemented");
  }

  async findAll() {
    throw new Error("findAll is not implemented");
  }

  async updateRole() {
    throw new Error("updateRole is not implemented");
  }

  async updateActive() {
    throw new Error("updateActive is not implemented");
  }

  async deleteById() {
    throw new Error("deleteById is not implemented");
  }
}

class ProductRepository {
  async findAll() {
    throw new Error("findAll is not implemented");
  }

  async findById() {
    throw new Error("findById is not implemented");
  }

  async create() {
    throw new Error("create is not implemented");
  }

  async updateById() {
    throw new Error("updateById is not implemented");
  }

  async deleteById() {
    throw new Error("deleteById is not implemented");
  }

  async decreaseStockIfAvailable() {
    throw new Error("decreaseStockIfAvailable is not implemented");
  }
}

class BillRepository {
  async create() {
    throw new Error("create is not implemented");
  }

  async findAll() {
    throw new Error("findAll is not implemented");
  }

  async updateById() {
    throw new Error("updateById is not implemented");
  }

  async deleteById() {
    throw new Error("deleteById is not implemented");
  }
}

module.exports = { UserRepository, ProductRepository, BillRepository };
