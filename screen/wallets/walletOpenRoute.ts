import { BitAssetsWallet } from '../../class/wallets/bitassets-wallet';
import { LiquidWallet } from '../../class/wallets/liquid-wallet';
import { TWallet } from '../../class/wallets/types';

export const walletOpenRouteFor = (wallet: TWallet) => {
  const walletID = wallet.getID();
  if (wallet.type === BitAssetsWallet.type) {
    return ['BitAssetsWallet', { walletID }] as const;
  }
  if (wallet.type === LiquidWallet.type) {
    return ['LiquidWallet', { walletID }] as const;
  }
  return ['WalletTransactions', { walletID, walletType: wallet.type }] as const;
};
