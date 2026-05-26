import React, { useCallback, useMemo, useRef, useState } from 'react';
import { AppState, Dimensions, PixelRatio, ScrollView, StyleSheet, View } from 'react-native';
import { RouteProp, useFocusEffect, useLocale, useRoute } from '@react-navigation/native';

import { BlueCard, BlueText } from '../../BlueComponents';
import { BitAssetsUtxo, BitAssetsWalletInfo, summarizeBitAssetsProofState } from '../../blue_modules/BitAssetsWallet';
import { normalizeBitAssetsError } from '../../blue_modules/BitAssetsWalletForms';
import Button from '../../components/Button';
import { FButton, FContainer } from '../../components/FloatButtons';
import Icon from '../../components/Icon';
import { useTheme } from '../../components/themes';
import { BitAssetsWallet as BitAssetsWalletClass } from '../../class/wallets/bitassets-wallet';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';

type RouteProps = RouteProp<DetailViewStackParamList, 'BitAssetsWallet'>;

const SYNC_INTERVAL_MS = 30000;

const buttonFontSize =
  PixelRatio.roundToNearestPixel(Dimensions.get('window').width / 26) > 22
    ? 22
    : PixelRatio.roundToNearestPixel(Dimensions.get('window').width / 26);

const BitAssetsWallet: React.FC = () => {
  const { colors } = useTheme();
  const { wallets, saveToDisk } = useStorage();
  const { walletID } = useRoute<RouteProps>().params;
  const wallet = wallets.find(w => w.getID() === walletID) as BitAssetsWalletClass | undefined;
  const navigation = useExtendedNavigation();
  const { direction } = useLocale();
  const walletActionButtonsRef = useRef<View>(null);
  const syncInFlight = useRef(false);

  const [info, setInfo] = useState<BitAssetsWalletInfo | undefined>(wallet?.bitassetsInfo);
  const [utxos, setUtxos] = useState<BitAssetsUtxo[]>(wallet?.bitassetsUtxos ?? []);
  const [syncError, setSyncError] = useState('');

  const stylesHook = useMemo(
    () => ({
      root: { backgroundColor: colors.elevated },
      sendIcon: { transform: [{ rotate: direction === 'rtl' ? '-225deg' : '225deg' }] },
      receiveIcon: { transform: [{ rotate: direction === 'rtl' ? '-45deg' : '45deg' }] },
    }),
    [colors.elevated, direction],
  );

  const sync = useCallback(async () => {
    if (!wallet || syncInFlight.current) return;
    syncInFlight.current = true;
    try {
      const nextInfo = await wallet.syncBitAssets();
      await wallet.fetchTransactions();
      await saveToDisk();
      setInfo(nextInfo);
      setUtxos([...wallet.bitassetsUtxos]);
      setSyncError('');
    } catch (error: any) {
      setSyncError(normalizeBitAssetsError(error));
    } finally {
      syncInFlight.current = false;
    }
  }, [saveToDisk, wallet]);

  useFocusEffect(
    useCallback(() => {
      sync();
      const interval = setInterval(() => {
        if (AppState.currentState === 'active') {
          sync();
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

  const balances = info?.balances ?? wallet.bitassetsInfo?.balances ?? {};
  const confirmedCount =
    info?.confirmed_utxo_count ?? wallet.bitassetsInfo?.confirmed_utxo_count ?? utxos.filter(utxo => utxo.confirmed).length;
  const mempoolCount = info?.mempool_utxo_count ?? wallet.bitassetsInfo?.mempool_utxo_count ?? utxos.filter(utxo => !utxo.confirmed).length;
  const proofSummary = summarizeBitAssetsProofState(utxos);

  return (
    <View style={styles.flex}>
      <ScrollView style={[styles.root, stylesHook.root]} contentContainerStyle={styles.content} testID="BitAssetsWalletScreen">
        <BlueCard>
          <BlueText h3>{wallet.getLabel()}</BlueText>
          <BlueText selectable style={styles.address} testID="BitAssetsAddress">
            {wallet.getAddress() || ''}
          </BlueText>
          <BlueText selectable style={styles.rpcUrl} testID="BitAssetsRpcUrl">
            {wallet.bitassetsRpcUrl}
          </BlueText>
          <View style={styles.statusGrid}>
            <StatusItem label="Tip" value={String(info?.last_tip_height ?? 'not synced')} />
            <StatusItem label="Confirmed" value={String(confirmedCount)} />
            <StatusItem label="Mempool" value={String(mempoolCount)} />
            <StatusItem label="Proof-backed" value={String(proofSummary.proofBacked)} testID="BitAssetsProofBackedUtxoCount" />
            <StatusItem label="Proof status" value={proofSummary.label} testID="BitAssetsProofBackedUtxoStatus" />
          </View>
        </BlueCard>

        <Section title="Balances">
          {Object.keys(balances).length === 0 ? (
            <BlueText testID="BitAssetsEmptyBalances">No confirmed balances yet.</BlueText>
          ) : (
            Object.entries(balances).map(([asset, amount], index) => (
              <View key={asset} style={styles.row} testID={`BitAssetsBalance-${asset}`}>
                <BlueText selectable style={styles.rowLabel} testID={`BitAssetsBalanceAsset-${index}`}>
                  {asset}
                </BlueText>
                <BlueText bold testID={`BitAssetsBalanceAmount-${index}`}>
                  {amount}
                </BlueText>
              </View>
            ))
          )}
        </Section>

        {syncError ? (
          <BlueCard style={styles.section} testID="BitAssetsSyncError">
            <BlueText selectable>{syncError}</BlueText>
          </BlueCard>
        ) : null}

        <View style={styles.toolsButton}>
          <Button testID="BitAssetsToolsButton" title="Tools" onPress={() => navigation.navigate('BitAssetsTools', { walletID })} />
        </View>
      </ScrollView>

      <FContainer ref={walletActionButtonsRef}>
        <FButton
          testID="ReceiveButton"
          text={loc.receive.header}
          onPress={() => {
            navigation.navigate('ReceiveDetails', { walletID });
          }}
          icon={
            <View style={styles.iconContainer}>
              <Icon
                name="arrow-down"
                size={buttonFontSize}
                type="font-awesome"
                color={colors.buttonAlternativeTextColor}
                style={stylesHook.receiveIcon}
              />
            </View>
          }
        />
        <FButton
          onPress={() => {
            navigation.navigate('SendDetailsRoot', {
              screen: 'BitAssetsSendDetails',
              params: { walletID },
            });
          }}
          text={loc.send.header}
          testID="SendButton"
          icon={
            <View style={styles.iconContainer}>
              <Icon
                name="arrow-down"
                size={buttonFontSize}
                type="font-awesome"
                color={colors.buttonAlternativeTextColor}
                style={stylesHook.sendIcon}
              />
            </View>
          }
        />
      </FContainer>
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
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    width: buttonFontSize * 1.5,
    height: buttonFontSize * 1.5,
    overflow: 'visible',
  },
  root: {
    flex: 1,
    padding: 16,
  },
  content: {
    paddingBottom: 220,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  address: {
    marginTop: 12,
  },
  rpcUrl: {
    marginTop: 8,
    opacity: 0.75,
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
  toolsButton: {
    marginVertical: 12,
  },
});

export default BitAssetsWallet;
