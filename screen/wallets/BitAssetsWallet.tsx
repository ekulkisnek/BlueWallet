import React, { useMemo, useState } from 'react';
import { Alert, Keyboard, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';

import { BlueCard, BlueText } from '../../BlueComponents';
import Button from '../../components/Button';
import { useTheme } from '../../components/themes';
import { useStorage } from '../../hooks/context/useStorage';
import { BitAssetsWallet as BitAssetsWalletClass } from '../../class/wallets/bitassets-wallet';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';

type RouteProps = RouteProp<DetailViewStackParamList, 'BitAssetsWallet'>;

const operationTemplates = {
  transfer: {
    destinationAddress: '',
    assetId: '',
    amount: 0,
    feeSats: 0,
    memo: '',
  },
  reserve: {
    name: '',
    feeSats: 0,
  },
  register: {
    name: '',
    initialSupply: 0,
    bitassetData: {},
    feeSats: 0,
  },
  ammMint: {
    asset0: '',
    asset1: '',
    amount0: 0,
    amount1: 0,
    lpTokenMint: 0,
    feeSats: 0,
  },
  ammSwap: {
    assetSpend: '',
    assetReceive: '',
    amountSpend: 0,
    amountReceive: 0,
    feeSats: 0,
  },
  ammBurn: {
    asset0: '',
    asset1: '',
    amount0: 0,
    amount1: 0,
    lpTokenBurn: 0,
    feeSats: 0,
  },
  dutchAuctionCreate: {
    baseAsset: '',
    quoteAsset: '',
    baseAmount: 0,
    startPrice: 0,
    endPrice: 0,
    duration: 0,
    feeSats: 0,
  },
  dutchAuctionBid: {
    auctionId: '',
    baseAsset: '',
    quoteAsset: '',
    bidSize: 0,
    receiveQuantity: 0,
    feeSats: 0,
  },
  dutchAuctionCollect: {
    auctionId: '',
    baseAsset: '',
    quoteAsset: '',
    amountBase: 0,
    amountQuote: 0,
    feeSats: 0,
  },
} as const;

type Operation = keyof typeof operationTemplates;

const operations = Object.keys(operationTemplates) as Operation[];

const BitAssetsWallet: React.FC = () => {
  const { colors } = useTheme();
  const { wallets, saveToDisk } = useStorage();
  const { walletID } = useRoute<RouteProps>().params;
  const wallet = wallets.find(w => w.getID() === walletID) as BitAssetsWalletClass | undefined;
  const [operation, setOperation] = useState<Operation>('transfer');
  const [payload, setPayload] = useState(JSON.stringify(operationTemplates.transfer, null, 2));
  const [result, setResult] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const stylesHook = useMemo(
    () => ({
      root: { backgroundColor: colors.elevated },
      input: {
        borderColor: colors.formBorder,
        backgroundColor: colors.inputBackgroundColor,
        color: colors.foregroundColor,
      },
    }),
    [colors.elevated, colors.foregroundColor, colors.formBorder, colors.inputBackgroundColor],
  );

  if (!wallet) {
    return (
      <View style={[styles.center, stylesHook.root]}>
        <BlueText>BitAssets wallet not found</BlueText>
      </View>
    );
  }

  const selectOperation = (next: Operation) => {
    setOperation(next);
    setPayload(JSON.stringify(operationTemplates[next], null, 2));
    setResult('');
  };

  const sync = async () => {
    setIsLoading(true);
    try {
      const info = await wallet.syncBitAssets();
      await saveToDisk();
      setResult(JSON.stringify(info, null, 2));
    } catch (error: any) {
      Alert.alert('BitAssets sync failed', error.message ?? String(error));
    } finally {
      setIsLoading(false);
    }
  };

  const submit = async () => {
    setIsLoading(true);
    Keyboard.dismiss();
    try {
      const params = JSON.parse(payload);
      let txid: string;
      switch (operation) {
        case 'transfer':
          txid = await wallet.transferBitAssets(params);
          break;
        case 'reserve':
          txid = await wallet.reserveBitAsset(params);
          break;
        case 'register':
          txid = await wallet.registerBitAsset(params);
          break;
        case 'ammMint':
          txid = await wallet.ammMint(params);
          break;
        case 'ammSwap':
          txid = await wallet.ammSwap(params);
          break;
        case 'ammBurn':
          txid = await wallet.ammBurn(params);
          break;
        case 'dutchAuctionCreate':
          txid = await wallet.dutchAuctionCreate(params);
          break;
        case 'dutchAuctionBid':
          txid = await wallet.dutchAuctionBid(params);
          break;
        case 'dutchAuctionCollect':
          txid = await wallet.dutchAuctionCollect(params);
          break;
      }
      setResult(JSON.stringify({ txid }, null, 2));
    } catch (error: any) {
      Alert.alert('BitAssets transaction failed', error.message ?? String(error));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScrollView style={[styles.root, stylesHook.root]} keyboardShouldPersistTaps="handled">
      <BlueCard>
        <BlueText h3>{wallet.getLabel()}</BlueText>
        <BlueText selectable style={styles.address}>
          {wallet.getAddress() || ''}
        </BlueText>
        <BlueText selectable>{wallet.bitassetsRpcUrl}</BlueText>
      </BlueCard>

      <View style={styles.buttons}>
        <Button testID="BitAssetsSyncButton" title="Sync" onPress={sync} disabled={isLoading} />
      </View>

      <View style={styles.operationGrid}>
        {operations.map(item => (
          <Button
            key={item}
            testID={`BitAssetsOperation-${item}`}
            title={item}
            onPress={() => selectOperation(item)}
            disabled={isLoading || item === operation}
          />
        ))}
      </View>

      <TextInput
        testID="BitAssetsOperationPayload"
        value={payload}
        onChangeText={setPayload}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        style={[styles.payload, stylesHook.input]}
      />

      <View style={styles.buttons}>
        <Button testID="BitAssetsBroadcastButton" title="Broadcast" onPress={submit} disabled={isLoading} />
      </View>

      {result ? (
        <BlueCard testID="BitAssetsResult">
          <BlueText selectable>{result}</BlueText>
        </BlueCard>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 16,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  address: {
    marginVertical: 12,
  },
  buttons: {
    marginVertical: 12,
  },
  operationGrid: {
    gap: 8,
    marginVertical: 12,
  },
  payload: {
    minHeight: 220,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontFamily: 'Menlo',
  },
});

export default BitAssetsWallet;
