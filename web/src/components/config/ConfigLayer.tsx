import { lazy, Suspense } from 'react';
import { useConfigUI } from '../../configStore';

// Settings load on first use; App prefetches this module when idle.
const AppSettings = lazy(() => import('./AppSettings').then((m) => ({ default: m.AppSettings })));
const BotSettingsModal = lazy(() => import('./BotSettingsModal').then((m) => ({ default: m.BotSettingsModal })));

/** Overlays owned by the settings feature: bot settings dialog and the app settings page. */
export function ConfigLayer() {
  const botSettings = useConfigUI((s) => !!s.botSettings);
  const appSettings = useConfigUI((s) => !!s.appSettings);
  return (
    <Suspense fallback={null}>
      {appSettings && <AppSettings />}
      {botSettings && <BotSettingsModal />}
    </Suspense>
  );
}
