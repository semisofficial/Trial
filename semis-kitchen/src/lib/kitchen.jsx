import {
  Clock,
  CheckCircle2,
  XCircle,
  Package,
  Snowflake,
  Flame,
  Soup,
} from "lucide-react";
import MENU_SNAPSHOT from "../menuSnapshot.js";

// API base URL — set VITE_API_URL in production (Vercel env var) to point at
// your deployed backend (e.g. https://your-api.vercel.app/api). In local dev
// it defaults to a relative "/api" path, which the Vite dev server proxies to
// the backend (see vite.config.js). Using a relative path avoids LAN-IP
// reachability and CORS issues so the site works from any host.
export const API = import.meta.env.VITE_API_URL || "/api";

async function adminRequest(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, { ...options, credentials: "include" });
  } catch (cause) {
    const error = new Error("The server is temporarily unreachable");
    error.cause = cause;
    window.dispatchEvent(new CustomEvent("semis-api-error", { detail: { message: error.message } }));
    throw error;
  }
  if (res.status === 401) window.dispatchEvent(new Event("semis-admin-unauthorized"));
  return res;
}

async function parseApiResponse(res, fallbackMessage = "Request failed") {
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (res.ok) {
        const error = new Error("The server returned an invalid response");
        window.dispatchEvent(new CustomEvent("semis-api-error", { detail: { message: error.message } }));
        throw error;
      }
    }
  }
  if (!res.ok) {
    const error = new Error(data.message || data.error || fallbackMessage);
    error.code = data.code;
    error.status = res.status;
    if (res.status !== 401) {
      window.dispatchEvent(new CustomEvent("semis-api-error", { detail: { message: error.message, status: error.status } }));
    }
    throw error;
  }
  return data;
}

export async function adminLogin(password) {
  const res = await adminRequest("/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return parseApiResponse(res, "Unable to sign in");
}

export async function checkAdminSession() {
  const res = await adminRequest("/admin/session");
  if (res.status === 401) return false;
  await parseApiResponse(res, "Unable to check staff session");
  return true;
}

export async function adminLogout() {
  const res = await adminRequest("/admin/logout", { method: "POST" });
  if (res.status !== 401) await parseApiResponse(res, "Unable to sign out");
}


/* ---------------------------------------------------------
   Brand
--------------------------------------------------------- */
export const FONTS = `
:root {
  --font-serif: Georgia, "Times New Roman", ui-serif, serif;
  --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
`;

export const CATS = [
  { id: "fried", name: "Fried Snacks", icon: Flame },
  { id: "frozen", name: "Frozen Snacks", icon: Snowflake },
  { id: "mains", name: "Biriyani & Curries", icon: Soup },
];

/* Reformat item names to remove parentheses, e.g. "Cutlet (Beef)" -> "Beef Cutlet",
   "Kallumakaya (w/ masala)" -> "Masala Kallumakaya",
   "Kallumakaya (w/o masala)" -> "Plain Kallumakaya". */
function formatItemName(name) {
  if (!name) return name;
  const m = name.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (!m) return name.trim();
  const base = m[1].trim();
  const variant = m[2].trim();
  let prefix;
  if (/^w\/\s*masala$/i.test(variant)) prefix = "Masala";
  else if (/^w\/o\s*masala$/i.test(variant)) prefix = "Plain";
  else prefix = variant.replace(/\bw\/\b/g, "with");
  return `${prefix} ${base}`.trim();
}

export async function loadMenu() {
  const res = await fetch(`${API}/menu`);
  const json = await parseApiResponse(res, "Unable to load the menu");

  const menu = json.data.map((item) => ({
    id: item.id,
    cat: item.cat,
    name: formatItemName(item.name),
    unit: item.unit,
    minQty: Number(item.minQty),
    step: Number(item.step),
    price: Number(item.price),
    stock: Number(item.stock),
    available: item.available !== false,
    seasonal: item.seasonal,
    img: item.img,
  }));

  // Hybrid: the live (authoritative) catalog is cached locally so the menu can
  // paint instantly on later visits even before the backend responds. New live
  // data always overwrites the cache, so real item ids + current
  // price/stock/availability stay in sync. Fire-and-forget on purpose — don't
  // delay the menu returning just to persist the cache.
  writeMenuCache(menu);

  return menu;
}

/* Map image filenames (from src/assets/images/) to their built URLs.
   Upload PNG/JPG files with names matching each menu item's `img` field. */
const MENU_IMAGES = import.meta.glob("/src/assets/images/*", {
  eager: true,
  query: "?url",
  import: "default",
});

/* Fallback mapping: fried & frozen snacks share the same photo. When a menu
   item's exact image file isn't present, fall back to the matching photo
   that is available in src/assets/images/. */
const IMAGE_FALLBACK = {
  /* Fried snacks (fr-*) */
  "fr-chicken-roll.png": "fr-ChickenRoll.jpeg",
  "fr-cutlet-beef.png": "fr-cutlet.jpeg",
  "fr-cutlet-chicken.png": "fr-cutlet.jpeg",
  "fr-kallumakaya.png": "fr-Kallumakaya.jpeg",
  "fr-samoosa-beef.png": "fr-samoosa.png",
  "fr-samoosa-chicken.png": "fr-samoosa.png",
  "fr-unnakaya.png": "fr-Unnakaya.jpeg",
  /* Frozen snacks (fz-*) — 6 new photos */
  "fz-chicken-roll.png": "fz-ChickenRoll.jpeg",
  "fz-cutlet-beef.png": "fz-Cutlet.jpeg",
  "fz-cutlet-chicken.png": "fz-Cutlet.jpeg",
  "fz-kallumakaya-masala.png": "fz-Masala-Kallumakaya.jpeg",
  "fz-kallumakaya-plain.png": "fz-Plain-Kallumakaya.jpeg",
  "fz-samoosa-beef.png": "fz-Samoosa.jpeg",
  "fz-samoosa-chicken.png": "fz-Samoosa.jpeg",
  "fz-unnakaya.png": "fz-Unnakaya.jpeg",
  /* Biriyanis & curries (mains) — match menu png refs to the uploaded photos */
  "mc-beef-biriyani.png": "beef-biryani.jpeg",
  "mc-butter-chicken.png": "butter-chicken.jpeg",
  "mc-chicken-65.png": "chicken-65.jpeg",
  "mc-chicken-biriyani.png": "chicken-biryani.jpeg",
  "mc-chicken-curry.png": "chicken-curry.jpeg",
  "mc-chicken-fry.png": "chicken-fry.jpeg",
  "mc-chicken-stew.png": "chicken-stew.jpeg",
  "mc-chilly-chicken.png": "chilly-chicken.jpeg",
  "mc-fish-biriyani.png": "fish-biryani.jpeg",
  "mc-garlic-chicken.png": "garlic-chicken.jpeg",
  "mc-ginger-chicken.png": "ginger-chicken.jpeg",
  "mc-hummus.png": "hummus.jpeg",
  "mc-madhooth.png": "madhooth.jpeg",
  "mc-mutton-biriyani.png": "mutton-biryani.jpeg",
  "mc-pepper-chicken.png": "pepper-chicken.jpeg",
  "mc-thai-chicken.png": "thai-chicken.jpeg",
  "mc-turkish-chicken.png": "turkish-chicken.jpeg",
  /* Newly added menu items (uploaded later) — accept .png/.jpg/.jpeg naming */
  "fz-momos-chicken.png": "fz-momos-chicken.jpeg",
  "fz-kunafa-chicken.png": "fz-kunafa-chicken.jpeg",
  "fr-irachi-pathiri.png": "fr-irachi-pathiri.jpeg",
  "fr-steamed-momos.png": "fr-steamed-momos.jpeg",
  "fr-fried-momos.png": "fr-fried-momos.jpeg",
  "fr-kunafa-chicken.png": "fr-kunafa-chicken.jpeg",
  "mc-beef-curry-masala.png": "mc-beef-curry-masala.jpeg",
  "mc-beef-curry-coconut.png": "mc-beef-curry-coconut.jpeg",
  "mc-beef-dry-fry.png": "mc-beef-dry-fry.jpeg",
  "mc-beef-stew.png": "mc-beef-stew.jpeg",
  "mc-fish-moly.png": "mc-fish-moly.jpeg",
  "mc-fish-mulakuttath.png": "mc-fish-mulakuttath.jpeg",
  "mc-fish-chilly.png": "mc-fish-chilly.jpeg",
  "mc-mutton-stew.png": "mc-mutton-stew.jpeg",
  "mc-mutton-masala.png": "mc-mutton-masala.jpeg",
  "mc-mutton-varattiyath.png": "mc-mutton-varattiyath.jpeg",
  "mc-kallumakaya-masala.png": "mc-kallumakaya-masala.jpeg",
  "mc-kallumakaya-fry.png": "mc-kallumakaya-fry.jpeg",
  "mc-paal-kappa.png": "mc-paal-kappa.jpeg",
  "mc-pasta.png": "mc-pasta.jpeg",
  "mc-batura.png": "mc-batura.jpeg",
  "mc-kannuvecha-pathiri-half-cooked.png": "mc-kannuvecha-pathiri-half-cooked.jpeg",
  "mc-kannuvecha-pathiri-fried.png": "mc-kannuvecha-pathiri-fried.jpeg",
  "mc-neypathal.png": "mc-neypathal.jpeg",
  "mc-kuboos.png": "mc-kuboos.jpeg",
  "mc-kozhi-nirachath-spring.png": "mc-kozhi-nirachath-spring.jpeg",
  "mc-kozhi-nirachath-broiler.png": "mc-kozhi-nirachath-broiler.jpeg",
};

const imgCache = new Map();
export function resolveImg(img) {
  if (!img) return undefined;
  if (imgCache.has(img)) return imgCache.get(img);
  const clean = img.replace(/^images\//, "");
  const direct = MENU_IMAGES[`/src/assets/images/${clean}`];
  if (direct) {
    imgCache.set(img, direct);
    return direct;
  }
  const fallbackName = IMAGE_FALLBACK[clean];
  if (fallbackName) {
    const resolved = MENU_IMAGES[`/src/assets/images/${fallbackName}`];
    imgCache.set(img, resolved);
    return resolved;
  }
  imgCache.set(img, undefined);
  return undefined;
}

export const STATUS = {
  pending: { label: "Pending", color: "text-amber-400", bg: "bg-amber-400/10", ring: "ring-amber-400/30" },
  accepted: { label: "Accepted", color: "text-emerald-400", bg: "bg-emerald-400/10", ring: "ring-emerald-400/30" },
  declined: { label: "Declined", color: "text-red-400", bg: "bg-red-400/10", ring: "ring-red-400/30" },
  completed: { label: "Completed", color: "text-sky-400", bg: "bg-sky-400/10", ring: "ring-sky-400/30" },
};

export function rupee(n) {
  return `₹${n.toLocaleString("en-IN")}`;
}
/* Read the last-known menu cache from this browser. Orders themselves are
   always stored authoritatively in PostgreSQL, never in localStorage. */
function readLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
/* ---------------------------------------------------------
   Menu catalog cache — the "static catalog" half of the hybrid.
   After every successful live load, the authoritative menu (real
   ids + current price/stock/availability) is saved here so the
   customer page can render it instantly on later visits, then the
   fresh /api/menu inventory overlay refreshes it. Item ids
   are the backend's real ids, so orders and admin inventory edits
   keep working unchanged. localStorage is synchronous so React can
   seed its state from the cache on the first paint.
--------------------------------------------------------- */
const MENU_CACHE_KEY = "semis_menu_cache";

function readMenuCacheSync() {
  const v = readLocal(MENU_CACHE_KEY);
  return Array.isArray(v) ? v : [];
}

function writeMenuCache(menu) {
  if (!Array.isArray(menu) || menu.length === 0) return;
  try {
    localStorage.setItem(MENU_CACHE_KEY, JSON.stringify(menu));
  } catch {
    /* Never let a cache write break the live fetch. */
  }
}

/* Last-known catalog, read synchronously for an instant first paint.
   The live inventory overlay (price/stock/availability) is applied on
   top by the caller via the regular loadMenu refresh. */
export function loadMenuStored() {
  const cached = readMenuCacheSync();
  const source = cached.length ? cached : MENU_SNAPSHOT;
  return source.map((item) => ({ ...item, name: formatItemName(item.name) }));
}

export async function loadInventory() {
  const res = await fetch(`${API}/inventory`);
  const json = await parseApiResponse(res, "Unable to load stock information");

  const inv = {};

  json.data.forEach((item) => {
    inv[item.menu_item_id] = {
      stock: item.stock,
      available: item.available,
      price: Number(item.selling_price),
    };
  });

  return inv;
}

/* Field-level inventory update — sends only the changed field(s) so concurrent
   admins editing different fields (price vs stock vs availability) don't
   overwrite each other's changes. */
export async function updateInventoryField(id, patch) {
  const res = await adminRequest(`/inventory/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const json = await parseApiResponse(res, "Unable to update inventory");
  return json.data;
}

export async function createOrder(order) {
  const res = await fetch(`${API}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(order),
  });
  const json = await parseApiResponse(res, "Failed to place order");
  return json.data;
}

export async function updatePaymentStatusApi(id, paymentStatus) {
  const res = await adminRequest(`/orders/${id}/payment`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentStatus }),
  });
  const json = await parseApiResponse(res, "Unable to update payment status");
  return json.data;
}

/* Map a payment-method code to its display label */
export function paymentMethodLabel(code) {
  if (!code) return null;
  const map = { cod: "Cash on Delivery", upi: "UPI" };
  return map[code] || code;
}

/* Map a delivery slot id like "11-12" to a readable label like
   "11:00 AM – 12:00 PM". Mirrors the slot generation in App.jsx. */
export function deliverySlotLabel(slotId) {
  if (!slotId) return null;
  const [start, end] = slotId.split("-").map(Number);
  if (Number.isNaN(start) || Number.isNaN(end)) return slotId;
  const fmt = (h) => {
    const period = h >= 12 ? "PM" : "AM";
    const hr = h % 12 === 0 ? 12 : h % 12;
    return `${hr}:00 ${period}`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

/* Format a YYYY-MM-DD (or Date-parsable) delivery date for display. */
export function deliveryDateLabel(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/* Shared mapper: raw API order row -> frontend order object. */
function mapOrder(o) {
  return {
    id: o.id,
    invoiceId: o.invoice_id,
    invoiceShareToken: o.invoice_share_token,
    status: o.status,
    paymentStatus: o.payment_status || "unpaid",
    paymentMethod: o.payment_method || "cod",
    syncedAt: o.synced_at,
    total: Number(o.total),
    createdAt: new Date(o.created_at).getTime(),
    customer: {
      name: o.customer_name,
      phone: o.customer_phone,
      address: o.customer_address,
      mode: o.order_mode,
      notes: o.notes,
      location: o.latitude != null ? { lat: o.latitude, lng: o.longitude } : null,
      deliveryDate: o.delivery_date,
      deliverySlot: o.delivery_slot,
    },
    items: o.items.map((i) => ({ id: i.id, name: formatItemName(i.name), qty: Number(i.qty), price: Number(i.price) })),
  };
}

export async function fetchOrders() {
  const res = await adminRequest("/orders");
  const json = await parseApiResponse(res, "Unable to load orders");
  return json.data.map(mapOrder);
}


export async function deleteOrderApi(id) {
  const res = await adminRequest(`/orders/${id}`, { method: "DELETE" });
  await parseApiResponse(res, "Unable to delete order");
}

/* Deletes orders that are completed, paid, and already confirmed synced to
   the Google Sheet — see the Admin Invoices tab's "Delete paid & synced"
   button. Returns how many rows were actually deleted. */
export async function deletePaidSyncedOrdersApi() {
  const res = await adminRequest("/orders/paid-synced", { method: "DELETE" });
  const json = await parseApiResponse(res, "Unable to delete synchronized orders");
  return json.deletedCount ?? 0;
}

/* Fetch archived (backed-up) orders from the shared database. This replaces
   the old per-browser localStorage archive so every admin sees identical data. */
export async function fetchArchivedOrders() {
  const res = await adminRequest("/orders/archived");
  const json = await parseApiResponse(res, "Unable to load archived orders");
  return json.data.map(mapOrder);
}

/* Mark a set of orders as archived in the shared database. */
export async function archiveOrdersApi(ids) {
  const res = await adminRequest("/orders/archive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  const json = await parseApiResponse(res, "Unable to archive orders");
  return json.data;
}

export async function updateOrderStatusApi(id, status) {
  const res = await adminRequest(`/orders/${id}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const json = await parseApiResponse(res, "Unable to update order status");
  return json.data;
}

export async function fetchSalesSummary() {
  const res = await adminRequest("/sales/summary");
  const json = await parseApiResponse(res, "Unable to load sales summary");
  return json.data; // [{ date, orders_count, revenue }]
}

/* ---------------------------------------------------------
   Invoice helpers (PDF generation + Google Sheets sync)
--------------------------------------------------------- */
/* Download a single invoice PDF for an order (opens in a new tab). */
export function downloadInvoice(orderId) {
  window.open(`${API}/invoices/${encodeURIComponent(orderId)}`, "_blank");
}

/* Open a customer WhatsApp chat with the branded public invoice link and the
   manual thank-you message. This does not call the Meta/WhatsApp API. */
export async function shareInvoiceOnWhatsApp(orderId, customerPhone, invoiceShareToken) {
  let digits = String(customerPhone || "").replace(/\D/g, "");
  if (digits.length === 10) digits = `91${digits}`;

  if (!invoiceShareToken) throw new Error("This invoice does not have a sharing token");
  const invoiceUrl = `https://semiskitchen.in/invoice/${encodeURIComponent(orderId)}?token=${encodeURIComponent(invoiceShareToken)}`;
  const qrUrl = "https://semiskitchen.in/upi-qr.jpeg";
  const message = `Thank you for choosing Semi’s Kitchen! ❤️

We truly appreciate your order and the trust you’ve placed in us. Every dish is prepared with care, love, and attention to detail.

We hope you enjoy every bite!
Thank you for supporting Semi’s Kitchen. 🍽️✨

Your invoice: ${invoiceUrl}`;

  // On supported mobile browsers, use the native share sheet with the QR as
  // an actual image attachment. The admin can then choose WhatsApp and the
  // customer receives both the message and the QR image together.
  try {
    const response = await fetch(qrUrl);
    if (!response.ok) throw new Error("QR image unavailable");
    const qrBlob = await response.blob();
    const qrFile = new File([qrBlob], "semis-kitchen-upi-qr.jpeg", { type: "image/jpeg" });
    const shareData = { title: "Semi's Kitchen invoice", text: message, files: [qrFile] };
    if (navigator.share && navigator.canShare?.(shareData)) {
      await navigator.share(shareData);
      return;
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
  }

  // Desktop/older-browser fallback: open the customer's WhatsApp chat with
  // both public links. The QR link can be opened or forwarded manually.
  const fallbackMessage = `${message}\n\nUPI payment QR: ${qrUrl}`;
  const recipient = digits ? `/${digits}` : "";
  window.open(`https://wa.me${recipient}?text=${encodeURIComponent(fallbackMessage)}`, "_blank", "noopener,noreferrer");
}

export async function fetchInvoiceBatchInfo() {
  const res = await adminRequest("/invoices/batch-info");
  const json = await parseApiResponse(res, "Unable to load invoice batches");
  return json.data;
}

/* Downloads one storage-free ZIP containing at most three invoice PDFs. */
export async function downloadInvoiceBatch(page) {
  const res = await adminRequest(`/invoices/batch?page=${encodeURIComponent(page)}`);
  if (!res.ok) {
    await parseApiResponse(res, "Unable to download invoice batch");
  }
  const blobUrl = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = `accepted-invoices-batch-${page}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

/* Push all accepted orders' line items into the configured Google Sheet.
   Returns { success, appended } or throws on failure. */
export async function syncToSheets() {
  const res = await adminRequest("/invoices/sync-sheet", { method: "POST" });
  const json = await parseApiResponse(res, "Sync to Google Sheets failed");
  return json; // { success, appended }
}

/* ---------------------------------------------------------
   Small shared bits
--------------------------------------------------------- */
export function Logo({ size = "md" }) {
  const big = size === "lg";
  return (
    <div className="leading-none">
      <div
        className={`${big ? "text-4xl" : "text-3xl"} text-amber-300 tracking-tight uppercase`}
        style={{ fontFamily: "var(--font-serif)", fontWeight: 600 }}
      >
        Semi's Kitchen
      </div>
      {big && <div className="text-stone-400 text-xs tracking-[0.2em] uppercase mt-1">Malabar snacks &amp; curries, made to order</div>}
    </div>
  );
}

export function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ${s.bg} ${s.color} ${s.ring}`}>
      {status === "pending" && <Clock className="w-3 h-3" />}
      {status === "accepted" && <CheckCircle2 className="w-3 h-3" />}
      {status === "declined" && <XCircle className="w-3 h-3" />}
      {status === "completed" && <Package className="w-3 h-3" />}
      {s.label}
    </span>
  );
}
