const salesModel = require("../models/salesModel");

exports.getSalesSummary = async (req, res) => {
  try {
    const data = await salesModel.getSalesSummary();
    res.json({ success: true, data });
  } catch (err) {
    console.error("❌ Failed to fetch sales summary:", err.message);
    res.status(500).json({ success: false, message: "Failed to fetch sales summary" });
  }
};
