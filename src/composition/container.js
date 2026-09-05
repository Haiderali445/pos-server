const UserModel = require("../infrastructure/models/userModels");
const ItemModel = require("../infrastructure/models/itemModels");
const BillModel = require("../infrastructure/models/billaModels");
const DealerModel = require("../infrastructure/models/dealerModels");
const ChargeModel = require("../infrastructure/models/chargesModels");
const bcrypt = require("bcrypt");

const AuthService = require("../application/services/AuthService");
const CheckoutService = require("../application/services/CheckoutService");
const CollectionService = require("../application/services/CollectionService");
const MongooseUnitOfWork = require("../infrastructure/database/MongooseUnitOfWork");
const MongooseUserRepository = require("../infrastructure/repositories/MongooseUserRepository");
const MongooseProductRepository = require("../infrastructure/repositories/MongooseProductRepository");
const MongooseBillRepository = require("../infrastructure/repositories/MongooseBillRepository");
const MongooseCollectionRepository = require("../infrastructure/repositories/MongooseCollectionRepository");
const JoseTokenSigner = require("../infrastructure/security/JoseTokenSigner");

function createContainer() {
  const userRepository = new MongooseUserRepository(UserModel);
  const productRepository = new MongooseProductRepository(ItemModel);
  const billRepository = new MongooseBillRepository(BillModel);
  const dealerRepository = new MongooseCollectionRepository(DealerModel);
  const chargeRepository = new MongooseCollectionRepository(ChargeModel);

  const unitOfWork = new MongooseUnitOfWork({
    userRepositoryFactory: () => userRepository,
    productRepositoryFactory: () => productRepository,
    billRepositoryFactory: () => billRepository,
  });

  return {
    repositories: {
      userRepository,
      productRepository,
      billRepository,
      dealerRepository,
      chargeRepository,
    },
    services: {
      authService: new AuthService({
        userRepository,
        passwordHasher: bcrypt,
        tokenSigner: new JoseTokenSigner(),
      }),
      checkoutService: new CheckoutService({ unitOfWork }),
      itemService: new CollectionService({ repository: productRepository }),
      dealerService: new CollectionService({ repository: dealerRepository }),
      chargeService: new CollectionService({ repository: chargeRepository }),
    },
    unitOfWork,
  };
}

module.exports = { createContainer };
