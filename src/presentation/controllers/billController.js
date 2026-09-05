function createBillController({ checkoutService, billRepository }) {
  const getbillController = async (req, res) => {
    try {
      const bills = await billRepository.findAll();
      return res.status(200).send(bills);
    } catch (error) {
      return res.status(500).json({ error: "Internal Server Error" });
    }
  };

  const addbillController = async (req, res) => {
    try {
      const newBill = await checkoutService.createBill(req.body, req.user);
      return res.status(201).json({
        message: "Bill Created Successfully",
        data: newBill,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : "Internal Server Error",
      });
    }
  };

  const editBillController = async (req, res) => {
    try {
      const { billId, ...updatedBillData } = req.body;

      if (!billId) {
        return res.status(400).json({ error: "Bill ID is required" });
      }

      const updatedBill = await billRepository.updateById(billId, updatedBillData);

      if (!updatedBill) {
        return res.status(404).json({ error: "Bill not found" });
      }

      return res.status(200).json({
        message: "Bill updated successfully",
        data: updatedBill,
      });
    } catch (error) {
      return res.status(500).json({ error: "Internal Server Error" });
    }
  };

  const deleteBillController = async (req, res) => {
    try {
      const billId = req.params.id || req.body.billId;

      if (!billId) {
        return res.status(400).json({ error: "Bill ID is required" });
      }

      const deletedBill = await billRepository.deleteById(billId);

      if (!deletedBill) {
        return res.status(404).json({ error: "Bill not found" });
      }

      return res.status(200).json({
        message: "Bill deleted successfully",
        data: deletedBill,
      });
    } catch (error) {
      return res.status(500).json({ error: "Internal Server Error" });
    }
  };

  return {
    addbillController,
    getbillController,
    editBillController,
    deleteBillController,
  };
}

module.exports = { createBillController };
