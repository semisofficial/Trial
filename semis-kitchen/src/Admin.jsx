import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from 'react-router';
import {
  X,
  Check,
  Phone,
  MapPin,
  Lock,
  Package,
  Trash2,
  UtensilsCrossed,
Save,
  FileText,
  Search,
  Download,
  Share2,
  Clock,
} from "lucide-react";
import {
  FONTS,
  CATS,
  STATUS,
  Logo,
  StatusPill,
  rupee,
  loadMenu,
  loadInventory,
  updateInventoryField,
  fetchOrders,
  fetchArchivedOrders,
  archiveOrdersApi,
  deletePaidSyncedOrdersApi,
  updateOrderStatusApi,
  updatePaymentStatusApi,
  paymentMethodLabel,
  deliverySlotLabel,
  deliveryDateLabel,
  downloadInvoice,
  shareInvoiceOnWhatsApp,
  shareDeclineOnWhatsApp,
  fetchInvoiceBatchInfo,
  downloadInvoiceBatch,
  syncToSheets,
  adminLogin,
  checkAdminSession,
  adminLogout,
} from "./lib/kitchen.jsx";

/* ---------------------------------------------------------
   Admin dashboard (secret route /nashi)
--------------------------------------------------------- */
export default function Admin() {
  const navigate = useNavigate();
  const [unlocked, setUnlocked] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [loginPending, setLoginPending] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [dashboardError, setDashboardError] = useState("");
  const [tab, setTab] = useState("pending");
const [section, setSection] = useState("orders");
  const [invoiceGroup, setInvoiceGroup] = useState("recent"); // recent | day | week
  const [salesGroup, setSalesGroup] = useState("day"); // day | week
  // Flexible date-range filtering (all / day / week / month) applied to invoices & sales
  const [invRange, setInvRange] = useState("all");
  const [invRefDate, setInvRefDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [invSearch, setInvSearch] = useState("");
  // Sub-tabs within the invoices & sales sections
  const [invSub, setInvSub] = useState("list"); // list | payments
  // Payments sub-tab (paid / unpaid)
  const [payTab, setPayTab] = useState("unpaid"); // paid | unpaid

  const [inventory, setInventory] = useState({});
  const [menu, setMenu] = useState([]);
  const [orders, setOrders] = useState([]);
  const [archived, setArchived] = useState([]);
  const [priceDraft, setPriceDraft] = useState({});
  const [stockDraft, setStockDraft] = useState({});
  const [invoiceBatchInfo, setInvoiceBatchInfo] = useState({ totalInvoices: 0, batchSize: 3, totalBatches: 0 });
  const [downloadingBatch, setDownloadingBatch] = useState(null);

  const refreshMenu = useCallback(async () => setMenu(await loadMenu()), []);
  const refreshInventory = useCallback(async () => setInventory(await loadInventory()), []);
  // In-flight optimistic status overrides (orderId -> status). These are merged
  // into the fetched list so a stale server snapshot (captured while an accept/decline
  // request is still in flight) can't clobber the optimistic status back to pending.
  const orderStatusOverrideRef = useRef({});
  const refreshOrders = useCallback(async () => {
    const fetched = await fetchOrders();
    const O = orderStatusOverrideRef.current;
    setOrders(fetched.map((o) => (O[o.id] ? { ...o, status: O[o.id] } : o)));
  }, []);
  const refreshArchived = useCallback(async () => setArchived(await fetchArchivedOrders()), []);
  const refreshBatchInfo = useCallback(async () => {
    try {
      setInvoiceBatchInfo(await fetchInvoiceBatchInfo());
    } catch {
      setInvoiceBatchInfo({ totalInvoices: 0, batchSize: 3, totalBatches: 0 });
    }
  }, []);

  useEffect(() => {
    checkAdminSession()
      .then(setUnlocked)
      .catch((err) => setError(err.message || "Staff service is temporarily unavailable"))
      .finally(() => setAuthChecking(false));
    const lock = () => setUnlocked(false);
    const showApiError = (event) => setDashboardError(event.detail?.message || "The request failed");
    window.addEventListener("semis-admin-unauthorized", lock);
    window.addEventListener("semis-api-error", showApiError);
    return () => {
      window.removeEventListener("semis-admin-unauthorized", lock);
      window.removeEventListener("semis-api-error", showApiError);
    };
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    const timer = setTimeout(() => {
      Promise.allSettled([
        refreshMenu(), refreshArchived(), refreshInventory(),
        refreshOrders(), refreshBatchInfo(),
      ]);
    }, 0);
    return () => clearTimeout(timer);
  }, [unlocked, refreshMenu, refreshArchived, refreshInventory, refreshOrders, refreshBatchInfo]);

  const refreshAll = async () => {
    setDashboardError("");
    await Promise.allSettled([
      refreshMenu(), refreshArchived(), refreshInventory(),
      refreshOrders(), refreshBatchInfo(),
    ]);
  };

  const tryUnlock = async () => {
    if (!code || loginPending) return;
    setLoginPending(true);
    setError("");
    try {
      await adminLogin(code);
      setUnlocked(true);
      setCode("");
    } catch (err) {
      setError(err.message || "Unable to sign in");
    } finally {
      setLoginPending(false);
    }
  };

  const signOut = async () => {
    try {
      await adminLogout();
    } finally {
      setUnlocked(false);
      setCode("");
    }
  };

  const setOrderStatus = async (id, status) => {
    const order = orders.find((o) => o.id === id);
    let committed = false;
    // Register the in-flight override so a stale refresh can't clobber the
    // optimistic status back to pending while the request is in progress.
    orderStatusOverrideRef.current = { ...orderStatusOverrideRef.current, [id]: status };
    // Optimistic local update for instant UI feedback
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    try {
      await updateOrderStatusApi(id, status);
      committed = true;

      // Status change committed to the DB — drop the override so the next
      // refresh reflects authoritative server state, then re-sync to converge.
      const O = { ...orderStatusOverrideRef.current };
      delete O[id];
      orderStatusOverrideRef.current = O;
      await refreshOrders();
      await refreshInventory();
      await refreshBatchInfo();
    } catch {
      const O = { ...orderStatusOverrideRef.current };
      delete O[id];
      orderStatusOverrideRef.current = O;
      // Revert only when the mutation itself failed. If a later refresh failed,
      // the server change is already authoritative and must remain visible.
      if (!committed && order) {
        setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: order.status } : o)));
      }
    }
  };

  const togglePayment = async (id) => {
    // The order may live in either the active list or the archived list
    // (old invoices). Find it in whichever array (or both) holds it.
    const active = orders.find((o) => o.id === id);
    const arch = archived.find((o) => o.id === id);
    const order = active || arch;
    if (!order) return;
    const prev = order.paymentStatus;
    const next = prev === "paid" ? "unpaid" : "paid";

    // Optimistic update — apply locally immediately for instant UI feedback.
    // Update BOTH arrays so archived invoices (shown in the Payments view)
    // also move paid/unpaid correctly.
    const patch = (o) => (o.id === id ? { ...o, paymentStatus: next } : o);
    const revert = (o) => (o.id === id ? { ...o, paymentStatus: prev } : o);
    setOrders((p) => p.map(patch));
    setArchived((p) => p.map(patch));

    try {
      await updatePaymentStatusApi(id, next);
    } catch {
      // Revert on failure
      setOrders((p) => p.map(revert));
      setArchived((p) => p.map(revert));
    }
  };

  const toggleAvailability = async (itemId) => {
    const current = inventory[itemId];
    const wasAvailable = current?.available !== false;
    // Optimistic local update for instant feedback
    setInventory((prev) => ({ ...prev, [itemId]: { ...prev[itemId], available: !wasAvailable } }));
    try {
      await updateInventoryField(itemId, { available: !wasAvailable });
    } catch {
      setInventory((prev) => ({ ...prev, [itemId]: { ...prev[itemId], available: wasAvailable } }));
    }
  };

  const savePrice = async (itemId) => {
    const raw = priceDraft[itemId];
    if (raw === undefined || raw === "") return;
    const price = Math.max(0, Math.round(Number(raw) * 100) / 100);
    if (!Number.isFinite(price)) return;
    // Optimistic local update for instant feedback
    setInventory((prev) => ({ ...prev, [itemId]: { ...prev[itemId], price } }));
    try {
      await updateInventoryField(itemId, { price });
    } catch {
      setInventory((prev) => ({ ...prev, [itemId]: { ...prev[itemId], price: currentPriceOf(itemId) } }));
    }
    setPriceDraft((d) => {
      const copy = { ...d };
      delete copy[itemId];
      return copy;
    });
  };

  const saveStock = async (itemId) => {
    const raw = stockDraft[itemId];
    if (raw === undefined || raw === "") return;
    const stock = Number(raw);
    if (!Number.isInteger(stock) || stock < 0) return;
    const previousItem = inventory[itemId];
    // Determine availability: item is available only if stock > 0
    const available = stock > 0;
    // Optimistic local update for instant feedback
    setInventory((prev) => ({ ...prev, [itemId]: { ...prev[itemId], stock, available } }));
    try {
      await updateInventoryField(itemId, { stock, available });
    } catch {
      // Revert on failure - restore previous stock and availability
      setInventory((current) => ({
        ...current,
        [itemId]: previousItem,
      }));
    }
    setStockDraft((d) => {
      const copy = { ...d };
      delete copy[itemId];
      return copy;
    });
  };
  const currentPriceOf = (itemId) => (inventory[itemId]?.price != null ? inventory[itemId].price : menu.find((m) => m.id === itemId)?.price);

  // Clear all orders in a status tab, marking them archived in the shared DB
  // (so every admin sees the same historical invoices/sales).
  const clearTab = async (status) => {
    const toClear = orders.filter((o) => o.status === status);
    if (toClear.length === 0) return;
    await archiveOrdersApi(toClear.map((o) => o.id));
    await refreshArchived();
    await refreshOrders();
  };

  if (authChecking) {
    return <div className="min-h-screen bg-green-100 flex items-center justify-center text-green-800">Checking staff session...</div>;
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-green-100 flex items-center justify-center p-4" style={{ fontFamily: "var(--font-sans)" }}>
        <style>{FONTS}</style>
        <div className="w-full max-w-xs text-center">
          <div className="w-12 h-12 rounded-full bg-amber-400 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-6 h-6 text-green-950" />
          </div>
          <h1 className="text-green-950 text-lg font-semibold mb-1" style={{ fontFamily: "var(--font-serif)" }}>Staff access</h1>
          <p className="text-green-800/70 text-sm mb-4">Enter the kitchen passcode to manage orders.</p>
          <input
            type="password"
            value={code}
            onChange={(e) => { setCode(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
            className="w-full bg-white border border-green-300 rounded-lg px-3.5 py-2.5 text-sm text-green-950 text-center focus:outline-none focus:ring-2 focus:ring-amber-400 mb-2"
            placeholder="Passcode"
          />
          {error && <p className="text-red-500 text-xs mb-2">{error}</p>}
          <button disabled={loginPending} onClick={tryUnlock} className="w-full py-2.5 rounded-lg bg-amber-400 text-green-950 font-semibold hover:bg-amber-300 disabled:opacity-60 transition-colors shadow-sm">
            {loginPending ? "Signing in..." : "Unlock"}
          </button>
        </div>
      </div>
    );
  }

  const counts = {
    pending: orders.filter((o) => o.status === "pending").length,
    accepted: orders.filter((o) => o.status === "accepted").length,
    declined: orders.filter((o) => o.status === "declined").length,
    completed: orders.filter((o) => o.status === "completed").length,
  };
  const filtered = orders.filter((o) => o.status === tab).sort((a, b) => b.createdAt - a.createdAt);
  const allInvoiceOrders = [...archived, ...orders];

/* ---------- Shared date-range helpers ---------- */
  const fmtDate = (ts) =>
    new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  const weekLabel = (ts) => {
    const start = new Date(ts);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return `${fmtDate(start.getTime())} – ${fmtDate(end.getTime())}`;
  };

  // Compute the inclusive [start, end] timestamps for the selected range.
  const rangeBounds = (range, ref) => {
    const d = ref ? new Date(ref) : new Date();
    d.setHours(12, 0, 0, 0); // midday to avoid TZ edge cases
    const start = new Date(d);
    const end = new Date(d);
    if (range === "day") {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (range === "week") {
      // Monday-start week
      const day = (d.getDay() + 6) % 7;
      start.setDate(d.getDate() - day);
      start.setHours(0, 0, 0, 0);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
    } else if (range === "month") {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(d.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
    }
    return { start: start.getTime(), end: end.getTime() };
  };

  const inRange = (o) => {
    if (invRange === "all") return true;
    const { start, end } = rangeBounds(invRange, invRefDate);
    return o.createdAt >= start && o.createdAt <= end;
  };

  // Flexible date-range filter controls (used by both Invoices & Sales)
  const RangeFilter = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 border border-green-300 rounded-lg overflow-hidden bg-white">
        {[
          { id: "all", label: "All" },
          { id: "day", label: "Day" },
          { id: "week", label: "Week" },
          { id: "month", label: "Month" },
        ].map((r) => (
          <button
            key={r.id}
            onClick={() => setInvRange(r.id)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              invRange === r.id ? "bg-amber-400 text-green-950" : "text-green-800 hover:bg-green-50"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      {invRange !== "all" && (
        <input
          type="date"
          value={invRefDate}
          onChange={(e) => setInvRefDate(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-green-300 bg-white text-sm text-green-950 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
      )}
    </div>
  );

  // Shared Payments view: lists paid / unpaid completed orders with their order id
  const PaymentsView = () => {
    const base = allInvoiceOrders.filter((o) => o.status === "completed" && inRange(o));
    const list = base
      .filter((o) => (o.paymentStatus || "unpaid") === payTab)
      .sort((a, b) => b.createdAt - a.createdAt);
    const total = list.reduce((s, o) => s + (o.total || 0), 0);
    return (
      <div>
        <div className="flex gap-2 mb-4">
          {["unpaid", "paid"].map((p) => {
            const n = base.filter((o) => (o.paymentStatus || "unpaid") === p).length;
            return (
              <button
                key={p}
                onClick={() => setPayTab(p)}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium border ${
                  payTab === p ? "bg-amber-400 text-green-950 border-amber-400" : "border-green-300 bg-white text-green-800"
                }`}
              >
                {p === "paid" ? "Paid" : "Not Paid"} ({n})
              </button>
            );
          })}
        </div>

        {list.length === 0 && (
          <div className="text-center py-12 text-green-800/50">
            <UtensilsCrossed className="w-8 h-8 mx-auto mb-2 opacity-50" />
            No {payTab === "paid" ? "paid" : "unpaid"} customers in this range.
          </div>
        )}

        <div className="space-y-3">
          {list.map((o) => (
            <div key={o.id} className="border border-green-200 bg-white rounded-xl p-4 shadow-sm">
              <div className="flex flex-wrap justify-between gap-2 items-start mb-2">
                <div>
                  <div className="font-mono text-xs text-amber-600">{o.invoiceId || o.id}</div>
                  <div className="font-mono text-xs text-green-800/50 mt-0.5">Order ID: {o.id}</div>
                  <div className="text-green-950 font-semibold mt-1">{o.customer.name}</div>
                  <div className="flex items-center gap-1.5 text-green-800/70 text-xs mt-0.5">
                    <Phone className="w-3 h-3" /> {o.customer.phone}
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-green-100 text-green-800">{o.customer.mode}</span>
                  </div>
                  <div className="text-green-800/60 text-xs mt-0.5">{fmtDate(o.createdAt)}</div>
                  {(o.customer.deliveryDate || o.customer.deliverySlot) && (
                    <div className="text-amber-700 text-xs mt-0.5 font-medium">
                      Wants it: {deliveryDateLabel(o.customer.deliveryDate)}{o.customer.deliverySlot ? `, ${deliverySlotLabel(o.customer.deliverySlot)}` : ""}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ${
                    (o.paymentStatus || "unpaid") === "paid"
                      ? "bg-emerald-100 text-emerald-700 ring-emerald-300"
                      : "bg-red-50 text-red-600 ring-red-200"
                  }`}>
                    {(o.paymentStatus || "unpaid") === "paid" ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    {(o.paymentStatus || "unpaid") === "paid" ? "Paid" : "Not paid"}
                  </span>
                  <div className="font-semibold text-amber-600 mt-2">{rupee(o.total)}</div>
                </div>
              </div>
              <div className="border-t border-green-100 pt-3 space-y-1">
                {o.items.map((i) => (
                  <div key={i.id} className="flex justify-between text-sm text-green-900">
                    <span>{i.name} × {i.qty}</span>
                    <span>{rupee(i.price * i.qty)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-end mt-3 pt-3 border-t border-green-100">
                <button
                  onClick={() => togglePayment(o.id)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium border ${
                    (o.paymentStatus || "unpaid") === "paid"
                      ? "border-red-300 text-red-600 hover:bg-red-50"
                      : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                  }`}
                >
                  {(o.paymentStatus || "unpaid") === "paid" ? <X className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                  {(o.paymentStatus || "unpaid") === "paid" ? "Mark unpaid" : "Mark paid"}
                </button>
              </div>
            </div>
          ))}
        </div>
        {list.length > 0 && (
          <p className="text-xs text-green-800/50 mt-3">
            {list.length} {payTab === "paid" ? "paid" : "unpaid"} order(s) &middot; total {rupee(total)}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-green-100 text-green-950" style={{ fontFamily: "var(--font-sans)" }}>
      <style>{FONTS}</style>
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-green-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-3">
            <span className="text-xs text-green-800/60 uppercase tracking-widest">Kitchen dashboard</span>
            <button
              onClick={refreshAll}
              title="Refresh orders, inventory & sales"
              className="text-[11px] px-2.5 py-1 rounded-full bg-green-100 border border-green-300 text-green-800 hover:text-amber-600"
            >
              ↻ Refresh
            </button>
            <button
              onClick={() => navigate("/")}
              className="text-[11px] px-2.5 py-1 rounded-full bg-green-100 border border-green-300 text-green-800 hover:text-amber-600"
            >
              ← Back to site
            </button>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-4 flex gap-1">
          {[
            { id: "orders", label: "Orders" },
            { id: "invoices", label: "Invoices" },
            { id: "inventory", label: "Inventory" },
            { id: "sales", label: "Sales" },
          ].map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                section === s.id ? "border-amber-400 text-amber-600" : "border-transparent text-green-800/60 hover:text-green-950"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      <main className="w-full max-w-5xl mx-auto px-4 py-6 flex-1">
        {dashboardError && (
          <div className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span>{dashboardError}</span>
            <button onClick={() => setDashboardError("")} className="font-semibold" aria-label="Dismiss error">×</button>
          </div>
        )}
        {section === "orders" && (
          <>
            <div className="flex gap-2 mb-5 overflow-x-auto">
              {["pending", "accepted", "declined", "completed"].map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap border ${
                    tab === t ? "bg-amber-400 text-green-950 border-amber-400" : "border-green-300 bg-white text-green-800"
                  }`}
                >
                  {STATUS[t].label} ({counts[t]})
                </button>
              ))}
              {(tab === "declined" || tab === "completed") && counts[tab] > 0 && (
                <button
                  onClick={() => { if (confirm(`Move all ${counts[tab]} ${tab} order(s) to the archive for a fresh start?`)) clearTab(tab); }}
                  className="px-3.5 py-2 rounded-lg text-sm font-semibold whitespace-nowrap border border-red-300 text-red-600 bg-red-50 hover:bg-red-100"
                >
                  <Trash2 className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
                  Clear {STATUS[tab].label} ({counts[tab]})
                </button>
              )}
            </div>

            {filtered.length === 0 && (
              <div className="text-center py-16 text-green-800/50">
                <UtensilsCrossed className="w-8 h-8 mx-auto mb-2 opacity-50" />
                No {tab} orders right now.
              </div>
            )}

            <div className="space-y-3">
              {filtered.map((o) => (
                <div key={o.id} className="border border-green-200 bg-white rounded-xl p-4 shadow-sm">
                  <div className="flex flex-wrap justify-between gap-2 items-start mb-3">
                    <div>
                      <div className="font-mono text-xs text-green-800/50">{o.id}</div>
                      <div className="text-green-950 font-semibold">{o.customer.name}</div>
                      <div className="flex items-center gap-1.5 text-green-800/70 text-xs mt-0.5">
                        <Phone className="w-3 h-3" /> {o.customer.phone}
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-green-100 text-green-800">{o.customer.mode}</span>
                        {paymentMethodLabel(o.paymentMethod) && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700">
                            {paymentMethodLabel(o.paymentMethod)}
                          </span>
                        )}
                      </div>
                      {(o.customer.deliveryDate || o.customer.deliverySlot) && (
                        <div className="flex items-center gap-1.5 text-amber-700 text-xs mt-1 font-medium">
                          <Clock className="w-3 h-3 shrink-0" />
                          {deliveryDateLabel(o.customer.deliveryDate)}
                          {o.customer.deliverySlot ? `, ${deliverySlotLabel(o.customer.deliverySlot)}` : ""}
                        </div>
                      )}
                      {o.customer.mode === "Delivery" && o.customer.address && (
                        <div className="flex items-start gap-1.5 text-green-800/70 text-xs mt-1 max-w-sm min-w-0">
                          <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
                          <span className="break-all">{o.customer.address}</span>
                        </div>
                      )}
                      {o.customer.mode === "Delivery" && o.customer.location?.lat && o.customer.location?.lng && (
                        <div className="flex items-start gap-1.5 text-green-800/70 text-xs mt-1">
                          <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
                          <a
                            href={`https://www.google.com/maps?q=${o.customer.location.lat},${o.customer.location.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:text-amber-600"
                          >
                            {o.customer.location.lat.toFixed(6)}, {o.customer.location.lng.toFixed(6)}
                          </a>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 items-center">
                      <StatusPill status={o.status} />
                      {o.status === "accepted" && (
                        <button
                          onClick={() => togglePayment(o.id)}
                          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium border ${
                            o.paymentStatus === "paid"
                              ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                              : "bg-red-50 text-red-600 border-red-200"
                          }`}
                        >
                          {o.paymentStatus === "paid" ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                          {o.paymentStatus === "paid" ? "Paid" : "Not paid"}
                        </button>
                      )}
                      {o.status === "declined" && (
                        <button
                          onClick={() => shareDeclineOnWhatsApp(o.customer.phone)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        >
                          <Share2 className="w-3.5 h-3.5" /> Notify on WhatsApp
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="border-t border-green-100 pt-3 space-y-1">
                    {o.items.map((i) => (
                      <div key={i.id} className="flex justify-between text-sm text-green-900">
                        <span>{i.name} × {i.qty}</span>
                        <span>{rupee(i.price * i.qty)}</span>
                      </div>
                    ))}
                  </div>
                  {o.customer.notes && <div className="text-xs text-green-800/50 italic mt-2 break-all">Note: {o.customer.notes}</div>}
                  <div className="flex justify-between items-center mt-3 pt-3 border-t border-green-100">
                    <span className="font-semibold text-amber-600">{rupee(o.total)}</span>
                    <div className="flex gap-2">
                      {o.status === "pending" && (
                        <>
                          <button
                            onClick={() => setOrderStatus(o.id, "declined")}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium border border-red-300 text-red-600 hover:bg-red-50"
                          >
                            <X className="w-3.5 h-3.5" /> Decline
                          </button>
                          <button
                            onClick={() => setOrderStatus(o.id, "accepted")}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-400 text-green-950 hover:bg-amber-300"
                          >
                            <Check className="w-3.5 h-3.5" /> Accept
                          </button>
                        </>
                      )}
                      {o.status === "accepted" && (
                        <button
                          onClick={() => setOrderStatus(o.id, "completed")}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-sky-100 text-sky-700 hover:bg-sky-200"
                        >
                          <Package className="w-3.5 h-3.5" /> Mark completed
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {section === "invoices" && (() => {
          const invoiceSource = allInvoiceOrders
            .filter((o) => (o.status === "accepted" || o.status === "completed") && inRange(o))
            .sort((a, b) => b.createdAt - a.createdAt);

          // Search filter by order id or invoice id
          const q = invSearch.trim().toLowerCase();
          const searched = q
            ? invoiceSource.filter(
                (o) => (o.id || "").toLowerCase().includes(q) || (o.invoiceId || "").toLowerCase().includes(q)
              )
            : invoiceSource;

          // Group by day (calendar date)
          const byDay = new Map();
          searched.forEach((o) => {
            const d = new Date(o.createdAt);
            const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
            if (!byDay.has(key)) byDay.set(key, []);
            byDay.get(key).push(o);
          });
          const days = Array.from(byDay.entries()).sort((a, b) => b[0] - a[0]);

          // Group by week (Mon-Sun)
          const byWeek = new Map();
          searched.forEach((o) => {
            const d = new Date(o.createdAt);
            const day = (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
            const weekStart = new Date(d);
            weekStart.setDate(d.getDate() - day);
            weekStart.setHours(0, 0, 0, 0);
            const key = weekStart.getTime();
            if (!byWeek.has(key)) byWeek.set(key, []);
            byWeek.get(key).push(o);
          });
          const weeks = Array.from(byWeek.entries()).sort((a, b) => b[0] - a[0]);

const weekLabel = (ts) => {
            const start = new Date(ts);
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            return `${fmtDate(start.getTime())} – ${fmtDate(end.getTime())}`;
          };

// Default view: flat list of all invoices sorted newest-first.
          // Toggling "By day"/"By week" groups them; toggling the active one
          // again returns to the flat "recent" list.
          const groups = invoiceGroup === "day" ? days : invoiceGroup === "week" ? weeks : null;
          const label = invoiceGroup === "day" ? fmtDate : weekLabel;

          const toggleGroup = (g) => {
            setInvoiceGroup((cur) => (cur === g ? "recent" : g));
          };

          return (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <div>
                  <h2 className="text-green-950 text-lg font-semibold" style={{ fontFamily: "var(--font-serif)" }}>Invoices</h2>
<p className="text-green-800/50 text-xs mt-0.5">
                    {searched.length} accepted or completed {searched.length === 1 ? "order" : "orders"} &middot; {invoiceGroup === "day" ? "grouped by day" : invoiceGroup === "week" ? "grouped by week" : "newest first"}
                  </p>
                </div>
<div className="flex flex-wrap items-center gap-2">
                  {RangeFilter}
                  <div className="flex gap-2">
{[
                      { id: "day", label: "By day" },
                      { id: "week", label: "By week" },
                    ].map((g) => (
                      <button
                        key={g.id}
                        onClick={() => toggleGroup(g.id)}
                        className={`px-3.5 py-2 rounded-lg text-sm font-medium border ${
                          invoiceGroup === g.id ? "bg-amber-400 text-green-950 border-amber-400" : "border-green-300 bg-white text-green-800"
                        }`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                  {/* Storage-free invoice batches + Google Sheets sync */}
                  <div className="flex flex-wrap gap-2">
                    {invoiceBatchInfo.totalBatches === 0 ? (
                      <span className="px-3.5 py-2 rounded-lg text-sm border border-green-200 bg-white text-green-800/50">
                        No accepted invoice batches
                      </span>
                    ) : Array.from({ length: invoiceBatchInfo.totalBatches }, (_, index) => index + 1).map((page) => (
                      <button
                        key={page}
                        disabled={downloadingBatch !== null}
                        onClick={async () => {
                          setDownloadingBatch(page);
                          try {
                            await downloadInvoiceBatch(page);
                          } catch (err) {
                            alert(err.message || "Invoice batch download failed.");
                          } finally {
                            setDownloadingBatch(null);
                          }
                        }}
                        title={`Download up to ${invoiceBatchInfo.batchSize} accepted invoices`}
                        className="px-3.5 py-2 rounded-lg text-sm font-semibold border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                      >
                        <Download className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
                        {downloadingBatch === page ? "Preparing..." : `Batch ${page} of ${invoiceBatchInfo.totalBatches}`}
                      </button>
                    ))}
                    <button
                      onClick={async () => {
                        try {
                          const { appended, alreadyPresent = 0 } = await syncToSheets();
                          alert(`Added ${appended} new order(s) to Google Sheets.${alreadyPresent ? ` ${alreadyPresent} already existed and were not duplicated.` : ""}`);
                        } catch (err) {
                          alert(err.message || "Sync to Google Sheets failed.");
                        }
                      }}
                      title="Push accepted orders' line items to the configured Google Sheet"
                      className="px-3.5 py-2 rounded-lg text-sm font-semibold border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    >
                      <Share2 className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> Sync to Sheets
                    </button>
                    {(() => {
                      const eligible = allInvoiceOrders.filter(
                        (o) => o.status === "completed" && o.paymentStatus === "paid" && o.syncedAt
                      );
                      if (eligible.length === 0) return null;
                      return (
                        <button
                          onClick={async () => {
                            if (
                              !confirm(
                                `Permanently delete ${eligible.length} paid & synced invoice${eligible.length === 1 ? "" : "s"} from the database?\n\nThese are already recorded in your Google Sheet — this only frees up database storage, it doesn't touch the sheet.`
                              )
                            )
                              return;
                            const deletedCount = await deletePaidSyncedOrdersApi();
                            alert(`Deleted ${deletedCount} invoice${deletedCount === 1 ? "" : "s"}.`);
                            refreshArchived();
                          }}
                          title="Permanently delete paid, already-synced invoices to free up database storage"
                          className="px-3.5 py-2 rounded-lg text-sm font-semibold border border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                        >
                          <Trash2 className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> Delete paid & synced ({eligible.length})
                        </button>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Sub-tabs: List | Payments */}
              <div className="flex gap-1 mb-4 border-b border-green-200">
                {[
                  { id: "list", label: "Invoice list" },
                  { id: "payments", label: "Payments" },
                ].map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setInvSub(s.id)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      invSub === s.id ? "border-amber-400 text-amber-600" : "border-transparent text-green-800/60 hover:text-green-950"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {invSub === "payments" ? (
                <PaymentsView />
              ) : (
                <>
                  {/* Search box */}
                  <div className="relative mb-4 max-w-sm">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-green-800/40" />
                    <input
                      type="text"
                      value={invSearch}
                      onChange={(e) => setInvSearch(e.target.value)}
                      placeholder="Search by order ID or invoice ID…"
                      className="w-full bg-white border border-green-300 rounded-lg pl-9 pr-3 py-2 text-sm text-green-950 placeholder-green-800/40 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>

{((invoiceGroup !== "recent" && groups.length === 0) || (invoiceGroup === "recent" && searched.length === 0)) && (
                    <div className="text-center py-16 text-green-800/50">
                      <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      {q || invRange !== "all" ? "No invoices match your filters." : "No accepted or completed orders yet."}
                    </div>
                  )}

                  {invoiceGroup === "recent" ? (
                    <div className="space-y-3">
                      {searched.map((o) => (
                        <div key={o.id} className="border border-green-200 bg-white rounded-xl p-4 shadow-sm">
                          <div className="flex flex-wrap justify-between gap-2 items-start mb-3">
                            <div>
                              <div className="font-mono text-xs text-amber-600">{o.invoiceId || o.id}</div>
                              <div className="font-mono text-xs text-green-800/50 mt-0.5">{o.id}</div>
                              <div className="text-green-950 font-semibold mt-1">{o.customer.name}</div>
                              <div className="flex items-center gap-1.5 text-green-800/70 text-xs mt-0.5">
                                <Phone className="w-3 h-3" /> {o.customer.phone}
                                <span className="ml-2 px-1.5 py-0.5 rounded bg-green-100 text-green-800">{o.customer.mode}</span>
                              </div>
                              <div className="text-green-800/60 text-xs mt-0.5">{fmtDate(o.createdAt)}</div>
                            </div>
                            <div className="text-right">
                              <StatusPill status={o.status} />
                              <div className="font-semibold text-amber-600 mt-2">{rupee(o.total)}</div>
                            </div>
                          </div>
<div className="border-t border-green-100 pt-3 space-y-1">
                            {o.items.map((i) => (
                              <div key={i.id} className="flex justify-between text-sm text-green-900">
                                <span>{i.name} × {i.qty}</span>
                                <span>{rupee(i.price * i.qty)}</span>
                              </div>
                            ))}
                          </div>
                          <div className="flex flex-wrap justify-end gap-2 mt-3 pt-3 border-t border-green-100">
                            <button
                              onClick={() => shareInvoiceOnWhatsApp(o.id, o.customer.phone, o.invoiceShareToken)}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium border border-green-300 text-green-800 hover:bg-green-50"
                            >
                              <Share2 className="w-3.5 h-3.5" /> Share on WhatsApp
                            </button>
                            <button
                              onClick={() => downloadInvoice(o.id)}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium border border-amber-300 text-amber-700 hover:bg-amber-50"
                            >
                              <Download className="w-3.5 h-3.5" /> Download PDF
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {groups.map(([key, list]) => {
                        const groupTotal = list.reduce((s, o) => s + o.total, 0);
                        return (
                          <div key={key}>
                            <div className="flex items-center justify-between mb-2">
                              <h3 className="text-amber-600 text-sm uppercase tracking-widest">{label(key)}</h3>
                              <span className="text-xs text-green-800/60">
                                {list.length} {list.length === 1 ? "invoice" : "invoices"} &middot; {rupee(groupTotal)}
                              </span>
                            </div>
                            <div className="space-y-3">
                              {list.map((o) => (
                                <div key={o.id} className="border border-green-200 bg-white rounded-xl p-4 shadow-sm">
                                  <div className="flex flex-wrap justify-between gap-2 items-start mb-3">
                                    <div>
                                      <div className="font-mono text-xs text-amber-600">{o.invoiceId || o.id}</div>
                                      <div className="font-mono text-xs text-green-800/50 mt-0.5">{o.id}</div>
                                      <div className="text-green-950 font-semibold mt-1">{o.customer.name}</div>
                                      <div className="flex items-center gap-1.5 text-green-800/70 text-xs mt-0.5">
                                        <Phone className="w-3 h-3" /> {o.customer.phone}
                                        <span className="ml-2 px-1.5 py-0.5 rounded bg-green-100 text-green-800">{o.customer.mode}</span>
                                      </div>
                                      <div className="text-green-800/60 text-xs mt-0.5">{fmtDate(o.createdAt)}</div>
                                    </div>
                                    <div className="text-right">
                                      <StatusPill status={o.status} />
                                      <div className="font-semibold text-amber-600 mt-2">{rupee(o.total)}</div>
                                    </div>
                                  </div>
<div className="border-t border-green-100 pt-3 space-y-1">
                                    {o.items.map((i) => (
                                      <div key={i.id} className="flex justify-between text-sm text-green-900">
                                        <span>{i.name} × {i.qty}</span>
                                        <span>{rupee(i.price * i.qty)}</span>
                                      </div>
                                    ))}
                                  </div>
                                  <div className="flex flex-wrap justify-end gap-2 mt-3 pt-3 border-t border-green-100">
                                    <button
                                      onClick={() => shareInvoiceOnWhatsApp(o.id, o.customer.phone, o.invoiceShareToken)}
                                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium border border-green-300 text-green-800 hover:bg-green-50"
                                    >
                                      <Share2 className="w-3.5 h-3.5" /> Share on WhatsApp
                                    </button>
                                    <button
                                      onClick={() => downloadInvoice(o.id)}
                                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium border border-amber-300 text-amber-700 hover:bg-amber-50"
                                    >
                                      <Download className="w-3.5 h-3.5" /> Download PDF
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })()}

        {section === "inventory" && (
          <div className="space-y-6">
            {CATS.map((c) => (
              <div key={c.id}>
                <h3 className="text-amber-600 text-sm uppercase tracking-widest mb-2">{c.name}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {menu.filter((m) => m.cat === c.id).map((item) => {
                    const available = inventory[item.id]?.available !== false;
                    const currentPrice = inventory[item.id]?.price ?? item.price;
                    const priceD = priceDraft[item.id];
                    const stockD = stockDraft[item.id];
                    return (
                      <div key={item.id} className="border border-green-200 bg-white rounded-lg px-3.5 py-2.5 shadow-sm">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div>
                            <div className="text-sm text-green-950">{item.name}</div>
                            <div className="text-xs text-green-800/50">{item.unit}</div>
                          </div>
                          <button
                            onClick={() => toggleAvailability(item.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 ${
                              available ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"
                            }`}
                          >
                            {available ? "In stock" : "Sold out"}
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-green-800/60">₹</span>
                            <input
                              type="number"
                              min="0"
                              step="0.5"
                              placeholder="Price"
                              value={priceD ?? currentPrice}
                              onChange={(e) => setPriceDraft((d) => ({ ...d, [item.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter") savePrice(item.id); }}
                              className="w-20 bg-green-50 border border-green-300 rounded-lg px-2 py-1.5 text-sm text-green-950 focus:outline-none focus:ring-2 focus:ring-amber-400"
                            />
                            <button
                              onClick={() => savePrice(item.id)}
                              disabled={priceD === undefined || priceD === ""}
                              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold bg-green-100 text-green-800 hover:bg-green-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Save price"
                            >
                              <Save className="w-3 h-3" />
                            </button>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-green-800/60">Stock</span>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              placeholder="Stock"
                              value={stockD ?? inventory[item.id]?.stock ?? 0}
                              onChange={(e) => setStockDraft((d) => ({ ...d, [item.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter") saveStock(item.id); }}
                              className="w-20 bg-green-50 border border-green-300 rounded-lg px-2 py-1.5 text-sm text-green-950 focus:outline-none focus:ring-2 focus:ring-amber-400"
                            />
                            <button
                              onClick={() => saveStock(item.id)}
                              disabled={stockD === undefined || stockD === ""}
                              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold bg-green-100 text-green-800 hover:bg-green-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Save stock"
                            >
                              <Save className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <p className="text-xs text-green-800/50">
              Stock decrements automatically when an order is accepted. Price is the selling price.
            </p>
          </div>
        )}

        {section === "sales" && (() => {
          const sold = allInvoiceOrders.filter((o) => o.status === "completed" && inRange(o));

          // Range label for the stat section
          const rangeLabel = invRange === "all"
            ? "all time"
            : (() => {
                const { start, end } = rangeBounds(invRange, invRefDate);
                return `${fmtDate(start)} – ${fmtDate(end)}`;
              })();

          // Aggregate items sold within the range
          const itemQty = {};
          sold.forEach((o) => {
            (o.items || []).forEach((i) => {
              itemQty[i.name] = (itemQty[i.name] || 0) + i.qty;
            });
          });

const periodRevenue = sold.reduce((s, o) => s + (o.total || 0), 0);
          const topItems = Object.entries(itemQty)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

          // Group sold orders by day or by week for the breakdown panel.
          const groupSold = (o) => {
            const d = new Date(o.createdAt);
            if (salesGroup === "week") {
              const day = (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
              const weekStart = new Date(d);
              weekStart.setDate(d.getDate() - day);
              weekStart.setHours(0, 0, 0, 0);
              return weekStart.getTime();
            }
            return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
          };
          const byPeriod = new Map();
          sold.forEach((o) => {
            const key = groupSold(o);
            if (!byPeriod.has(key)) byPeriod.set(key, []);
            byPeriod.get(key).push(o);
          });
const periods = Array.from(byPeriod.entries()).sort((a, b) => b[0] - a[0]);
          const periodLabel = (key) => (salesGroup === "day" ? fmtDate(key) : weekLabel(key));

          const statCard = (label, value, sub) => (
            <div className="bg-white border border-green-200 rounded-xl p-4 shadow-sm">
              <div className="text-xs text-green-800/50 uppercase tracking-widest">{label}</div>
              <div className="text-2xl font-bold text-green-950 mt-1">{value}</div>
              {sub && <div className="text-xs text-green-800/60 mt-1">{sub}</div>}
            </div>
          );

          return (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <div>
                  <h2 className="text-green-950 text-lg font-semibold" style={{ fontFamily: "var(--font-serif)" }}>Sales</h2>
<p className="text-green-800/50 text-xs mt-0.5">
                    Based on completed orders &middot; {rangeLabel}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {RangeFilter}
                  <div className="flex gap-2">
                    {[
                      { id: "day", label: "By day" },
                      { id: "week", label: "By week" },
                    ].map((g) => (
                      <button
                        key={g.id}
                        onClick={() => setSalesGroup(g.id)}
                        className={`px-3.5 py-2 rounded-lg text-sm font-medium border ${
                          salesGroup === g.id ? "bg-amber-400 text-green-950 border-amber-400" : "border-green-300 bg-white text-green-800"
                        }`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                    {statCard("Orders", sold.length)}
                    {statCard("Revenue", rupee(periodRevenue))}
                    {statCard("Paid", rupee(sold.filter((o) => o.paymentStatus === "paid").reduce((s, o) => s + (o.total || 0), 0)))}
                    {statCard("Unpaid", rupee(sold.filter((o) => o.paymentStatus !== "paid").reduce((s, o) => s + (o.total || 0), 0)))}
                  </div>

                  <div className="bg-white border border-green-200 rounded-xl p-4 shadow-sm">
                    <h3 className="text-amber-600 text-sm uppercase tracking-widest mb-3">Items sold ({rangeLabel})</h3>
                    {topItems.length === 0 && <p className="text-green-800/50 text-sm">No completed orders in this range.</p>}
                    <div className="space-y-2">
                      {topItems.map(([name, qty]) => (
                        <div key={name} className="flex items-center justify-between text-sm">
                          <span className="text-green-950">{name}</span>
                          <span className="text-green-800/70">{qty} sold</span>
                        </div>
                      ))}
                    </div>
                  </div>

<div className="bg-white border border-green-200 rounded-xl p-4 shadow-sm mt-6">
                    <h3 className="text-amber-600 text-sm uppercase tracking-widest mb-3">
                      {salesGroup === "day" ? "Sales by day" : "Sales by week"} ({rangeLabel})
                    </h3>
                    {periods.length === 0 && <p className="text-green-800/50 text-sm">No completed orders in this range.</p>}
                    <div className="space-y-3">
                      {periods.map(([key, list]) => {
                        const periodRevenue = list.reduce((s, o) => s + (o.total || 0), 0);
                        return (
                          <div key={key} className="border-b border-green-100 pb-2 last:border-0">
                            <div className="flex items-center justify-between text-sm">
<span className="text-green-950">{periodLabel(key)}</span>
<span className="text-green-800/70">{list.length} {list.length === 1 ? "order" : "orders"} · {rupee(periodRevenue)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
            </div>
          );
        })()}
      </main>
      <footer className="flex justify-center px-4 pb-8 pt-2">
        <button
          onClick={signOut}
          className="text-sm px-5 py-2 rounded-full bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 transition-colors"
        >
          Sign out
        </button>
      </footer>
    </div>
  );
}
