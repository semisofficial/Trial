const menuModel = require("../models/menuModel");

exports.getMenu = async (req, res) => {
  try {
    const menu = await menuModel.getMenu();

    // Vercel may serve a recent catalog immediately while refreshing it in
    // the background. Checkout remains authoritative and revalidates current
    // prices and stock transactionally before accepting an order.
    res.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=86400");

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
