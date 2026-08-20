import { lazy, Suspense, useState, useEffect, useCallback, useMemo } from "react";
import {
  ShoppingBag,
  Plus,
  Minus,
  X,
  Check,
} from "lucide-react";

import {
  FONTS,
  CATS,
  rupee,
  resolveImg,
  loadMenu,
  loadMenuStored,
  createOrder,
} from "./lib/kitchen.jsx";

const LocationPicker = lazy(() => import("./components/LocationPicker.jsx"));

/* ---------------------------------------------------------
   Delivery time slots: hourly ranges from 11 AM to 9 PM.
--------------------------------------------------------- */
function formatHour12(h) {
  const period = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:00 ${period}`;
}
const DELIVERY_SLOTS = Array.from({ length: 10 }, (_, i) => {
  const startHour = 11 + i; // 11 AM .. 8 PM
  const endHour = startHour + 1; // 12 PM .. 9 PM
  return { id: `${startHour}-${endHour}`, label: `${formatHour12(startHour)} – ${formatHour12(endHour)}` };
});
/* Today's date in YYYY-MM-DD, for the date input's min attribute */
function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}
/* iOS Safari renders an empty <input type="date"> as a blank box with no
   placeholder text (unlike Chrome/Android/desktop, which show "dd/mm/yyyy"
   on their own). Only iOS needs a manual placeholder overlay — showing one
   everywhere else double-renders on top of the browser's real placeholder. */
const IS_IOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);

/* ---------------------------------------------------------
   Customer: Menu + Cart + Checkout
--------------------------------------------------------- */
function CustomerApp({ menu, inventory, menuState, liveReady, onRetryMenu }) {
  const [tab, setTab] = useState("fried");
  const [cart, setCart] = useState({});
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState(null);
  const [form, setForm] = useState({ name: "", phone: "", address: "", notes: "", mode: "Delivery", location: null, paymentMethod: "cod", deliveryDate: "", deliverySlot: "" });
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [stockError, setStockError] = useState(null);
  const [slide, setSlide] = useState(0);
  const [previousSlide, setPreviousSlide] = useState(null);

  const menuSlides = useMemo(
    () => {
      const seen = new Set();
      return menu
        .map((item) => ({ src: resolveImg(item.img), name: item.name }))
        .filter((item) => {
          if (!item.src || seen.has(item.src)) return false;
          seen.add(item.src);
          return true;
        });
    },
    [menu]
  );
  const heroCount = menuSlides.length;
  const activeSlide = heroCount > 0 ? slide % heroCount : 0;
  useEffect(() => {
    if (heroCount <= 1) return;
    let next = activeSlide;
    while (next === activeSlide) next = Math.floor(Math.random() * heroCount);

    // Download only the upcoming slide, instead of mounting every menu photo
    // at zero opacity and making the browser fetch the entire catalog.
    const preload = new Image();
    preload.src = menuSlides[next].src;

    const timer = setTimeout(() => {
      setPreviousSlide(activeSlide);
      setSlide(next);
    }, 5000);
    return () => clearTimeout(timer);
  }, [activeSlide, heroCount, menuSlides]);

  const isAvailable = (id) => inventory[id]?.available !== false;

  // Effective price: prefer admin override stored in inventory, else MENU price
  const priceOf = (item) => (inventory[item.id]?.price != null ? inventory[item.id].price : item.price);
  // The public menu response includes the current inventory overlay. Admin
  // inventory management still uses its dedicated protected mutation route.
  const stockOf = (item) => {
    const stock = Number(inventory[item.id]?.stock ?? item.stock);
    return Number.isFinite(stock) && stock >= 0 ? stock : null;
  };

  const addItem = (item) => {
    if (!liveReady) return;
    if (!isAvailable(item.id)) return;
    const step = item.step || 1;
    const minQty = item.minQty || step;
    const availableStock = stockOf(item);
    const currentQty = cart[item.id] || 0;
    const proposedQty = currentQty === 0 ? minQty : currentQty + step;
    if (availableStock !== null && proposedQty > availableStock) {
      setStockError(item.id);
      return;
    }
    setStockError((currentError) => (currentError === item.id ? null : currentError));
    setCart((c) => {
      const current = c[item.id] || 0;
      const next = current === 0 ? minQty : current + step;
      if (availableStock !== null && next > availableStock) return c;
      return { ...c, [item.id]: Math.round(next * 100) / 100 };
    });
  };
  const decItem = (id, item) => {
    setCart((c) => {
      const next = { ...c };
      if (!next[id]) return next;
      const step = item?.step || 1;
      const minQty = item?.minQty || 1;
      next[id] = Math.round((next[id] - step) * 100) / 100;
      if (next[id] < minQty) delete next[id];
      setStockError((currentError) => (currentError === id ? null : currentError));
      return next;
    });
  };

  const cartLines = Object.entries(cart)
    .map(([id, qty]) => {
      const base = menu.find((m) => m.id === id);
      if (!base) return null;
      return { ...base, qty, price: priceOf(base) };
    })
    .filter(Boolean);
  const cartCount = cartLines.reduce((s, l) => s + l.qty, 0);
  const cartTotal = cartLines.reduce((s, l) => s + l.qty * l.price, 0);
  const overstockedLine = cartLines.find((line) => {
    const stock = stockOf(line);
    return stock !== null && line.qty > stock;
  });

  const submitOrder = async () => {
    if (!liveReady) {
      setErrorMsg("Please wait while we confirm current prices and availability.");
      return;
    }
    if (overstockedLine) {
      setStockError(overstockedLine.id);
      setErrorMsg(`Insufficient stock for ${overstockedLine.name}. Only ${stockOf(overstockedLine)} available.`);
      return;
    }
    const hasLocation = form.location?.lat != null && form.location?.lng != null;
    if (
      !form.name.trim() ||
      !form.phone.trim() ||
      !form.deliveryDate ||
      !form.deliverySlot ||
      (form.mode === "Delivery" && !form.address.trim() && !hasLocation)
    )
      return;
    setSubmitting(true);
    const order = {
      items: cartLines.map((l) => ({ id: l.id, qty: l.qty })),
      customer: {
        name: form.name.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        notes: form.notes.trim(),
        mode: form.mode,
        location: form.location || null,
        paymentMethod: form.paymentMethod,
        deliveryDate: form.deliveryDate,
        deliverySlot: form.deliverySlot,
      },
    };
    try {
      const created = await createOrder(order);
      order.id = created.id;
      order.invoiceId = created.invoice_id;
      order.total = Number(created.total);
      order.items = created.items;
      order.status = created.status;
      order.createdAt = new Date(created.created_at).getTime();
    } catch (err) {
      console.error("Failed to place order:", err);
      setSubmitting(false);
      setErrorMsg([400, 409, 429, 503].includes(err.status)
        ? err.message
        : "Sorry, we couldn't place your order. Please check your details or connection and try again.");
      return;
    }
    setSubmitting(false);
    setErrorMsg("");
    setCart({});
    setCheckoutOpen(false);
    setCartOpen(false);
    // Reset the delivery form so a new customer's checkout doesn't show the
    // previous order's name/phone/address/notes/location.
    setForm((f) => ({ name: "", phone: "", address: "", notes: "", mode: f.mode, location: null, paymentMethod: f.paymentMethod, deliveryDate: "", deliverySlot: "" }));
    setConfirmedOrder(order);
  };

  const itemsForTab = useMemo(() => menu.filter((m) => m.cat === tab), [menu, tab]);

  return (
    <div className="customer-editorial min-h-screen bg-[#F6EDD7] text-[#3F3B24]" style={{ fontFamily: "var(--font-sans)" }}>
      <style>{`${FONTS}\n@keyframes heroCrossfade { from { opacity: 0; } to { opacity: 1; } }\n@media (prefers-reduced-motion: reduce) { .hero-slide-enter { animation: none !important; } }`}</style>

      {/* Hero */}
      <header className="relative overflow-hidden bg-[#F6EDD7]">
        <nav className="relative z-10 w-full px-5 sm:px-8 py-5 flex items-center justify-center text-center bg-[#6F6F32] shadow-[0_8px_24px_rgba(63,59,36,0.12)]">
          <a href="#top" className="text-2xl sm:text-3xl text-[#FFF8E8]" style={{ fontFamily: "var(--font-serif)", fontWeight: 700 }}>
            SEMI'S KITCHEN
          </a>
        </nav>

        <div id="top" className="relative max-w-6xl mx-auto px-5 sm:px-8 pt-6 pb-16 sm:pt-12 sm:pb-24 grid lg:grid-cols-[0.95fr_1.05fr] gap-12 lg:gap-16 items-center">
          <div className="relative z-10 text-center lg:text-left">
            <h1 className="text-[2.75rem] leading-[1.02] sm:text-6xl lg:text-7xl text-[#3F3B24] tracking-[-0.035em]" style={{ fontFamily: "var(--font-serif)", fontWeight: 600 }}>
              Authentic Malabar food, made with a little more love.
            </h1>
            <p className="mt-6 max-w-xl mx-auto lg:mx-0 text-[#6F6657] text-base sm:text-lg leading-relaxed">
              Hand-prepared snacks, fragrant biriyanis and comforting curries, made fresh for your table.
            </p>
          </div>

          <div className="relative mx-auto w-[84%] sm:w-full max-w-[600px]">
            <div className="absolute -inset-3 sm:-inset-8 bg-[#D99168] rounded-[42%_58%_55%_45%/48%_42%_58%_52%] rotate-[-4deg]" />
            <div className="relative aspect-[4/3] sm:aspect-[5/4] overflow-hidden rounded-[38%_62%_52%_48%/45%_40%_60%_55%] shadow-[0_24px_60px_rgba(63,59,36,0.22)]">
              {menuSlides.length > 0 ? (
                <>
                  {previousSlide !== null && menuSlides[previousSlide] && previousSlide !== activeSlide && (
                    <img
                      key={`previous-${menuSlides[previousSlide].src}`}
                      src={menuSlides[previousSlide].src}
                      alt=""
                      aria-hidden="true"
                      decoding="async"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  )}
                  <img
                    key={menuSlides[activeSlide].src}
                    src={menuSlides[activeSlide].src}
                    alt={menuSlides[activeSlide].name}
                    loading="eager"
                    fetchPriority="high"
                    decoding="async"
                    className="hero-slide-enter absolute inset-0 w-full h-full object-cover"
                    style={{ animation: "heroCrossfade 900ms ease-in-out both" }}
                    onAnimationEnd={() => setPreviousSlide(null)}
                  />
                </>
              ) : (
                <div className="w-full h-full bg-[#E8D7B5]" />
              )}
            </div>
          </div>
        </div>

      </header>

      {/* Category tabs */}
      <section id="menu" className="bg-[#FFF8E8] pt-14 sm:pt-20">
        <div className="max-w-5xl mx-auto px-4 flex justify-center gap-2 overflow-x-auto pb-2">
          {CATS.map((c) => {
            const active = tab === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setTab(c.id)}
                className={`px-4 sm:px-5 py-2.5 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap border transition-colors ${
                  active ? "bg-[#6F6F32] border-[#6F6F32] text-[#FFF8E8]" : "border-[#E8D7B5] text-[#6F6657] hover:border-[#C8754F] hover:text-[#3F3B24]"
                }`}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      </section>

      {/* Menu grid */}
      <main className="max-w-6xl mx-auto px-4 sm:px-8 pt-8 pb-32 bg-[#FFF8E8]">
        {tab === "mains" && (
          <p className="mb-6 text-sm text-[#7D4A32] bg-[#D99168]/15 border border-[#C8754F]/25 rounded-2xl px-4 py-3 text-center">
            Please note: same-day delivery is not available for Biriyani &amp; Curry items.
          </p>
        )}
        {menuState === "stale" && (
          <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-center text-sm text-amber-800">
            Live updates are temporarily unavailable. The saved menu is available to browse, but ordering is paused until prices and stock are confirmed.
            <button onClick={onRetryMenu} className="ml-2 underline font-semibold">Retry</button>
          </div>
        )}
        {!liveReady && menuState !== "stale" && (
          <div className="mb-5 rounded-xl border border-[#E8D7B5] bg-[#FFFCF3] px-4 py-3 text-center text-sm text-[#6F6657]" role="status">
            Checking current prices and availability… You can browse while we refresh.
          </div>
        )}
        {/* Menu grid — skeleton while the first load is in flight, a friendly
            offline message (with retry) if it failed, else the real items. */}
        {menu.length === 0 ? (
          menuState === "error" ? (
            <div className="rounded-xl border border-green-800 bg-green-900/40 p-8 text-center">
              <p className="text-stone-200 font-medium">We couldn't load the menu right now.</p>
              <p className="text-stone-500 text-sm mt-1">Please check your connection and try again.</p>
              <button
                onClick={onRetryMenu}
                className="mt-4 px-4 py-2 rounded-lg bg-amber-400 text-green-950 text-sm font-semibold hover:bg-amber-300 transition-colors"
              >
                Try again
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-busy="true" aria-label="Loading menu">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-green-900 bg-green-900/40 overflow-hidden animate-pulse"
                >
                  <div className="w-full h-36 bg-green-800/60" />
                  <div className="p-4 space-y-2">
                    <div className="h-3 w-2/3 rounded bg-green-800/60" />
                    <div className="h-3 w-1/3 rounded bg-green-800/60" />
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
          {itemsForTab.map((item) => {
            const available = isAvailable(item.id);
            const qty = cart[item.id] || 0;
            return (
              <div
                key={item.id}
                className={`group rounded-[1.5rem] border border-[#E8D7B5]/80 bg-[#FFFCF3] overflow-hidden shadow-[0_10px_28px_rgba(82,67,43,0.07)] transition-transform duration-300 hover:-translate-y-1 ${
                  !available ? "opacity-50" : ""
                }`}
              >
                {/* Item image */}
                <div className="w-full h-48 sm:h-52 bg-[#E8D7B5] overflow-hidden">
                  <img
                    src={resolveImg(item.img)}
                    alt={item.name}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    onError={(e) => {
                      e.target.style.display = "none";
                      e.target.nextElementSibling?.classList.remove("hidden");
                    }}
                  />
                  <div className="hidden w-full h-full flex items-center justify-center text-stone-600 text-xs">
                    No image
                  </div>
                </div>
                <div className="p-4 flex items-center justify-between gap-3">
                  <div>
                  <div className="text-lg text-[#3F3B24]" style={{ fontFamily: "var(--font-serif)", fontWeight: 600 }}>
                      {item.name}
                      <span className="text-stone-500 text-xs ml-1.5">{item.unit}</span>
                    </div>
                    <div className="text-[#C8754F] text-sm font-semibold mt-1">
                      {rupee(priceOf(item))}
                      {item.minQty > 1 && (
                        <span className="text-stone-500 text-xs ml-1.5">
                          · min {item.minQty}{/piece/i.test(item.unit) ? " pieces" : ""}
                        </span>
                      )}
                      {item.seasonal && <span className="text-stone-500 text-xs ml-1.5">· seasonal price</span>}
                    </div>
                    {!available && <div className="text-red-400 text-xs mt-1 font-medium">Sold out today</div>}
                    {stockError === item.id && (
                      <div className="text-red-600 text-xs mt-1 font-semibold" role="alert">
                        Insufficient stock. Only {stockOf(item) ?? 0} available.
                      </div>
                    )}
                  </div>
                  {liveReady && available ? (
                    qty > 0 ? (
                      <div className="flex items-center gap-2 bg-green-950 rounded-lg border border-green-800 px-1 py-1 shrink-0">
                        <button onClick={() => decItem(item.id, item)} className="w-7 h-7 flex items-center justify-center text-stone-300 hover:text-amber-300">
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-5 text-center text-sm font-semibold">{qty}</span>
                        <button onClick={() => addItem(item)} className="w-7 h-7 flex items-center justify-center text-stone-300 hover:text-amber-300">
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => addItem(item)}
                        className="shrink-0 px-3.5 py-1.5 rounded-lg bg-amber-400 text-green-950 text-sm font-semibold hover:bg-amber-300 transition-colors"
                      >
                        Add
                      </button>
                    )
                  ) : liveReady ? (
                    <div className="shrink-0 px-3.5 py-1.5 rounded-lg bg-green-800 text-stone-500 text-sm font-semibold">Sold out</div>
                  ) : (
                    <div className="shrink-0 px-3.5 py-1.5 rounded-lg bg-[#E8D7B5] text-[#6F6657] text-xs font-semibold">Checking…</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        )}
      </main>

      {/* Floating cart bar */}
      {cartCount > 0 && !cartOpen && !checkoutOpen && !confirmedOrder && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-[#6F6F32] text-[#FFF8E8] px-6 py-3.5 rounded-full shadow-[0_14px_36px_rgba(63,59,36,0.28)] font-semibold hover:bg-[#575726] transition-colors"
        >
          <ShoppingBag className="w-5 h-5" />
          {rupee(cartTotal)}
        </button>
      )}

      {/* Cart drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setCartOpen(false)} />
          <div className="relative w-full sm:w-[420px] bg-green-950 border-l border-green-900 h-full flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-green-900">
              <h2 className="text-lg font-semibold text-stone-50" style={{ fontFamily: "var(--font-serif)" }}>Your order</h2>
              <button onClick={() => setCartOpen(false)}><X className="w-5 h-5 text-stone-400" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {cartLines.length === 0 && <p className="text-stone-500 text-sm">Your cart is empty.</p>}
              {cartLines.map((l) => (
                <div key={l.id} className="flex flex-col gap-2 border-b border-green-900/60 pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-stone-100 text-sm font-medium">{l.name}</div>
                      <div className="text-stone-500 text-xs">{rupee(l.price)} {l.unit}</div>
                    </div>
                    <div className="flex items-center gap-2 bg-green-900 rounded-lg border border-green-800 px-1 py-1">
                      <button onClick={() => decItem(l.id, l)} className="w-6 h-6 flex items-center justify-center text-stone-300"><Minus className="w-3 h-3" /></button>
                      <span className="w-8 text-center text-sm">{l.qty}</span>
                      <button onClick={() => addItem(l)} className="w-6 h-6 flex items-center justify-center text-stone-300"><Plus className="w-3 h-3" /></button>
                    </div>
                  </div>
                  <div className="text-right text-sm text-amber-400 font-semibold">{rupee(l.qty * l.price)}</div>
                  {stockError === l.id && (
                    <div className="text-right text-red-600 text-xs font-semibold" role="alert">
                      Insufficient stock. Only {stockOf(l) ?? 0} available.
                    </div>
                  )}
                </div>
              ))}
            </div>
            {cartLines.length > 0 && (
              <div className="border-t border-green-900 p-5 space-y-3">
                <div className="flex justify-between text-stone-200 font-semibold">
                  <span>Total</span>
                  <span className="text-amber-400">{rupee(cartTotal)}</span>
                </div>
                <button
                  onClick={() => {
                    if (overstockedLine) {
                      setStockError(overstockedLine.id);
                      return;
                    }
                    setCartOpen(false);
                    setCheckoutOpen(true);
                  }}
                  className="w-full py-3 rounded-lg bg-amber-400 text-green-950 font-semibold hover:bg-amber-300 transition-colors"
                >
                  Proceed to checkout
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Checkout modal */}
      {checkoutOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setCheckoutOpen(false)} />
          <div className="relative bg-green-950 border border-green-900 rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-stone-50" style={{ fontFamily: "var(--font-serif)" }}>Delivery details</h2>
              <button onClick={() => setCheckoutOpen(false)}><X className="w-5 h-5 text-stone-400" /></button>
            </div>
            <div className="flex gap-2 mb-4">
              {["Delivery", "Pickup"].map((m) => (
                <button
                  key={m}
                  onClick={() => setForm((f) => ({ ...f, mode: m }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                    form.mode === m ? "bg-amber-400 text-green-950 border-amber-400" : "border-green-800 text-stone-300"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
{form.mode === "Delivery" && (
              <p className="mb-4 text-sm text-amber-300/90 bg-amber-400/10 border border-amber-400/30 rounded-lg px-3 py-2">
                Delivery charge is not included in the bill.
              </p>
            )}
<div className="mb-4">
              <div className="flex gap-2">
                {[
                  { id: "cod", label: "Cash on Delivery" },
                  { id: "upi", label: "UPI" },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, paymentMethod: p.id }))}
                    className={`flex-1 py-2.5 px-2 rounded-lg text-sm font-medium border ${
                      form.paymentMethod === p.id ? "bg-amber-400 text-green-950 border-amber-400" : "border-green-800 text-stone-300"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {form.paymentMethod === "upi" && (
                <p className="mt-2 text-sm text-amber-300/90 bg-amber-400/10 border border-amber-400/30 rounded-lg px-3 py-2">
                  A QR code will be sent to your provided phone number to complete the payment.
                </p>
              )}
            </div>
            <div className="space-y-3">
              <input
                placeholder="Full name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full bg-green-900/60 border border-green-800 rounded-lg px-3.5 py-2.5 text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <input
                placeholder="Phone number"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full bg-green-900/60 border border-green-800 rounded-lg px-3.5 py-2.5 text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              {form.mode === "Delivery" && (
                <Suspense
                  fallback={(
                    <div className="h-80 rounded-xl border border-green-800 bg-green-900/40 flex items-center justify-center text-sm text-stone-400">
                      Loading delivery map…
                    </div>
                  )}
                >
                  <LocationPicker
                    value={form.location}
                    onChange={(loc) =>
                      setForm((f) => {
                        const merged = { ...(f.location || {}), ...loc };
                        return { ...f, location: merged, address: merged.address || f.address };
                      })
                    }
                  />
                </Suspense>
              )}
              <div>
                <label className="text-xs text-stone-400 mb-1.5 block">When should the order arrive?</label>
                <div className="relative overflow-hidden rounded-lg">
                  <input
                    type="date"
                    min={todayISO()}
                    value={form.deliveryDate}
                    onChange={(e) => setForm((f) => ({ ...f, deliveryDate: e.target.value }))}
                    style={{ WebkitAppearance: "none", appearance: "none", boxSizing: "border-box" }}
                    className="block w-full max-w-full bg-green-900/60 border border-green-800 rounded-lg px-3.5 py-2.5 text-sm text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-400 [color-scheme:dark]"
                  />
                  {IS_IOS && !form.deliveryDate && (
                    <span className="absolute inset-y-0 left-3.5 flex items-center text-sm text-stone-500 pointer-events-none">
                      Select a date
                    </span>
                  )}
                </div>
                {/* A native <select> so mobile OSes render their own picker —
                    iOS shows an actual spinning wheel, Android a scrollable
                    list — instead of a custom-built one. */}
                <select
                  value={form.deliverySlot}
                  onChange={(e) => setForm((f) => ({ ...f, deliverySlot: e.target.value }))}
                  className="mt-2 w-full bg-green-900/60 border border-green-800 rounded-lg px-3.5 py-2.5 text-sm text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-400 [color-scheme:dark]"
                >
                  <option value="" disabled>
                    Select a time slot
                  </option>
                  {DELIVERY_SLOTS.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {slot.label}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                placeholder="Notes (spice level, allergies, etc.) — optional"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="w-full bg-green-900/60 border border-green-800 rounded-lg px-3.5 py-2.5 text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
              />
            </div>
            <div className="flex justify-between items-center mt-4 mb-1 text-stone-200">
              <span className="text-sm">Order total</span>
              <span className="font-semibold text-amber-400">{rupee(cartTotal)}</span>
            </div>
            {errorMsg && (
              <p className="text-red-400 text-sm mt-2">{errorMsg}</p>
            )}
            <button
              disabled={
                submitting ||
                !liveReady ||
                !form.name.trim() ||
                !form.phone.trim() ||
                !form.deliveryDate ||
                !form.deliverySlot ||
                (form.mode === "Delivery" && !form.address.trim() && !(form.location?.lat != null && form.location?.lng != null))
              }
              onClick={submitOrder}
              className="w-full mt-3 py-3 rounded-lg bg-amber-400 text-green-950 font-semibold hover:bg-amber-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? "Placing order…" : "Place order"}
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="relative bg-[#3F3B24] text-[#FFF8E8] px-5 pt-16 pb-10 text-center overflow-hidden">
        <div className="absolute -top-8 left-[-5%] w-[110%] h-16 bg-[#FFF8E8] rounded-[50%]" aria-hidden="true" />
        <div className="relative">
          <div className="text-3xl mb-2" style={{ fontFamily: "var(--font-serif)", fontWeight: 600 }}>Semi's Kitchen</div>
          <p className="text-[#E8D7B5] text-sm">Malabar snacks &amp; curries, made to order</p>
          <p className="mt-8 text-xs text-[#E8D7B5]/55">Built by <span className="font-semibold tracking-[0.16em]">QOZYD</span></p>
        </div>
      </footer>

      {/* Confirmation */}
      {confirmedOrder && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" />
          <div className="relative bg-green-950 border border-green-900 rounded-2xl w-full max-w-sm p-6 text-center">
            <div className="w-14 h-14 rounded-full bg-amber-400 flex items-center justify-center mx-auto mb-4">
              <Check className="w-7 h-7 text-green-950" />
            </div>
            <h2 className="text-xl font-semibold text-stone-50 mb-1" style={{ fontFamily: "var(--font-serif)" }}>Order sent!</h2>
            <p className="text-stone-400 text-sm mb-4">We'll confirm on WhatsApp/call shortly. Keep these IDs for your reference.</p>
            <div className="bg-green-900/60 border border-green-800 rounded-lg py-2.5 text-amber-300 font-mono tracking-wider text-sm mb-2">
              {confirmedOrder.id}
            </div>
            <div className="bg-green-900/60 border border-green-800 rounded-lg py-2.5 text-amber-300 font-mono tracking-wider text-sm mb-5">
              {confirmedOrder.invoiceId}
            </div>
            <button
              onClick={() => setConfirmedOrder(null)}
              className="w-full py-3 rounded-lg bg-amber-400 text-green-950 font-semibold hover:bg-amber-300 transition-colors"
            >
              Back to menu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   Homepage (customer site)
--------------------------------------------------------- */
export default function App() {
  // Hybrid: start from the locally-cached catalog so the menu paints instantly
  // even before the backend responds, then overlay the live inventory (price /
  // stock / availability) via the refresh below. Falls back to an empty array
  // on the very first visit (no cache yet), same as before.
  const [menu, setMenu] = useState(() => loadMenuStored());
  const [inventory, setInventory] = useState({});
  const [liveReady, setLiveReady] = useState(false);
  // "ready" if a cached catalog is already onscreen to show, else "loading".
  // Only the very first visit (no cache yet) ever shows the loading skeleton;
  // returning visitors start "ready" and the live refresh just updates in place.
  const [menuState, setMenuState] = useState(() => (menu.length ? "ready" : "loading"));

  const refreshMenu = useCallback(async () => {
    setLiveReady(false);
    setMenuState("loading");
    try {
      const liveMenu = await loadMenu();
      setMenu(liveMenu);
      setInventory(Object.fromEntries(liveMenu.map((item) => [item.id, {
        stock: item.stock,
        available: item.available,
        price: item.price,
      }])));
      setLiveReady(true);
      setMenuState("ready");
    } catch {
      setLiveReady(false);
      setMenu((current) => {
        setMenuState(current.length ? "stale" : "error");
        return current;
      });
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      refreshMenu();
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshMenu]);

  return (
    <CustomerApp
      menu={menu}
      inventory={inventory}
      menuState={menuState}
      liveReady={liveReady}
      onRetryMenu={() => refreshMenu()}
    />
  );
}
