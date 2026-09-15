import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { CustomerApp } from "../App.jsx";
import { loadMenu, loadOffers } from "../lib/kitchen.jsx";

export default function OfferPage() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadOffers(slug), loadMenu()]).then(([response, menu]) => {
      if (cancelled) return;
      const expiresIn = new Date(response.data.expires_at) - new Date(response.serverNow);
      const offerMenu = response.data.items.map((deal) => {
        const item = menu.find((entry) => entry.id === deal.id);
        return item ? { ...item, minQty: deal.minQty, price: deal.price } : null;
      }).filter(Boolean);
      setData({ offer: response.data, menu: offerMenu, deadline: performance.now() + expiresIn });
      setRemaining(expiresIn);
    }).catch((failure) => { if (!cancelled) setError(failure.message); });
    return () => { cancelled = true; };
  }, [slug]);
  useEffect(() => {
    if (!data) return;
    const timer = setInterval(() => setRemaining(data.deadline - performance.now()), 1000);
    return () => clearInterval(timer);
  }, [data]);
  useEffect(() => {
    const robots = document.querySelector('meta[name="robots"]');
    const previous = robots?.content;
    if (robots) robots.content = "noindex, follow";
    return () => { if (robots) robots.content = previous; };
  }, []);
  if (error) return <main className="min-h-screen bg-[#F6EDD7] text-[#3F3B24] flex items-center justify-center p-6 text-center"><div><h1 className="text-3xl font-bold">Offer unavailable</h1><p className="my-4">{error}</p><a className="underline" href="/">Order from the regular menu</a></div></main>;
  if (!data) return <p className="p-8" role="status">Loading offer…</p>;
  return <><div className="bg-[#6F6F32] text-white text-center p-3">{remaining > 0 ? <>Offer closes in {Math.max(0, Math.floor(remaining / 3600000))}h {Math.max(0, Math.floor(remaining / 60000) % 60)}m</> : "Offer closed. An unchanged pending checkout can still be retried to check its result."}</div>
    <CustomerApp key={slug} menu={data.menu} inventory={{}} menuState="ready" liveReady={remaining > 0} offerExpired={remaining <= 0} offer={data.offer} onRetryMenu={() => {}} />
  </>;
}
