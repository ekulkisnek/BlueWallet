import './bugsnag';
import './gesture-handler';
import 'react-native-get-random-values';
import './shim.js';
import { installRedWalletDeviceLogger, redWalletEvent } from './helpers/redwalletDeviceLogger';

import React, { useEffect } from 'react';
import { AppRegistry, LogBox } from 'react-native';

import App from './App';
import { restoreSavedPreferredFiatCurrencyAndExchangeFromStorage } from './blue_modules/currency';

if (!Error.captureStackTrace) {
  // captureStackTrace is only available when debugging
  Error.captureStackTrace = () => {};
}

installRedWalletDeviceLogger();

LogBox.ignoreLogs([
  'Require cycle:',
  'Battery state `unknown` and monitoring disabled, this is normal for simulators and tvOS.',
  'Open debugger to view warnings.',
  'Non-serializable values were found in the navigation state',
]);

const BlueAppComponent = () => {
  useEffect(() => {
    redWalletEvent('app_component_mounted');
    restoreSavedPreferredFiatCurrencyAndExchangeFromStorage().catch(error => {
      console.error('Failed to restore preferred currency and exchange rates on startup:', error);
    });
  }, []);

  return <App />;
};

AppRegistry.registerComponent('RedWallet', () => BlueAppComponent);
