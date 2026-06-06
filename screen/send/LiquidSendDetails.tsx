import React from 'react';
import { RouteProp, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { LiquidWallet } from '../../class/wallets/liquid-wallet';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { SendDetailsStackParamList } from '../../navigation/SendDetailsStackParamList';
import { normalizeLiquidError } from '../../blue_modules/LiquidWalletForms';
import SidechainSendDetails from './SidechainSendDetails';

type NavigationProps = NativeStackNavigationProp<SendDetailsStackParamList, 'LiquidSendDetails'>;
type RouteProps = RouteProp<SendDetailsStackParamList, 'LiquidSendDetails'>;

const LiquidSendDetails: React.FC = () => {
  const { wallets } = useStorage();
  const navigation = useExtendedNavigation<NavigationProps>();
  const route = useRoute<RouteProps>();
  const { walletID } = route.params;

  const wallet = wallets.find(w => w.getID() === walletID) as LiquidWallet | undefined;

  return (
    <SidechainSendDetails
      wallet={wallet}
      amountPlaceholder="0"
      addressValidation={address => {
        if (address.length < 20 || !/^[a-zA-Z0-9:/.]+$/.test(address)) {
          return 'Invalid Liquid address format';
        }
      }}
      syncBalances={async () => {
        const info = await wallet!.syncLiquid();
        return info.balances ?? {};
      }}
      chooseInitialAsset={balances => {
        const assetKeys = Object.keys(balances);
        return assetKeys.find(k => k.toLowerCase() === 'bitcoin') || assetKeys.find(k => balances[k] > 0) || assetKeys[0];
      }}
      formatAssetLabel={(assetId, balance) => {
        if (assetId.toLowerCase() === 'bitcoin') return `L-BTC (${balance})`;
        return `${assetId} (${balance})`;
      }}
      send={({ destinationAddress, assetId, amount, memo }) =>
        wallet!.transferLiquid({
          destinationAddress,
          assetId,
          amount,
          memo,
          feeSats: 0,
        })
      }
      onSent={({ txid, amount, assetId }) => {
        navigation.navigate('Success', {
          amount,
          amountUnit: assetId.toLowerCase() === 'bitcoin' ? 'L-BTC' : assetId,
          txid,
        });
      }}
      onBackgroundSync={() => {
        wallet!.syncLiquid().catch(console.warn);
      }}
      normalizeError={normalizeLiquidError}
      testIDPrefix="Liquid"
    />
  );
};

export default LiquidSendDetails;
