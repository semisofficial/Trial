export function applyDeliveryDateInput(form, selectedDate) {
  return { ...form, deliveryDate: selectedDate, deliverySlot: "" };
}

export function deliveryDateIsUnavailable(selectedDate, minimumDeliveryDate) {
  return Boolean(selectedDate && selectedDate < minimumDeliveryDate);
}

export function mainsSundayBlocked(items, date, mode) {
  return mode === "Delivery" && items.some((item) => item.cat === "mains")
    && !items.some((item) => ["fried", "frozen"].includes(item.cat))
    && new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
}
