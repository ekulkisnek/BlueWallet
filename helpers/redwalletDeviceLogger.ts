import { AppState, NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';

type RedWalletEventFields = Record<string, unknown>;
type ReactNativeErrorUtils = {
  getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

const marker = 'REDWALLET_EVENT';
const logFilePath = `${RNFS.DocumentDirectoryPath}/redwallet-device-events.ndjson`;
// Phone must reach Mac collector over LAN or Tailscale (Luke signet host).
const remoteCollectorUrls = [
  'http://100.76.117.106:6123/events',
  'http://192.168.1.50:6123/events',
];
const originalConsole = {
  debug: console.debug.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console),
};
let installed = false;
let appendQueue = Promise.resolve();
let fetchForRemoteCollector: typeof fetch | undefined;

function sanitize(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (depth > 3) return '[max-depth]';
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitize(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: RedWalletEventFields = {};
    for (const [key, nested] of Object.entries(value as RedWalletEventFields).slice(0, 40)) {
      out[key] = sanitize(nested, depth + 1);
    }
    return out;
  }
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  return value;
}

function emit(event: string, fields: RedWalletEventFields = {}): void {
  const record = {
    ts: new Date().toISOString(),
    event,
    platform: Platform.OS,
    platformVersion: Platform.Version,
    appState: AppState.currentState,
    bundleId: NativeModules.PlatformConstants?.bundleIdentifier,
    appVersion: NativeModules.PlatformConstants?.appVersion,
    buildNumber: NativeModules.PlatformConstants?.buildNumber,
    fields: sanitize(fields),
  };
  const line = JSON.stringify(record);
  originalConsole.log(`${marker} ${line}`);
  appendQueue = appendQueue
    .then(() => RNFS.appendFile(logFilePath, `${line}\n`, 'utf8'))
    .catch(error => {
      originalConsole.warn(`${marker} ${JSON.stringify({ ts: new Date().toISOString(), event: 'log_file_append_failed', error: sanitize(error) })}`);
    });
  if (fetchForRemoteCollector) {
    for (const url of remoteCollectorUrls) {
      fetchForRemoteCollector(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: line,
      }).catch(error => {
        originalConsole.warn(
          `${marker} ${JSON.stringify({ ts: new Date().toISOString(), event: 'remote_log_failed', url, error: sanitize(error) })}`,
        );
      });
    }
  }
}

function installConsoleCapture(): void {
  (['debug', 'error', 'info', 'log', 'warn'] as const).forEach(level => {
    console[level] = (...args: unknown[]) => {
      originalConsole[level](...args);
      if (typeof args[0] === 'string' && args[0].startsWith(marker)) return;
      emit('console', { level, args });
    };
  });
}

function installErrorCapture(): void {
  const errorUtils = (global as typeof global & { ErrorUtils?: ReactNativeErrorUtils }).ErrorUtils;
  const previousHandler = errorUtils?.getGlobalHandler?.();
  if (errorUtils?.setGlobalHandler) {
    errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      emit('js_error', { error, isFatal: Boolean(isFatal) });
      previousHandler?.(error, isFatal);
    });
  }

  const previousUnhandledRejection = (global as typeof global & { onunhandledrejection?: (event: unknown) => void }).onunhandledrejection;
  (global as typeof global & { onunhandledrejection?: (event: unknown) => void }).onunhandledrejection = event => {
    emit('unhandled_promise_rejection', { event });
    previousUnhandledRejection?.(event);
  };
}

function installFetchCapture(): void {
  const originalFetch = global.fetch;
  if (typeof originalFetch !== 'function') return;
  fetchForRemoteCollector = originalFetch;
  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const startedAt = Date.now();
    const url = typeof input === 'string' ? input : 'url' in input ? String(input.url) : String(input);
    const method = init?.method || (typeof input === 'object' && 'method' in input ? input.method : undefined) || 'GET';
    emit('network_request', { method, url });
    try {
      const response = await originalFetch(input, init);
      emit('network_response', { method, url, status: response.status, ok: response.ok, durationMs: Date.now() - startedAt });
      return response;
    } catch (error) {
      emit('network_error', { method, url, durationMs: Date.now() - startedAt, error });
      throw error;
    }
  };
}

export function installRedWalletDeviceLogger(): void {
  if (installed) return;
  installed = true;
  installConsoleCapture();
  installErrorCapture();
  installFetchCapture();
  AppState.addEventListener('change', nextState => emit('app_state_change', { nextState }));
  emit('device_logger_installed', { logFilePath });
}

export function redWalletEvent(event: string, fields?: RedWalletEventFields): void {
  emit(event, fields);
}
