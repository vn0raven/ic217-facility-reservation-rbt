export function showFieldError(
  field: HTMLInputElement | HTMLTextAreaElement,
  message: string,
): boolean {
  field.setCustomValidity(message);
  return message === "" || field.reportValidity();
}
