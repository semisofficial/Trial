const menuModel = require("../models/menuModel");

exports.getMenu = async (req, res) => {
  try {
    const menu = await menuModel.getMenu();

    // Never let an edge cache keep paused dishes visible. Checkout independently
    // revalidates availability and prices inside its transaction.
    res.set("Cache-Control", "no-store");

    res.json({
      success: true,
      data: menu
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Failed to load menu"
    });
  }
};

exports.getAdminMenu = async (req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  try { res.json({ success: true, data: await menuModel.getMenu(true) }); }
  catch (error) { next(error); }
};
