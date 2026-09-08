export function applyDeliveryDateInput(form, selectedDate) {
  return { ...form, deliveryDate: selectedDate, deliverySlot: "" };
}

export function deliveryDateIsUnavailable(selectedDate, minimumDeliveryDate) {
  return Boolean(selectedDate && selectedDate < minimumDeliveryDate);
}
