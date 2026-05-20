import { BitAssetsWallet } from '../../class/wallets/bitassets-wallet';
import { TWallet } from '../../class/wallets/types';

export const walletOpenRouteFor = (wallet: TWallet) => {
  const walletID = wallet.getID();
  if (wallet.type === BitAssetsWallet.type) {
    return ['BitAssetsWallet', { walletID }] as const;
  }
  return ['WalletTransactions', { walletID, walletType: wallet.type }] as const;
};
