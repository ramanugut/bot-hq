// Turn phone/desktop notifications on or off for this browser.
import { api } from './api';

const b64ToBytes = (s: string) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

export async function enablePush(): Promise<string> {
  if (!pushSupported()) return /iPhone|iPad/.test(navigator.userAgent) ? 'On iPhone, first add Botly to your Home Screen (Share → Add to Home Screen), then turn notifications on from the app.' : 'This browser can’t show notifications.';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'Notifications are blocked. Allow them for this site in your browser settings.';
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  const { key } = await api.pushKey();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }));
  await api.pushSubscribe(sub.toJSON());
  await api.pushTest();
  return 'Notifications are on. You’ll hear from your bots when you’re not looking at the app.';
}

export async function disablePush(): Promise<string> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) { await api.pushUnsubscribe(sub.endpoint).catch(() => {}); await sub.unsubscribe(); }
  return 'Notifications are off for this device.';
}

/** Tell the server the app is on screen, so it doesn't send notifications for things you can see. */
export function startPresence(): () => void {
  const ping = () => { if (document.visibilityState === 'visible') api.presence().catch(() => {}); };
  ping();
  const t = setInterval(ping, 30_000);
  document.addEventListener('visibilitychange', ping);
  return () => { clearInterval(t); document.removeEventListener('visibilitychange', ping); };
}
