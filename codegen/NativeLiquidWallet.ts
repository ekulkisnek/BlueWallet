import { TurboModuleRegistry } from 'react-native';
import type { TurboModule } from 'react-native';

export interface Spec extends TurboModule {
  configure(configJson: string): Promise<string>;
  getNewAddress(): Promise<string>;
  walletInfo(): Promise<string>;
  sync(): Promise<string>;
  listUtxos(): Promise<string>;
  getBalance(assetId?: string): Promise<string>;
  transfer(paramsJson: string): Promise<string>;
  preparePegIn(paramsJson: string): Promise<string>;
  preparePegOut(paramsJson: string): Promise<string>;
  clear(): Promise<string>;
}

const nativeModule = TurboModuleRegistry.get<Spec>('LiquidWallet');

export default nativeModule;
