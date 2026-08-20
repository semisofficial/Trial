const inventory = require("../models/inventoryModel");

exports.getInventory = async (req, res) => {
  try {
    const data = await inventory.getInventory();

    res.json({
      success: true,
      data,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

exports.updateInventory = async (req, res) => {
  try {
    const body = req.body;
    const allowed = new Set(["stock", "available", "price"]);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({ success: false, message: "Inventory update must be an object" });
    }
    const fields = Object.keys(body);
    if (fields.length === 0 || fields.some((field) => !allowed.has(field))) {
      return res.status(400).json({ success: false, message: "Only stock, available, and price can be updated" });
    }
    if (Object.hasOwn(body, "stock") && (!Number.isFinite(body.stock) || body.stock < 0 || body.stock > 1000000)) {
      return res.status(400).json({ success: false, message: "Stock must be a non-negative number" });
    }
    if (Object.hasOwn(body, "price") && (!Number.isFinite(body.price) || body.price < 0 || body.price > 10000000)) {
      return res.status(400).json({ success: false, message: "Price must be a non-negative number" });
    }
    if (Object.hasOwn(body, "available") && typeof body.available !== "boolean") {
      return res.status(400).json({ success: false, message: "Availability must be true or false" });
    }
    const data = await inventory.updateInventory(
      req.params.id,
      body
    );

    if (!data) return res.status(404).json({ success: false, message: "Inventory item not found" });

    res.json({
      success: true,
      data,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
