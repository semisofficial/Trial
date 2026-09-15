import { useEffect, useState } from "react";
import { loadOffers } from "../lib/kitchen.jsx";

export default function OfferLinks() {
  const [offers, setOffers] = useState([]);
  useEffect(() => {
    let cancelled = false;
    loadOffers().then((response) => {
      if (!cancelled) setOffers(response.data.map((offer) => ({ ...offer,
        deadline: performance.now() + new Date(offer.expires_at).getTime() - new Date(response.serverNow).getTime(),
      })));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!offers.length) return;
    const nextExpiry = Math.min(...offers.map((offer) => offer.deadline));
    const timer = setTimeout(() => setOffers((current) => current.filter((offer) => offer.deadline > performance.now())), Math.max(0, nextExpiry - performance.now()));
    return () => clearTimeout(timer);
  }, [offers]);
  if (!offers.length) return null;
  return <nav aria-label="Limited-time offers" className="bg-[#FFF8E8] px-5 py-5 flex flex-wrap justify-center gap-3">
    {offers.map((offer) => <a key={offer.slug} href={`/o/${offer.slug}`} className="bg-[#6F6F32] text-white rounded-xl px-5 py-3 font-semibold">{offer.title} · View offer</a>)}
  </nav>;
}
