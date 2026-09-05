const { BillRepository } = require("../../domain/repositories/RepositoryContracts");

class MongooseBillRepository extends BillRepository {
	constructor(BillModel) {
		super();
		this.BillModel = BillModel;
	}

	async create(billData, context = {}) {
		const bills = await this.BillModel.create([billData], {
			session: context.session,
		});
		return bills[0];
	}

	async findAll(context = {}) {
		let query = this.BillModel.find();
		if (context.session) query = query.session(context.session);
		return query.exec();
	}

	async updateById(id, update, context = {}) {
		let query = this.BillModel.findByIdAndUpdate(id, update, { new: true });
		if (context.session) query = query.session(context.session);
		return query.exec();
	}

	async deleteById(id, context = {}) {
		let query = this.BillModel.findByIdAndDelete(id);
		if (context.session) query = query.session(context.session);
		return query.exec();
	}
}

module.exports = MongooseBillRepository;
