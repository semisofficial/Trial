import { useEffect, useRef, useState } from "react";
import { MapPin, LocateFixed, Loader2 } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* Fix default marker icon path (Vite/Vercel bundling strips the images) */
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const DEFAULT_CENTER = [10.8505, 76.2711]; // Kerala, India
const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const GEOCODE_DELAY_MS = 1100;
const GEOCODE_CACHE_LIMIT = 100;
const geocodeCache = new Map();

/* Reverse-geocode lat/lng -> readable address using free Nominatim API */
async function reverseGeocode(lat, lng, signal) {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (geocodeCache.has(key)) return geocodeCache.get(key);

  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lng),
    zoom: "17",
    addressdetails: "1",
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
    headers: { "Accept-Language": "en" },
    signal,
  });
  if (!res.ok) throw new Error("Geocode failed");
  const data = await res.json();
  const address = data?.display_name || "";
  if (address) {
    if (geocodeCache.size >= GEOCODE_CACHE_LIMIT) {
      geocodeCache.delete(geocodeCache.keys().next().value);
    }
    geocodeCache.set(key, address);
  }
  return address;
}

export default function LocationPicker({ value, onChange, initial = DEFAULT_CENTER }) {
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const mapElRef = useRef(null);
  const geocodeTimerRef = useRef(null);
  const geocodeAbortRef = useRef(null);
  const geocodeRequestRef = useRef(0);
  const onChangeRef = useRef(onChange);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const selectLocation = (lat, lng) => {
    // Save the coordinates immediately, but wait until movement stops before
    // sharing them with the external address-lookup service.
    onChangeRef.current({ lat, lng });
    clearTimeout(geocodeTimerRef.current);
    geocodeAbortRef.current?.abort();
    const requestId = ++geocodeRequestRef.current;

    geocodeTimerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      geocodeAbortRef.current = controller;
      try {
        const address = await reverseGeocode(lat, lng, controller.signal);
        if (requestId !== geocodeRequestRef.current || !address) return;
        onChangeRef.current({ lat, lng, address });
      } catch (err) {
        if (err?.name !== "AbortError") {
          // Coordinates and the editable address field still remain usable.
          console.warn("Address lookup unavailable");
        }
      }
    }, GEOCODE_DELAY_MS);
  };

  // Init map once
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;
    const startLat = value?.lat ?? initial[0];
    const startLng = value?.lng ?? initial[1];

    const map = L.map(mapElRef.current, { center: [startLat, startLng], zoom: 14, attributionControl: true });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);

    const icon = L.icon({
      iconUrl: markerIcon,
      iconRetinaUrl: markerIcon2x,
      shadowUrl: markerShadow,
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41],
    });

    const marker = L.marker([startLat, startLng], { icon, draggable: true }).addTo(map);

    marker.on("dragend", (e) => {
      const point = e.target.getLatLng();
      selectLocation(point.lat, point.lng);
    });
    map.on("click", (e) => {
      marker.setLatLng(e.latlng);
      selectLocation(e.latlng.lat, e.latlng.lng);
    });

    mapRef.current = map;
    markerRef.current = marker;

    return () => {
      map.remove();
      clearTimeout(geocodeTimerRef.current);
      geocodeAbortRef.current?.abort();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        selectLocation(lat, lng);
        if (mapRef.current && markerRef.current) {
          mapRef.current.setView([lat, lng], 16);
          markerRef.current.setLatLng([lat, lng]);
        }
        setLocating(false);
      },
      (err) => {
        alert(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. You can still drag the pin to your address."
            : "Could not get your location. Drag the pin on the map instead."
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  };

  return (
    <div className="rounded-xl overflow-hidden border border-[#E8D7B5] bg-[#FFF8E8]">
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-[#E8D7B5]">
        <div className="flex items-center gap-1.5 text-[#3F3B24] text-sm font-medium">
          <MapPin className="w-4 h-4 text-[#C8754F]" />
          Pin where to deliver
        </div>
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6F6F32] text-[#FFF8E8] text-xs font-semibold hover:bg-[#575726] transition-colors disabled:opacity-60"
        >
          {locating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LocateFixed className="w-3.5 h-3.5" />}
          {locating ? "Locating…" : "Use my location"}
        </button>
      </div>

      <div ref={mapElRef} className="w-full h-64 md:h-72" />

      <div className="px-3.5 py-3 space-y-1.5">
        <label className="text-xs text-[#6F6657]">Delivery address (auto-filled from pin)</label>
        <textarea
          value={value?.address || ""}
          onChange={(e) => {
            onChange({ ...(value || {}), address: e.target.value });
          }}
          rows={2}
          placeholder="Address appears here when you drop the pin or use your location. You can edit it."
          className="w-full bg-[#FFFCF3] border border-[#E8D7B5] rounded-lg px-3 py-2 text-sm text-[#3F3B24] placeholder-[#9A8E7B] focus:outline-none focus:ring-2 focus:ring-[#C8754F] resize-none"
        />
        {value?.lat != null && value?.lng != null && (
          <p className="text-[11px] text-[#8A806F] font-mono">
            Lat: {value.lat.toFixed(6)}, Lng: {value.lng.toFixed(6)}
          </p>
        )}
        <p className="text-[10px] leading-relaxed text-[#8A806F]">
          OpenStreetMap services receive the selected map area and coordinates to display the map and look up an address.
        </p>
      </div>
    </div>
  );
}

