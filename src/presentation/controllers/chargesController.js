function createChargesController({ chargeService }) {
  const getAllCharges = async (req, res) => {
    try {
      return res.status(200).json(await chargeService.getAll());
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch charges" });
    }
  };

  const addCharge = async (req, res) => {
    try {
      return res.status(201).json(await chargeService.create(req.body));
    } catch (error) {
      return res.status(500).json({ error: "Failed to add charge" });
    }
  };

  const updateCharge = async (req, res) => {
    try {
      const { chargeId, description, amount } = req.body;
      const charge = await chargeService.update(chargeId, { description, amount });
      return res.status(200).json(charge);
    } catch (error) {
      return res.status(500).json({ error: "Failed to update charge" });
    }
  };

  const deleteCharge = async (req, res) => {
    try {
      await chargeService.remove(req.body.chargeId);
      return res.status(200).json({ message: "Charge deleted successfully" });
    } catch (error) {
      return res.status(500).json({ error: "Failed to delete charge" });
    }
  };

  return { getAllCharges, addCharge, updateCharge, deleteCharge };
}

module.exports = { createChargesController };
