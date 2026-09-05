const { UserRepository } = require("../../domain/repositories/RepositoryContracts");

class MongooseUserRepository extends UserRepository {
  constructor(UserModel) {
    super();
    this.UserModel = UserModel;
  }

  normalizeUserId(userId) {
    return typeof userId === "string" ? userId.trim().toLowerCase() : "";
  }

  async findByUserId(userId, context = {}) {
    let query = this.UserModel.findOne({ userId: this.normalizeUserId(userId) });
    if (context.session) query = query.session(context.session);
    return query.lean();
  }

  async findByUserIdWithPassword(userId, context = {}) {
    let query = this.UserModel
      .findOne({ userId: this.normalizeUserId(userId) })
      .select("+password");
    if (context.session) query = query.session(context.session);
    return query.lean();
  }

  async create(userData, context = {}) {
    const users = await this.UserModel.create([userData], {
      session: context.session,
    });
    return users[0].toObject();
  }

  async count(context = {}) {
    let query = this.UserModel.countDocuments();
    if (context.session) query = query.session(context.session);
    return query.exec();
  }

  async updatePassword(userId, password, context = {}) {
    let query = this.UserModel.findOneAndUpdate(
      { userId: this.normalizeUserId(userId) },
      { password },
      { new: true }
    );
    if (context.session) query = query.session(context.session);
    return query.lean();
  }

  async findAll(context = {}) {
    let query = this.UserModel.find().select("-password").sort({ createdAt: -1 });
    if (context.session) query = query.session(context.session);
    return query.lean();
  }

  async updateRole(userId, role, context = {}) {
    let query = this.UserModel.findOneAndUpdate(
      { userId: this.normalizeUserId(userId) },
      { role },
      { new: true }
    ).select("-password");
    if (context.session) query = query.session(context.session);
    return query.lean();
  }

  async updateActive(userId, active, context = {}) {
    let query = this.UserModel.findOneAndUpdate(
      { userId: this.normalizeUserId(userId) },
      { active },
      { new: true }
    ).select("-password");
    if (context.session) query = query.session(context.session);
    return query.lean();
  }

  async deleteById(idOrUserId, context = {}) {
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(idOrUserId);
    const filter = isObjectId
      ? { _id: idOrUserId }
      : { userId: this.normalizeUserId(idOrUserId) };
    let query = this.UserModel.findOneAndDelete(filter);
    if (context.session) query = query.session(context.session);
    return query.lean();
  }
}

module.exports = MongooseUserRepository;
