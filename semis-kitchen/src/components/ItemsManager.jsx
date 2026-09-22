import { useCallback, useEffect, useMemo, useState } from "react";
import { CATS, createItem, imageForItem, loadItems, resolveImg, retireItem, updateItem, uploadItemPhoto } from "../lib/kitchen.jsx";

const EMPTY_FORM = { name: "", cat: "fried", unit: "1 piece", minQty: "1", step: "1", isCombo: false };

function fieldsFrom(item) {
  return item ? {
    name: item.name,
    cat: item.cat,
    unit: item.unit,
    minQty: String(item.minQty),
    step: String(item.step),
    isCombo: item.isCombo === true,
  } : { ...EMPTY_FORM };
}

function normalizedFields(form) {
  return {
    name: form.name.trim(),
    cat: form.cat,
    unit: form.unit.trim(),
    minQty: Number(form.minQty),
    step: Number(form.step),
    isCombo: form.cat === "mains" && form.isCombo === true,
  };
}

export default function ItemsManager({ onChanged, onGoToInventory }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState("");
  const [retiring, setRetiring] = useState(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const currentPhoto = editing ? resolveImg(imageForItem(editing)) : null;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await loadItems());
    } catch (error) {
      setMessage(error.message || "Unable to load items");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(refresh, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => (category === "all" || item.cat === category)
      && (!query || item.name.toLowerCase().includes(query)));
  }, [items, search, category]);

  const clearPhoto = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview("");
    setPhoto(null);
  };

  const openEditor = (item = null) => {
    clearPhoto();
    setEditing(item || { id: null });
    setForm(fieldsFrom(item));
    setMessage("");
  };

  const closeEditor = () => {
    if (pending) return;
    clearPhoto();
    setEditing(null);
  };

  const choosePhoto = (file) => {
    setMessage("");
    if (!file) return clearPhoto();
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setMessage("Choose a JPEG or PNG photo.");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setMessage("Photo must be 3 MiB or smaller.");
      return;
    }
    clearPhoto();
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  };

  const validate = (fields) => {
    if (!fields.name || !fields.unit) return "Name and unit are required.";
    if (!CATS.some((cat) => cat.id === fields.cat)) return "Choose a valid category.";
    if (!Number.isFinite(fields.minQty) || fields.minQty <= 0 || !Number.isFinite(fields.step) || fields.step <= 0) {
      return "Minimum quantity and quantity increment must be positive numbers.";
    }
    return "";
  };

  const handleConflict = async (error) => {
    if (error.status !== 409) return false;
    setMessage("This item changed in another session. The latest version has been reloaded; review it before saving again.");
    const latest = await loadItems();
    setItems(latest);
    if (retiring) setRetiring(null);
    if (editing?.id) {
      const current = latest.find((item) => item.id === editing.id);
      if (current) {
        setEditing(current);
        setForm(fieldsFrom(current));
      }
    }
    return true;
  };

  const saveItem = async () => {
    const fields = normalizedFields(form);
    const validation = validate(fields);
    if (validation) return setMessage(validation);
    setPending(true);
    setMessage("");
    try {
      let saved = editing.id
        ? await updateItem(editing.id, fields, editing.revision)
        : await createItem(fields);
      if (photo) {
        try {
          saved = await uploadItemPhoto(saved.id, photo, saved.revision);
        } catch (error) {
          setMessage(`Item details saved, but the photo was not saved: ${error.message}`);
          setEditing(saved);
          setForm(fieldsFrom(saved));
          await refresh();
          await onChanged?.();
          return;
        }
      }
      clearPhoto();
      setEditing(null);
      await refresh();
      await onChanged?.();
    } catch (error) {
      if (!(await handleConflict(error))) setMessage(error.message || "Unable to save item");
    } finally {
      setPending(false);
    }
  };

  const savePhoto = async () => {
    if (!editing?.id || !photo) return;
    setPending(true);
    setMessage("");
    try {
      const saved = await uploadItemPhoto(editing.id, photo, editing.revision);
      setEditing(saved);
      setItems((current) => current.map((item) => item.id === saved.id ? saved : item));
      clearPhoto();
      await onChanged?.();
    } catch (error) {
      if (!(await handleConflict(error))) setMessage(error.message || "Unable to save photo");
    } finally {
      setPending(false);
    }
  };

  const confirmRetire = async () => {
    if (!retiring) return;
    setPending(true);
    setMessage("");
    try {
      await retireItem(retiring.id, retiring.revision);
      setRetiring(null);
      await refresh();
      await onChanged?.();
    } catch (error) {
      if (!(await handleConflict(error))) setMessage(error.message || "Unable to retire item");
    } finally {
      setPending(false);
    }
  };

  return (
    <section data-testid="items-manager" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl text-green-950 font-semibold" style={{ fontFamily: "var(--font-serif)" }}>Items</h2>
          <p className="mt-1 text-sm text-green-800/65">Manage names, photos and ordering quantities. Set prices and availability in Inventory.</p>
        </div>
        <button type="button" onClick={() => openEditor()} className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-green-950 hover:bg-amber-300">
          Add item
        </button>
      </div>

      {message && !editing && !retiring && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{message}</div>}

      <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
        <input aria-label="Search items" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search items" className="rounded-lg border border-green-300 bg-white px-3 py-2 text-sm" />
        <select aria-label="Filter items by category" value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-lg border border-green-300 bg-white px-3 py-2 text-sm">
          <option value="all">All categories</option>
          {CATS.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
        </select>
      </div>

      {loading ? <p className="py-8 text-center text-sm text-green-800/60">Loading items…</p> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {visible.map((item) => {
            const image = resolveImg(imageForItem(item));
            const categoryName = CATS.find((cat) => cat.id === item.cat)?.name || item.cat;
            return (
              <article key={item.id} data-testid={`item-${item.id}`} className="rounded-xl border border-green-200 bg-white p-3 shadow-sm">
                <div className="flex gap-3">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-green-100">
                    {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center px-2 text-center text-xs text-green-800/50">Photo coming soon</div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-green-950">{item.name}</h3>
                        <p className="text-xs text-green-800/60">{categoryName} · {item.unit}</p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${item.isDraft ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"}`}>{item.isDraft ? "Draft" : "Published"}</span>
                    </div>
                    <p className="mt-2 text-xs text-green-800/60">Minimum {item.minQty} · increment {item.step}{item.isCombo ? " · Combo" : ""}</p>
                  </div>
                </div>
                {item.isDraft && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Set price and enable this item in Inventory.</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" aria-label={`Edit ${item.name}`} onClick={() => openEditor(item)} className="rounded-lg border border-green-300 px-3 py-1.5 text-xs font-semibold text-green-800">Edit</button>
                  <button type="button" aria-label={`Delete ${item.name}`} onClick={() => setRetiring(item)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600">Delete</button>
                  {item.isDraft && <button type="button" onClick={onGoToInventory} className="rounded-lg bg-green-100 px-3 py-1.5 text-xs font-semibold text-green-800">Go to Inventory</button>}
                </div>
              </article>
            );
          })}
          {visible.length === 0 && <p className="py-8 text-center text-sm text-green-800/60 sm:col-span-2">No items match this search.</p>}
        </div>
      )}

      {editing && (
        <div role="dialog" aria-modal="true" aria-labelledby="item-editor-title" className="fixed inset-0 z-50 flex items-center justify-center bg-green-950/45 p-4">
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            {message && <p role="alert" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
            <div className="flex items-center justify-between gap-3">
              <h3 id="item-editor-title" className="text-xl font-semibold text-green-950">{editing.id ? "Edit item" : "Add item"}</h3>
              <button type="button" aria-label="Close item editor" onClick={closeEditor} className="rounded-lg px-2 py-1 text-green-800">×</button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-green-900 sm:col-span-2">Item name<input aria-label="Item name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1 w-full rounded-lg border border-green-300 px-3 py-2" /></label>
              <label className="text-sm text-green-900">Category<select aria-label="Category" value={form.cat} onChange={(event) => setForm({ ...form, cat: event.target.value, isCombo: event.target.value === "mains" && form.isCombo })} className="mt-1 w-full rounded-lg border border-green-300 px-3 py-2">{CATS.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></label>
              <label className="text-sm text-green-900">Unit<input aria-label="Unit" value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} className="mt-1 w-full rounded-lg border border-green-300 px-3 py-2" /></label>
              <label className="text-sm text-green-900">Minimum quantity<input aria-label="Minimum quantity" type="number" min="0.01" step="any" value={form.minQty} onChange={(event) => setForm({ ...form, minQty: event.target.value })} className="mt-1 w-full rounded-lg border border-green-300 px-3 py-2" /></label>
              <label className="text-sm text-green-900">Quantity increment<input aria-label="Quantity increment" type="number" min="0.01" step="any" value={form.step} onChange={(event) => setForm({ ...form, step: event.target.value })} className="mt-1 w-full rounded-lg border border-green-300 px-3 py-2" /></label>
              {form.cat === "mains" && <label className="flex items-center gap-2 text-sm text-green-900 sm:col-span-2"><input aria-label="Combo item" type="checkbox" checked={form.isCombo} onChange={(event) => setForm({ ...form, isCombo: event.target.checked })} /> Combo item</label>}
            </div>

            <div className="mt-5 border-t border-green-100 pt-4">
              <label className="text-sm font-semibold text-green-950">Photo<input aria-label="Item photo" type="file" accept="image/jpeg,image/png" onChange={(event) => choosePhoto(event.target.files?.[0])} className="mt-2 block w-full text-sm" /></label>
              {preview ? <img src={preview} alt="New photo preview" className="mt-3 h-40 w-full rounded-lg object-cover" /> : currentPhoto ? <img src={currentPhoto} alt="Current item photo" className="mt-3 h-40 w-full rounded-lg object-cover" /> : null}
              {photo && <div className="mt-3 flex gap-2"><button type="button" onClick={savePhoto} disabled={!editing.id || pending} className="rounded-lg bg-green-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Save photo</button><button type="button" onClick={clearPhoto} className="rounded-lg border border-green-300 px-3 py-2 text-sm font-semibold text-green-800">Cancel photo</button></div>}
              {!editing.id && photo && <p className="mt-2 text-xs text-green-800/60">The item will be created as a draft before its photo is uploaded.</p>}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={closeEditor} className="rounded-lg border border-green-300 px-4 py-2 text-sm font-semibold text-green-800">Cancel</button>
              <button type="button" onClick={saveItem} disabled={pending} className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-green-950 disabled:opacity-50">Save item</button>
            </div>
          </div>
        </div>
      )}

      {retiring && (
        <div role="dialog" aria-modal="true" aria-labelledby="retire-title" className="fixed inset-0 z-50 flex items-center justify-center bg-green-950/45 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            {message && <p role="alert" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
            <h3 id="retire-title" className="text-lg font-semibold text-green-950">Retire {retiring.name}?</h3>
            <p className="mt-2 text-sm text-green-800/75">This removes the item from the active catalogue. Existing orders and their item names are preserved.</p>
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setRetiring(null)} className="rounded-lg border border-green-300 px-4 py-2 text-sm font-semibold text-green-800">Cancel</button><button type="button" onClick={confirmRetire} disabled={pending} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Retire item</button></div>
          </div>
        </div>
      )}
    </section>
  );
}
