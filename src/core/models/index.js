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
const GoodsReceipt = require("./GoodsReceipt");
const BillAdjustment = require("./BillAdjustment");
const { softDeletePlugin } = require("./plugins/softDelete");

module.exports = {
  Account,
  AccountTransaction,
  GoodsReceipt,
  BillAdjustment,
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
