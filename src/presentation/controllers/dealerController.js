function createDealerController({ dealerService }) {
  const getAllDealers = async (req, res) => {
    try {
      return res.json(await dealerService.getAll());
    } catch (error) {
      return res.status(500).json({ message: "Failed to fetch dealers" });
    }
  };

  const addDealer = async (req, res) => {
    try {
      const dealer = await dealerService.create(req.body);
      return res.status(201).json(dealer);
    } catch (error) {
      return res.status(400).json({ message: "Failed to add dealer" });
    }
  };

  const getDealerById = async (req, res) => {
    try {
      const dealer = await dealerService.getById(req.params.id);
      return dealer
        ? res.json(dealer)
        : res.status(404).json({ message: "Dealer not found" });
    } catch (error) {
      return res.status(500).json({ message: "Failed to fetch dealer" });
    }
  };

  const updateDealerById = async (req, res) => {
    try {
      const id = req.params.id || req.body.id || req.body.dealerId;
      const updatedDealer = await dealerService.update(id, req.body);
      return updatedDealer
        ? res.json(updatedDealer)
        : res.status(404).json({ message: "Dealer not found" });
    } catch (error) {
      return res.status(500).json({ message: "Failed to update dealer" });
    }
  };

  const deleteDealerById = async (req, res) => {
    try {
      const deletedDealer = await dealerService.remove(req.body.dealerId);
      return deletedDealer
        ? res.json({ message: "Dealer deleted successfully" })
        : res.status(404).json({ message: "Dealer not found" });
    } catch (error) {
      return res.status(500).json({ message: "Failed to delete dealer" });
    }
  };

  return { getAllDealers, addDealer, getDealerById, updateDealerById, deleteDealerById };
}

module.exports = { createDealerController };
