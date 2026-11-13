const OPEN_SCANNER_EVENT = "dailyplazaa:open-phone-scanner";

export function openPhoneScannerDialog() {
  window.dispatchEvent(new CustomEvent(OPEN_SCANNER_EVENT));
}

export function listenForPhoneScannerDialog(listener: () => void) {
  window.addEventListener(OPEN_SCANNER_EVENT, listener);
  return () => window.removeEventListener(OPEN_SCANNER_EVENT, listener);
}
