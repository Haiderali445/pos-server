const Account = require("./Account");
const Item = require("./Item");
const StockMovement = require("./StockMovement");
const Bill = require("./Bill");
const Invoice = require("./Invoice");
const Dealer = require("./Dealer");
const Charge = require("./Charge");
const Tenant = require("./Tenant");
const User = require("./User");
const ProductPriceAudit = require("./ProductPriceAudit");
const Category = require("./Category");
const Unit = require("./Unit");
const AccountTransaction = require("./AccountTransaction");
const { softDeletePlugin } = require("./plugins/softDelete");

module.exports = {
  Account,
  AccountTransaction,
  Item,
  StockMovement,
  ProductPriceAudit,
  Bill,
  Invoice,
  Dealer,
  Charge,
  Tenant,
  User,
  Category,
  Unit,
  softDeletePlugin,
};
