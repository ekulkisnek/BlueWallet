import React from 'react';
import { RouteProp, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { BitAssetsWallet } from '../../class/wallets/bitassets-wallet';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { SendDetailsStackParamList } from '../../navigation/SendDetailsStackParamList';
import { normalizeBitAssetsError } from '../../blue_modules/BitAssetsWalletForms';
import SidechainSendDetails from './SidechainSendDetails';

type NavigationProps = NativeStackNavigationProp<SendDetailsStackParamList, 'BitAssetsSendDetails'>;
type RouteProps = RouteProp<SendDetailsStackParamList, 'BitAssetsSendDetails'>;

const BitAssetsSendDetails: React.FC = () => {
  const { wallets } = useStorage();
  const navigation = useExtendedNavigation<NavigationProps>();
  const route = useRoute<RouteProps>();
  const { walletID } = route.params;

  const wallet = wallets.find(w => w.getID() === walletID) as BitAssetsWallet | undefined;

  return (
    <SidechainSendDetails
      wallet={wallet}
      amountPlaceholder="0"
      syncBalances={async () => {
        const info = await wallet!.syncBitAssets();
        return info.balances ?? {};
      }}
      chooseInitialAsset={balances => {
        const assetKeys = Object.keys(balances);
        return assetKeys.find(k => balances[k] > 0) || assetKeys[0];
      }}
      formatAssetLabel={(assetId, balance) => `${assetId} (${balance})`}
      send={({ destinationAddress, assetId, amount, memo }) =>
        wallet!.transferBitAssets({
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
          amountUnit: assetId,
          txid,
        });
      }}
      onBackgroundSync={() => {
        wallet!.syncBitAssets().catch(console.warn);
      }}
      normalizeError={normalizeBitAssetsError}
      testIDPrefix="BitAssets"
    />
  );
};

export default BitAssetsSendDetails;
