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
  reserve(paramsJson: string): Promise<string>;
  register(paramsJson: string): Promise<string>;
  ammMint(paramsJson: string): Promise<string>;
  ammSwap(paramsJson: string): Promise<string>;
  ammBurn(paramsJson: string): Promise<string>;
  dutchAuctionCreate(paramsJson: string): Promise<string>;
  dutchAuctionBid(paramsJson: string): Promise<string>;
  dutchAuctionCollect(paramsJson: string): Promise<string>;
}

const nativeModule = TurboModuleRegistry.get<Spec>('BitAssetsWallet');

export default nativeModule;
