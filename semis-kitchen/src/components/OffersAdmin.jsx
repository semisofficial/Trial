import { useEffect, useState } from "react";
import { loadOffers, publishOffer, closeOffer, rupee } from "../lib/kitchen.jsx";

export default function OffersAdmin({ menu }) {
  const [title, setTitle] = useState("Weekend snack offer");
  const [selected, setSelected] = useState({});
  const [offers, setOffers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { loadOffers().then((response) => setOffers(response.data)).catch((error) => setMessage(error.message)); }, []);
  const update = (id, field, value) => setSelected((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
  const publish = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const offer = await publishOffer({ title, items: Object.entries(selected).map(([id, values]) => ({ id, minQty: Number(values.minQty), price: Number(values.price) })) });
      setOffers((current) => [offer, ...current]); setSelected({});
      setMessage("Offer published. Its link closes automatically after 24 hours.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return <div className="space-y-6 text-green-950">
    <form onSubmit={publish} className="rounded-xl bg-white border border-green-200 p-5 space-y-4">
      <h2 className="text-xl font-semibold">Publish a 24-hour snack offer</h2>
      <p className="text-sm">Choose snacks, a minimum quantity for each, and its discounted price per piece. The 24 hours start when you publish.</p>
      <label className="block">Offer title<input required maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} className="block mt-1 border rounded-lg p-2 w-full" /></label>
      <div className="space-y-3">
        {menu.filter((item) => ["fried", "frozen"].includes(item.cat)).map((item) => <div key={item.id} className="border rounded-lg p-3">
          <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(selected[item.id])} onChange={(event) => setSelected((current) => {
            const next = { ...current };
            if (event.target.checked) next[item.id] = { minQty: item.minQty, price: "" }; else delete next[item.id];
            return next;
          })} />{item.name} · {item.cat} · Regular {rupee(item.price)}</label>
          {selected[item.id] && <div className="mt-3 flex flex-wrap gap-4">
            <label className="text-sm">Minimum pieces<input required type="number" min={item.minQty} max={10000} step={item.step} value={selected[item.id].minQty} onChange={(e) => update(item.id, "minQty", e.target.value)} className="block border rounded p-2 w-28" /></label>
            <label className="text-sm">Offer ₹ per piece<input required type="number" min="0.01" max={Math.max(0, item.price - 0.01)} step="0.01" value={selected[item.id].price} onChange={(e) => update(item.id, "price", e.target.value)} className="block border rounded p-2 w-28" /></label>
          </div>}
        </div>)}
      </div>
      <button disabled={busy || !Object.keys(selected).length} className="bg-green-800 text-white rounded-lg px-5 py-3 disabled:opacity-40">{busy ? "Publishing…" : "Publish for 24 hours"}</button>
    </form>
    {message && <p role="status" className="p-3 rounded-lg bg-amber-100">{message}</p>}
    <h2 className="text-lg font-semibold">Published offers</h2>
    {offers.map((offer) => {
      const link = new URL(`/o/${encodeURIComponent(offer.slug)}`, window.location.origin).href;
      return <article key={offer.slug} className="border rounded-lg bg-white p-4 space-y-2">
        <h3 className="font-semibold">{offer.title}</h3>
        <p className="text-sm">Closes {new Date(offer.expires_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</p>
        <a href={link} target="_blank" rel="noreferrer" className="block underline break-all">{link}</a>
        <div className="flex flex-wrap gap-3">
          <button className="border rounded px-3 py-2" onClick={async () => { try { await navigator.clipboard.writeText(link); setMessage("Offer link copied."); } catch { setMessage(`Copy this link: ${link}`); } }}>Copy link</button>
          <a className="border rounded px-3 py-2" href={`https://wa.me/?text=${encodeURIComponent(`${offer.title}\n${link}`)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
          <button className="border rounded px-3 py-2 text-red-700" onClick={async () => {
            try { await closeOffer(offer.slug); setOffers((current) => current.filter((entry) => entry.slug !== offer.slug)); setMessage("Offer closed."); }
            catch (error) { setMessage(error.message); }
          }}>Close now</button>
        </div>
      </article>;
    })}
  </div>;
}
