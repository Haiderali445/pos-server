const mongoose = require("mongoose");

class UnitOfWork {
  async runInTransaction(workFn) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const result = await workFn(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }
}

const unitOfWork = new UnitOfWork();

module.exports = {
  UnitOfWork,
  unitOfWork,
};
