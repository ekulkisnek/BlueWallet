import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';

import { BlueCard, BlueFormLabel, BlueText } from '../../BlueComponents';
import {
  BITASSETS_OPERATION_DEFINITIONS,
  BitAssetsOperation,
  buildBitAssetsOperationParams,
  initialBitAssetsFormState,
  normalizeBitAssetsError,
} from '../../blue_modules/BitAssetsWalletForms';
import { BitAssetsUtxo, BitAssetsWalletInfo } from '../../blue_modules/BitAssetsWallet';
import Button from '../../components/Button';
import { useTheme } from '../../components/themes';
import { useStorage } from '../../hooks/context/useStorage';
import { BitAssetsWallet as BitAssetsWalletClass } from '../../class/wallets/bitassets-wallet';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';

type RouteProps = RouteProp<DetailViewStackParamList, 'BitAssetsWallet'>;

const SYNC_INTERVAL_MS = 30000;

const BitAssetsWallet: React.FC = () => {
  const { colors } = useTheme();
  const { wallets, saveToDisk } = useStorage();
  const { walletID } = useRoute<RouteProps>().params;
  const wallet = wallets.find(w => w.getID() === walletID) as BitAssetsWalletClass | undefined;
  const [operation, setOperation] = useState<BitAssetsOperation>('transfer');
  const [forms, setForms] = useState(initialBitAssetsFormState);
  const [result, setResult] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [info, setInfo] = useState<BitAssetsWalletInfo | undefined>(wallet?.bitassetsInfo);
  const [utxos, setUtxos] = useState<BitAssetsUtxo[]>(wallet?.bitassetsUtxos ?? []);
  const [isLoading, setIsLoading] = useState(false);
  const nativeCallInFlight = useRef(false);

  const stylesHook = useMemo(
    () => ({
      root: { backgroundColor: colors.elevated },
      input: {
        borderColor: colors.formBorder,
        backgroundColor: colors.inputBackgroundColor,
        color: colors.foregroundColor,
      },
      segment: {
        borderColor: colors.formBorder,
      },
    }),
    [colors.elevated, colors.foregroundColor, colors.formBorder, colors.inputBackgroundColor],
  );

  const sync = useCallback(
    async (quiet = false) => {
      if (!wallet) return;
      if (quiet && nativeCallInFlight.current) return;
      nativeCallInFlight.current = true;
      if (!quiet) setIsLoading(true);
      try {
        const nextInfo = await wallet.syncBitAssets();
        await wallet.fetchTransactions();
        await saveToDisk();
        setInfo(nextInfo);
        setUtxos([...wallet.bitassetsUtxos]);
        if (!quiet) {
          setResult(JSON.stringify({ synced: true, tip: nextInfo.last_tip_height ?? null }, null, 2));
        }
      } catch (error: any) {
        const normalizedError = normalizeBitAssetsError(error);
        if (!quiet) {
          setErrorMessage(normalizedError);
          Alert.alert('BitAssets sync failed', normalizedError);
        }
      } finally {
        nativeCallInFlight.current = false;
        if (!quiet) setIsLoading(false);
      }
    },
    [saveToDisk, wallet],
  );

  useFocusEffect(
    useCallback(() => {
      sync(true);
      const interval = setInterval(() => {
        if (AppState.currentState === 'active') {
          sync(true);
        }
      }, SYNC_INTERVAL_MS);
      return () => clearInterval(interval);
    }, [sync]),
  );

  if (!wallet) {
    return (
      <View style={[styles.center, stylesHook.root]}>
        <BlueText>BitAssets wallet not found</BlueText>
      </View>
    );
  }

  const definition = BITASSETS_OPERATION_DEFINITIONS.find(item => item.key === operation) ?? BITASSETS_OPERATION_DEFINITIONS[0];
  const balances = info?.balances ?? wallet.bitassetsInfo?.balances ?? {};
  const confirmedCount =
    info?.confirmed_utxo_count ?? wallet.bitassetsInfo?.confirmed_utxo_count ?? utxos.filter(utxo => utxo.confirmed).length;
  const mempoolCount = info?.mempool_utxo_count ?? wallet.bitassetsInfo?.mempool_utxo_count ?? utxos.filter(utxo => !utxo.confirmed).length;

  const updateField = (key: string, value: string) => {
    setForms(current => ({
      ...current,
      [operation]: {
        ...current[operation],
        [key]: value,
      },
    }));
  };

  const submit = async () => {
    if (nativeCallInFlight.current) {
      setErrorMessage('BitAssets wallet is already syncing. Try again in a moment.');
      return;
    }
    nativeCallInFlight.current = true;
    setIsLoading(true);
    setResult('');
    setErrorMessage('');
    Keyboard.dismiss();
    try {
      const params = buildBitAssetsOperationParams(operation, forms[operation]);
      let txid: string;
      switch (operation) {
        case 'transfer':
          txid = await wallet.transferBitAssets(params as any);
          break;
        case 'reserve':
          txid = await wallet.reserveBitAsset(params as any);
          break;
        case 'register':
          txid = await wallet.registerBitAsset(params as any);
          break;
        case 'ammMint':
          txid = await wallet.ammMint(params as any);
          break;
        case 'ammSwap':
          txid = await wallet.ammSwap(params as any);
          break;
        case 'ammBurn':
          txid = await wallet.ammBurn(params as any);
          break;
        case 'dutchAuctionCreate':
          txid = await wallet.dutchAuctionCreate(params as any);
          break;
        case 'dutchAuctionBid':
          txid = await wallet.dutchAuctionBid(params as any);
          break;
        case 'dutchAuctionCollect':
          txid = await wallet.dutchAuctionCollect(params as any);
          break;
      }
      setResult(JSON.stringify({ operation, txid }, null, 2));
      setIsLoading(false);
      // Broadcast success should be visible immediately. The refresh can be slow
      // while local signet mines, so keep it off the submit critical path.
      sync(true).catch(error => console.warn('[BitAssetsWallet] post-broadcast sync failed', error));
    } catch (error: any) {
      const normalizedError = normalizeBitAssetsError(error);
      setErrorMessage(normalizedError);
      Alert.alert('BitAssets transaction failed', normalizedError);
    } finally {
      nativeCallInFlight.current = false;
      setIsLoading(false);
    }
  };

  return (
    <ScrollView style={[styles.root, stylesHook.root]} keyboardShouldPersistTaps="always" testID="BitAssetsWalletScreen">
      <BlueCard>
        <BlueText h3>{wallet.getLabel()}</BlueText>
        <BlueText selectable style={styles.address} testID="BitAssetsAddress">
          {wallet.getAddress() || ''}
        </BlueText>
        <BlueText selectable testID="BitAssetsRpcUrl">
          {wallet.bitassetsRpcUrl}
        </BlueText>
        <View style={styles.statusGrid}>
          <StatusItem label="Tip" value={String(info?.last_tip_height ?? 'not synced')} />
          <StatusItem label="Confirmed UTXOs" value={String(confirmedCount)} />
          <StatusItem label="Mempool UTXOs" value={String(mempoolCount)} />
        </View>
      </BlueCard>

      <View style={styles.buttons}>
        <Button testID="BitAssetsSyncButton" title={isLoading ? 'Working...' : 'Sync'} onPress={() => sync(false)} disabled={isLoading} />
      </View>

      <Section title="Balances">
        {Object.keys(balances).length === 0 ? (
          <BlueText testID="BitAssetsEmptyBalances">No confirmed balances yet.</BlueText>
        ) : (
          Object.entries(balances).map(([asset, amount]) => (
            <View key={asset} style={styles.row} testID={`BitAssetsBalance-${asset}`}>
              <BlueText selectable style={styles.rowLabel}>
                {asset}
              </BlueText>
              <BlueText bold>{amount}</BlueText>
            </View>
          ))
        )}
      </Section>

      <Section title="Operation">
        <BlueText bold testID="BitAssetsSelectedOperation" style={styles.selectedOperation}>
          {definition.label}
        </BlueText>
        <View style={styles.operationGrid}>
          {BITASSETS_OPERATION_DEFINITIONS.map(item => (
            <Pressable
              key={item.key}
              testID={`BitAssetsOperation-${item.key}`}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              style={[
                styles.operationPill,
                {
                  backgroundColor: operation === item.key ? colors.mainColor : colors.buttonDisabledBackgroundColor,
                },
              ]}
              onPress={() => {
                setOperation(item.key);
                setResult('');
              }}
            >
              <BlueText bold style={{ color: operation === item.key ? colors.buttonTextColor : colors.foregroundColor }}>
                {item.label}
              </BlueText>
            </Pressable>
          ))}
        </View>

        {definition.fields.map(field => (
          <View key={field.key} style={styles.field}>
            <BlueFormLabel>{field.label}</BlueFormLabel>
            <TextInput
              testID={`BitAssetsField-${field.key}`}
              value={forms[operation][field.key] ?? ''}
              onChangeText={value => updateField(field.key, value)}
              autoCapitalize="none"
              autoCorrect={false}
              multiline={field.multiline}
              blurOnSubmit={!field.multiline}
              returnKeyType={field.multiline ? 'default' : 'done'}
              onSubmitEditing={field.multiline ? undefined : submit}
              keyboardType={field.type === 'number' ? 'number-pad' : 'default'}
              style={[styles.input, field.multiline && styles.multilineInput, stylesHook.input]}
            />
          </View>
        ))}

        <View style={styles.buttons}>
          <Button
            testID="BitAssetsBroadcastButton"
            accessibilityLabel={definition.submitLabel}
            title={definition.submitLabel}
            onPress={submit}
            disabled={isLoading}
          />
        </View>
      </Section>

      <Section title="UTXOs">
        {utxos.length === 0 ? (
          <BlueText testID="BitAssetsEmptyUtxos">No wallet UTXOs yet.</BlueText>
        ) : (
          utxos.slice(0, 20).map((utxo, index) => (
            <View key={`${utxo.txid ?? utxo.outpoint?.txid ?? index}:${utxo.vout ?? utxo.outpoint?.vout ?? 0}`} style={styles.utxo}>
              <BlueText selectable>{utxo.content_kind ?? utxo.asset_id ?? 'BitAssets UTXO'}</BlueText>
              <BlueText>
                {utxo.amount ?? 0} {utxo.confirmed === false ? 'mempool' : 'confirmed'}
              </BlueText>
              <BlueText selectable style={styles.txid}>
                {utxo.txid ?? utxo.outpoint?.txid ?? ''}
              </BlueText>
            </View>
          ))
        )}
      </Section>

      {result ? (
        <BlueCard testID="BitAssetsResult">
          <BlueText selectable>{result}</BlueText>
        </BlueCard>
      ) : null}

      {errorMessage ? (
        <BlueCard testID="BitAssetsError">
          <BlueText selectable>{errorMessage}</BlueText>
        </BlueCard>
      ) : null}
    </ScrollView>
  );
};

const Section: React.FC<React.PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <BlueCard style={styles.section}>
    <BlueText h4 style={styles.sectionTitle}>
      {title}
    </BlueText>
    {children}
  </BlueCard>
);

const StatusItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.statusItem}>
    <BlueText style={styles.statusLabel}>{label}</BlueText>
    <BlueText bold>{value}</BlueText>
  </View>
);

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
    marginTop: 12,
  },
  buttons: {
    marginVertical: 12,
  },
  section: {
    marginTop: 8,
  },
  sectionTitle: {
    marginBottom: 12,
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 16,
  },
  statusItem: {
    minWidth: 96,
  },
  statusLabel: {
    opacity: 0.7,
    fontSize: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginVertical: 6,
  },
  rowLabel: {
    flex: 1,
  },
  operationGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  operationPill: {
    minHeight: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  selectedOperation: {
    marginBottom: 12,
  },
  field: {
    marginBottom: 12,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multilineInput: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  utxo: {
    marginVertical: 8,
  },
  txid: {
    opacity: 0.7,
    fontSize: 12,
  },
});

export default BitAssetsWallet;
