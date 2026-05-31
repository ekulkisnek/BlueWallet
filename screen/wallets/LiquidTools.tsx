import React, { useCallback, useMemo, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, View } from 'react-native';
import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';

import { BlueCard, BlueText } from '../../BlueComponents';
import { LiquidUtxo, LiquidWalletInfo } from '../../blue_modules/LiquidWallet';
import { normalizeLiquidError } from '../../blue_modules/LiquidWalletForms';
import Button from '../../components/Button';
import { useTheme } from '../../components/themes';
import { useStorage } from '../../hooks/context/useStorage';
import { LiquidWallet as LiquidWalletClass } from '../../class/wallets/liquid-wallet';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';

type RouteProps = RouteProp<DetailViewStackParamList, 'LiquidTools'>;

const SYNC_INTERVAL_MS = 30000;

const LiquidTools: React.FC = () => {
  const { colors } = useTheme();
  const { wallets, saveToDisk } = useStorage();
  const { walletID } = useRoute<RouteProps>().params;
  const wallet = wallets.find(w => w.getID() === walletID) as LiquidWalletClass | undefined;
  const navigation = useExtendedNavigation();
  const syncInFlight = useRef(false);

  const [info, setInfo] = useState<LiquidWalletInfo | undefined>(wallet?.liquidInfo);
  const [utxos, setUtxos] = useState<LiquidUtxo[]>(wallet?.liquidUtxos ?? []);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const stylesHook = useMemo(
    () => ({
      root: { backgroundColor: colors.elevated },
    }),
    [colors.elevated],
  );

  const sync = useCallback(
    async (quiet = false) => {
      if (!wallet) return;
      if (syncInFlight.current) return;
      syncInFlight.current = true;
      if (!quiet) setIsLoading(true);
      try {
        const nextInfo = await wallet.syncLiquid();
        await wallet.fetchTransactions();
        await saveToDisk();
        setInfo(nextInfo);
        setUtxos([...wallet.liquidUtxos]);
        if (!quiet) {
          setResult(JSON.stringify({ synced: true, tip: nextInfo.last_tip_height ?? null }, null, 2));
        }
        setErrorMessage('');
      } catch (error: any) {
        const normalized = normalizeLiquidError(error);
        if (!quiet) {
          setErrorMessage(normalized);
        }
      } finally {
        syncInFlight.current = false;
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
        <BlueText>Liquid wallet not found</BlueText>
      </View>
    );
  }

  const balances = info?.balances ?? wallet.liquidInfo?.balances ?? {};
  const confirmedCount =
    info?.confirmed_utxo_count ?? wallet.liquidInfo?.confirmed_utxo_count ?? utxos.filter(utxo => utxo.confirmed).length;
  const mempoolCount = info?.mempool_utxo_count ?? wallet.liquidInfo?.mempool_utxo_count ?? utxos.filter(utxo => !utxo.confirmed).length;

  const onPreparePeg = async (kind: 'in' | 'out') => {
    setResult('');
    setErrorMessage('');
    setIsLoading(true);
    try {
      // Skeleton: prepare hooks are on the native client (PR7 will surface via wallet class methods).
      // For now demonstrate the path exists in the embedded/JsonRpc clients.
      const client = (wallet as any).getConfiguredClient ? await (wallet as any).getConfiguredClient() : null;
      if (client && typeof client.preparePegIn === 'function' && kind === 'in') {
        const res = await client.preparePegIn({ amount: 10000 });
        setResult(JSON.stringify({ kind: 'pegin', result: res }, null, 2));
      } else if (client && typeof client.preparePegOut === 'function' && kind === 'out') {
        const res = await client.preparePegOut({ destinationAddress: 'bcrt1qplaceholder', amount: 10000 });
        setResult(JSON.stringify({ kind: 'pegout', result: res }, null, 2));
      } else {
        setResult(
          JSON.stringify(
            {
              note: 'Pegin/pegout prepare is a native client hook (available via Embedded). Full UI + class methods land in follow-up PR.',
              kind,
            },
            null,
            2,
          ),
        );
      }
    } catch (e: any) {
      setErrorMessage(normalizeLiquidError(e));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.flex}>
      <ScrollView style={[styles.root, stylesHook.root]} contentContainerStyle={styles.content} testID="LiquidToolsScreen">
        <BlueCard>
          <BlueText h3>{wallet.getLabel()}</BlueText>
          <BlueText selectable style={styles.address} testID="LiquidToolsAddress">
            {wallet.getAddress() || ''}
          </BlueText>
          <BlueText selectable testID="LiquidToolsRpcUrl">
            {wallet.elementsRpcUrl}
          </BlueText>
          <View style={styles.statusGrid}>
            <StatusItem label="Tip" value={String(info?.last_tip_height ?? 'not synced')} />
            <StatusItem label="Confirmed UTXOs" value={String(confirmedCount)} />
            <StatusItem label="Mempool UTXOs" value={String(mempoolCount)} />
          </View>
        </BlueCard>

        <View style={styles.buttons}>
          <Button testID="LiquidSyncButton" title={isLoading ? 'Working...' : 'Sync'} onPress={() => sync(false)} disabled={isLoading} />
        </View>

        {errorMessage ? (
          <BlueCard style={styles.section} testID="LiquidToolsError">
            <BlueText selectable>{errorMessage}</BlueText>
          </BlueCard>
        ) : null}

        {result ? (
          <BlueCard style={styles.section} testID="LiquidToolsResult">
            <BlueText selectable>{result}</BlueText>
          </BlueCard>
        ) : null}

        <Section title="Balances">
          {Object.keys(balances).length === 0 ? (
            <BlueText testID="LiquidToolsEmptyBalances">No confirmed balances yet.</BlueText>
          ) : (
            Object.entries(balances).map(([asset, amount], index) => (
              <View key={asset} style={styles.row} testID={`LiquidToolsBalance-${asset}`}>
                <BlueText selectable style={styles.rowLabel}>
                  {asset}
                </BlueText>
                <BlueText bold>{amount}</BlueText>
              </View>
            ))
          )}
        </Section>

        <Section title="Advanced Tools (Pegin / Pegout)">
          <BlueText style={styles.hint}>
            Peg operations prepare data for mainchain &lt;-&gt; Liquid federation flows. Full end-to-end in later PR.
          </BlueText>
          <View style={styles.advancedButtons}>
            <Button
              testID="LiquidPreparePegInButton"
              title="Prepare Peg-In"
              onPress={() => onPreparePeg('in')}
              disabled={isLoading}
            />
            <Button
              testID="LiquidPreparePegOutButton"
              title="Prepare Peg-Out"
              onPress={() => onPreparePeg('out')}
              disabled={isLoading}
            />
          </View>
        </Section>

        <Section title="UTXOs">
          {utxos.length === 0 ? (
            <BlueText testID="LiquidToolsEmptyUtxos">No wallet UTXOs yet.</BlueText>
          ) : (
            utxos.slice(0, 20).map((utxo, index) => (
              <View key={`${utxo.txid ?? index}:${utxo.vout ?? 0}`} style={styles.utxo}>
                <BlueText selectable>
                  {(utxo.assetId ?? (utxo as any).asset_id ?? 'L-BTC')} {utxo.amount ?? 0} {utxo.confirmed === false ? '(mempool)' : ''}
                </BlueText>
                <BlueText selectable style={styles.txid}>
                  {utxo.txid ?? ''}:{utxo.vout ?? 0}
                </BlueText>
              </View>
            ))
          )}
        </Section>
      </ScrollView>
    </View>
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

const StatusItem: React.FC<{ label: string; value: string; testID?: string }> = ({ label, value, testID }) => (
  <View style={styles.statusItem}>
    <BlueText style={styles.statusLabel}>{label}</BlueText>
    <BlueText bold testID={testID}>
      {value}
    </BlueText>
  </View>
);

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  root: {
    flex: 1,
    padding: 16,
  },
  content: {
    paddingBottom: 120,
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
  advancedButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  hint: {
    opacity: 0.7,
    marginBottom: 8,
  },
  utxo: {
    marginVertical: 8,
  },
  txid: {
    opacity: 0.7,
    fontSize: 12,
  },
});

export default LiquidTools;
