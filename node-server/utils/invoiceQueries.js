// Invoice queries written against the Semis Kitchen schema.
//
// Notes on the schema:
//   - orders.id            -> the order id (e.g. SKxxxx)
//   - orders.invoice_id    -> the invoice id (e.g. INV-yyyymmdd-xxxx)
//   - orders.paymet        -> payment method ('cod' | 'upi')
//   - orders.status        -> 'pending' | 'accepted' | 'declined' | 'completed'
//   - order_items.menu_item_id -> FK to menu_items.id (the item's *name* lives
//     on menu_items.name, so we join to get a human-readable item name)
//
// The batch invoice-zip query targets 'accepted' orders (unchanged).
// The Google Sheet sync query targets 'completed' orders (per product
// decision — an order is only synced to the sheet once it's fully done,
// not merely accepted).

const SINGLE_ORDER_QUERY = `
  SELECT
    o.invoice_id,
    o.id AS order_id,
    o.created_at,

    c.name,
    c.phone,

    oi.id AS order_item_id,
    mi.name AS item_name,
    oi.quantity,
    oi.unit_price,
    oi.subtotal,

    o.total,
    o.paymet AS payment_method

  FROM orders o
  JOIN customers c ON o.customer_id = c.id
  JOIN order_items oi ON o.id = oi.order_id
  JOIN menu_items mi ON mi.id = oi.menu_item_id
  WHERE o.id = $1
    AND ($2::text IS NULL OR o.invoice_share_token = $2);
`;

// Batch version — every accepted order's line items in one result set.
// groupOrders() in invoiceGenerator.js splits this back into one object
// per order (use this for a "generate all accepted invoices" job).
const ACCEPTED_ORDERS_QUERY = `
  WITH selected_orders AS (
    SELECT id
    FROM orders
    WHERE status = 'accepted'
    ORDER BY created_at, id
    LIMIT $1 OFFSET $2
  )
  SELECT
    o.invoice_id,
    o.id AS order_id,
    o.created_at,

    c.name,
    c.phone,

    oi.id AS order_item_id,
    mi.name AS item_name,
    oi.quantity,
    oi.unit_price,
    oi.subtotal,

    o.total,
    o.paymet AS payment_method

  FROM orders o
  JOIN selected_orders selected ON selected.id = o.id
  JOIN customers c ON o.customer_id = c.id
  JOIN order_items oi ON o.id = oi.order_id
  JOIN menu_items mi ON mi.id = oi.menu_item_id
  ORDER BY o.id;
`;

const ACCEPTED_ORDERS_COUNT_QUERY = `
  SELECT count(*)::integer AS total
  FROM orders
  WHERE status = 'accepted';
`;

// Used only by the Google Sheet sync — targets 'completed' orders instead of
// 'accepted' so a row is only pushed to the sheet once the order is fully
// done (previously this reused ACCEPTED_ORDERS_QUERY, which meant orders
// still in progress could get synced). Also only picks up orders that
// haven't been synced yet (synced_at IS NULL) — previously this had no such
// filter, so clicking "Sync to Sheets" more than once re-appended every
// completed order's rows again each time, silently duplicating them in the
// sheet. The controller sets synced_at after a successful push.
const COMPLETED_ORDERS_QUERY = `
  SELECT
    o.invoice_id,
    o.id AS order_id,
    o.created_at,

    c.name,
    c.phone,

    oi.id AS order_item_id,
    mi.name AS item_name,
    oi.quantity,
    oi.unit_price,
    oi.subtotal,

    o.total,
    o.paymet AS payment_method

  FROM orders o
  JOIN customers c ON o.customer_id = c.id
  JOIN order_items oi ON o.id = oi.order_id
  JOIN menu_items mi ON mi.id = oi.menu_item_id
  WHERE o.status = 'completed' AND o.synced_at IS NULL
  ORDER BY o.id;
`;

module.exports = { SINGLE_ORDER_QUERY, ACCEPTED_ORDERS_QUERY, ACCEPTED_ORDERS_COUNT_QUERY, COMPLETED_ORDERS_QUERY };
