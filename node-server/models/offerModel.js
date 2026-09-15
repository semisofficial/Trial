const crypto = require("crypto");
const db = require("../config/db");

function invalid(message) { return Object.assign(new Error(message), { code: "INVALID_ORDER" }); }

function validateOffer(body, catalog) {
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 100) throw invalid("Enter an offer title up to 100 characters");
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50) throw invalid("Select between 1 and 50 snacks");
  const seen = new Set();
  const items = body.items.map((entry) => {
    const item = catalog.find((row) => row.id === entry.id);
    if (!item || !["fried", "frozen"].includes(item.category_id) || seen.has(entry.id)) throw invalid("Select unique fried or frozen snacks only");
    seen.add(entry.id);
    const { minQty, price } = entry;
    const minimum = Number(item.min_qty) || 1;
    const step = Number(item.step_qty) || 1;
    if (!Number.isInteger(minQty) || minQty < minimum || minQty > 10000
        || Math.abs((minQty - minimum) / step - Math.round((minQty - minimum) / step)) > 1e-7) {
      throw invalid(`${item.name}: minimum quantity must follow the menu quantity steps`);
    }
    if (!Number.isFinite(price) || price <= 0 || price >= Number(item.selling_price)
        || Math.abs(price * 100 - Math.round(price * 100)) > 1e-7) {
      throw invalid(`${item.name}: enter a discounted unit price below the regular price`);
    }
    return { id: item.id, minQty, price };
  });
  return { title, items };
}

async function publishOffer(body) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const catalog = await client.query(`SELECT m.id, m.name, m.category_id, m.min_qty, m.step_qty, i.selling_price
      FROM menu_items m JOIN inventory i ON i.menu_item_id=m.id WHERE NOT m.retired FOR SHARE OF m, i`);
    const offer = validateOffer(body, catalog.rows);
    const slug = crypto.randomBytes(6).toString("base64url");
    const result = await client.query(`INSERT INTO offers(slug, title, items)
      VALUES ($1, $2, $3::jsonb) RETURNING *`, [slug, offer.title, JSON.stringify(offer.items)]);
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function activeOffers() {
  return (await db.query(`SELECT slug, title, expires_at FROM offers
    WHERE NOT closed AND starts_at <= now() AND expires_at > now() ORDER BY starts_at DESC LIMIT 20`)).rows;
}

async function getOffer(slug) {
  if (!/^[A-Za-z0-9_-]{8}$/.test(slug)) return null;
  return (await db.query(`SELECT * FROM offers WHERE slug=$1 AND NOT closed
    AND starts_at <= now() AND expires_at > now()`, [slug])).rows[0] || null;
}

function applyOfferPrices(offer, items, now = Date.now()) {
  if (!offer || offer.closed || new Date(offer.starts_at).getTime() > now
      || new Date(offer.expires_at).getTime() <= now) throw invalid("This offer has closed. Please return to the regular menu.");
  for (const item of items) {
    const deal = offer.items.find((entry) => entry.id === item.id);
    if (!deal || item.qty < deal.minQty || !["fried", "frozen"].includes(item.categoryId)) {
      throw invalid("Your cart does not meet this offer's items and minimum quantities");
    }
    item.price = Number(deal.price);
  }
}

async function applyOfferToOrder(client, slug, items) {
  if (typeof slug !== "string" || !/^[A-Za-z0-9_-]{8}$/.test(slug)) throw invalid("Invalid offer link");
  const result = await client.query("SELECT *, clock_timestamp() AS checked_at FROM offers WHERE slug=$1 FOR SHARE", [slug]);
  const offer = result.rows[0];
  applyOfferPrices(offer, items, offer ? new Date(offer.checked_at).getTime() : Date.now());
}

module.exports = { validateOffer, publishOffer, activeOffers, getOffer, applyOfferPrices, applyOfferToOrder };
