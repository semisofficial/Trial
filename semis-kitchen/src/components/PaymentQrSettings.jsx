import { useCallback, useEffect, useRef, useState } from 'react';
import { loadPaymentQr, savePaymentQr } from '../lib/kitchen.jsx';

export default function PaymentQrSettings() {
  const [meta, setMeta] = useState(null);
  const [selection, setSelection] = useState(null);
  const [previewValid, setPreviewValid] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const inputRef = useRef(null);
  const maxUploadBytes = meta?.maxUploadBytes || 1024 * 1024;
  const maxUploadLabel = `${Math.round(maxUploadBytes / 1024 / 1024 * 10) / 10} MB`;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    setMessage('');
    setSelection(null);
    setConfirmed(false);
    setPreviewValid(false);
    if (inputRef.current) inputRef.current.value = '';
    try { setMeta(await loadPaymentQr()); }
    catch (err) { setMeta(null); setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let active = true;
    loadPaymentQr().then(data => { if (active) setMeta(data); })
      .catch(err => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => () => { if (selection) URL.revokeObjectURL(selection.url); }, [selection]);

  function cancel() {
    setSelection(null);
    setConfirmed(false);
    setPreviewValid(false);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  }

  function chooseFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    cancel();
    setMessage('');
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setError('Choose a PNG or JPEG image.');
      return;
    }
    if (!file.size || file.size > maxUploadBytes) {
      setError(`Choose an image no larger than ${maxUploadLabel}.`);
      return;
    }
    setSelection({ file, url: URL.createObjectURL(file) });
  }

  async function save() {
    if (!selection || !confirmed || !previewValid || saving || !meta?.ready) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      setMeta(await savePaymentQr(selection.file, meta.version));
      cancel();
      setMessage('Payment QR saved. Open the current QR and scan it to verify the payment account before sharing.');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  const currentUrl = `/upi-qr.jpeg?v=${encodeURIComponent(meta?.version || 'default')}`;
  return (
    <section aria-labelledby="payment-qr-heading" className="bg-white border border-green-200 rounded-xl p-4 shadow-sm mt-6 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="payment-qr-heading" className="text-green-950 font-semibold">Payment QR</h3>
        <button type="button" onClick={refresh} disabled={loading || saving}
          className="text-sm underline text-green-800 disabled:opacity-50">Reload current QR</button>
      </div>
      <p className="text-sm text-green-800 mt-2">This image is shared through the UPI link in WhatsApp. Replacing it also updates previously shared links; invoices stay unchanged.</p>
      {loading && <p role="status" className="text-sm text-green-800 mt-3">Loading payment QR…</p>}
      {meta && <div className="flex flex-wrap gap-6 mt-4">
        <div>
          <p className="text-sm font-medium text-green-950 mb-2">Current QR</p>
          <a href={currentUrl} target="_blank" rel="noopener noreferrer" aria-label="Open current payment QR">
            <img key={currentUrl} src={currentUrl} alt="Current payment QR" width="192" height="192"
              className="w-48 h-48 max-w-full object-contain bg-white border border-green-100 rounded-lg"
              onError={() => setError('The current QR image could not load. Try reloading it before sharing.')} />
          </a>
        </div>
        {selection && <div>
          <p className="text-sm font-medium text-green-950 mb-2">New image — not saved yet</p>
          <img src={selection.url} alt="New payment QR preview" width="192" height="192"
            className="w-48 h-48 max-w-full object-contain bg-white border border-green-100 rounded-lg"
            onLoad={event => {
              const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
              const valid = width >= 128 && height >= 128 && width <= 2048 && height <= 2048;
              setPreviewValid(valid);
              if (!valid) setError('Choose an image between 128 and 2048 pixels on each side.');
            }}
            onError={() => { setPreviewValid(false); setError('This image could not be opened. Choose a valid PNG or JPEG.'); }} />
        </div>}
      </div>}
      {meta && !meta.ready && <p className="text-sm text-amber-900 bg-amber-50 p-3 rounded-lg mt-3">
        Uploads need database setup. Ask your developer to apply payment_qr.sql. The existing QR remains available.
      </p>}
      <div className="mt-4">
        <label htmlFor="payment-qr-upload" className="block text-sm font-medium text-green-950 mb-2">Upload / Replace image</label>
        <input ref={inputRef} id="payment-qr-upload" type="file" accept="image/png,image/jpeg"
          onChange={chooseFile} disabled={loading || saving || !meta?.ready} aria-describedby="payment-qr-help"
          className="block w-full max-w-full min-w-0 text-sm text-green-900 file:mr-3 file:rounded-lg file:border-0 file:bg-green-100 file:px-3 file:py-2 file:text-green-950 disabled:opacity-50" />
        <p id="payment-qr-help" className="text-xs text-green-800 mt-2">PNG or JPEG, up to {maxUploadLabel}; 128–2048 pixels per side. Keep the full QR and its white border visible. Only the current image is stored.</p>
      </div>
      {selection && <div className="mt-4">
        <label className="flex items-start gap-2 text-sm text-green-950">
          <input type="checkbox" checked={confirmed} disabled={saving} onChange={e => setConfirmed(e.target.checked)} className="mt-1" />
          <span>I checked this QR belongs to the correct payment account and want to replace the current image.</span>
        </label>
        <div className="flex flex-wrap gap-3 mt-3">
          <button type="button" onClick={save} disabled={!confirmed || !previewValid || saving || !meta?.ready}
            className="px-4 py-2 rounded-lg bg-green-900 text-white text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save QR'}</button>
          <button type="button" onClick={cancel} disabled={saving}
            className="px-4 py-2 rounded-lg border border-green-300 text-green-900 text-sm disabled:opacity-50">Cancel</button>
        </div>
      </div>}
      {error && <p role="alert" className="text-sm text-red-800 bg-red-50 p-3 rounded-lg mt-3">{error}</p>}
      {message && <p role="status" className="text-sm text-green-900 bg-green-50 p-3 rounded-lg mt-3">{message}</p>}
    </section>
  );
}
