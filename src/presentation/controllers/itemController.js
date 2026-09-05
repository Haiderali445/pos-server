function createItemController({ itemService }) {
  const getItemController = async (req, res) => {
    try {
      const items = await itemService.getAll();
      return res.status(200).send(items);
    } catch (error) {
      return res.status(500).send(error);
    }
  };

  const addItemController = async (req, res) => {
    try {
      await itemService.create(req.body);
      return res.status(201).send("Item Created Successfully!");
    } catch (error) {
      return res.status(400).send("error", error);
    }
  };

  const edititemController = async (req, res) => {
    try {
      const { itemId } = req.body;
      await itemService.update(itemId, req.body);
      return res.status(201).json("item Updated");
    } catch (error) {
      return res.status(400).send(error);
    }
  };

  const deleteitemController = async (req, res) => {
    try {
      await itemService.remove(req.body.itemId);
      return res.status(201).json("item deleted");
    } catch (error) {
      return res.status(400).send(error);
    }
  };

  return {
    getItemController,
    addItemController,
    edititemController,
    deleteitemController,
  };
}

module.exports = { createItemController };