import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View, PixelRatio, Dimensions } from 'react-native';
import { RouteProp, useFocusEffect, useRoute, useLocale } from '@react-navigation/native';

import { BlueCard, BlueFormLabel, BlueText } from '../../BlueComponents';
import {
  BITASSETS_OPERATION_DEFINITIONS,
  BitAssetsOperation,
  applyBitAssetsE2ETestDefaults,
  buildBitAssetsOperationParams,
  initialBitAssetsFormState,
  isBitAssetsE2EControlsEnabled,
  normalizeBitAssetsError,
} from '../../blue_modules/BitAssetsWalletForms';
import { BitAssetsUtxo, BitAssetsWalletInfo, summarizeBitAssetsProofState } from '../../blue_modules/BitAssetsWallet';
import Button from '../../components/Button';
import { useTheme } from '../../components/themes';
import { useStorage } from '../../hooks/context/useStorage';
import { BitAssetsWallet as BitAssetsWalletClass } from '../../class/wallets/bitassets-wallet';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import { FButton, FContainer } from '../../components/FloatButtons';
import Icon from '../../components/Icon';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';

type RouteProps = RouteProp<DetailViewStackParamList, 'BitAssetsTools'>;

const SYNC_INTERVAL_MS = 30000;
const BITASSETS_E2E_CONTROLS_ENABLED = isBitAssetsE2EControlsEnabled({ BITASSETS_E2E: process.env.BITASSETS_E2E }, __DEV__);
const LOCAL_BITASSETS_RPC_RE = /^https?:\/\/(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/i;

const buttonFontSize =
  PixelRatio.roundToNearestPixel(Dimensions.get('window').width / 26) > 22
    ? 22
    : PixelRatio.roundToNearestPixel(Dimensions.get('window').width / 26);

type BitAssetsSubmitOptions = {
  applyTestDefaults?: boolean;
};

const BitAssetsTools: React.FC = () => {
  const { colors } = useTheme();
  const { wallets, saveToDisk } = useStorage();
  const { walletID } = useRoute<RouteProps>().params;
  const wallet = wallets.find(w => w.getID() === walletID) as BitAssetsWalletClass | undefined;
  const navigation = useExtendedNavigation();
  const { direction } = useLocale();
  const walletActionButtonsRef = useRef<View>(null);

  const bitassetsE2EControlsEnabled =
    BITASSETS_E2E_CONTROLS_ENABLED || (__DEV__ && Boolean(wallet?.bitassetsRpcUrl && LOCAL_BITASSETS_RPC_RE.test(wallet.bitassetsRpcUrl)));
  const [operation, setOperation] = useState<BitAssetsOperation>('transfer');
  const [forms, setForms] = useState(initialBitAssetsFormState);
  const [result, setResult] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [info, setInfo] = useState<BitAssetsWalletInfo | undefined>(wallet?.bitassetsInfo);
  const [utxos, setUtxos] = useState<BitAssetsUtxo[]>(wallet?.bitassetsUtxos ?? []);
  const [isLoading, setIsLoading] = useState(false);
  const submitInFlight = useRef(false);
  const operationRef = useRef<BitAssetsOperation>(operation);
  const formsRef = useRef(forms);
  const e2eLastReserveName = useRef('');
  const e2eLastRegisterTxid = useRef('');

  useEffect(() => {
    operationRef.current = operation;
  }, [operation]);

  useEffect(() => {
    formsRef.current = forms;
  }, [forms]);

  const selectBitAssetsOperation = (nextOperation: BitAssetsOperation) => {
    operationRef.current = nextOperation;
    setOperation(nextOperation);
  };
  const syncInFlight = useRef(false);

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
      sendIcon: { transform: [{ rotate: direction === 'rtl' ? '-225deg' : '225deg' }] },
      receiveIcon: { transform: [{ rotate: direction === 'rtl' ? '-45deg' : '45deg' }] },
    }),
    [colors.elevated, colors.foregroundColor, colors.formBorder, colors.inputBackgroundColor, direction],
  );

  const sync = useCallback(
    async (quiet = false) => {
      if (!wallet) return;
      if (syncInFlight.current || submitInFlight.current) return;
      syncInFlight.current = true;
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
        <BlueText>BitAssets wallet not found</BlueText>
      </View>
    );
  }

  const definition = BITASSETS_OPERATION_DEFINITIONS.find(item => item.key === operation) ?? BITASSETS_OPERATION_DEFINITIONS[0];
  const balances = info?.balances ?? wallet.bitassetsInfo?.balances ?? {};
  const confirmedCount =
    info?.confirmed_utxo_count ?? wallet.bitassetsInfo?.confirmed_utxo_count ?? utxos.filter(utxo => utxo.confirmed).length;
  const mempoolCount = info?.mempool_utxo_count ?? wallet.bitassetsInfo?.mempool_utxo_count ?? utxos.filter(utxo => !utxo.confirmed).length;
  const proofSummary = summarizeBitAssetsProofState(utxos);

  const updateField = (operationKey: BitAssetsOperation, key: string, value: string) => {
    setForms(current => {
      const nextForms = {
        ...current,
        [operationKey]: {
          ...current[operationKey],
          [key]: value,
        },
      };
      formsRef.current = nextForms;
      return nextForms;
    });
  };

  const updateE2EParams = (value: string) => {
    const parsedFields = value.split('&').reduce<Record<string, string>>((record, pair) => {
      const [rawKey, ...rawValueParts] = pair.split('=');
      if (!rawKey) return record;
      const rawValue = rawValueParts.join('=');
      record[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue ?? '');
      return record;
    }, {});
    const requestedOperation = BITASSETS_OPERATION_DEFINITIONS.find(item => item.key === parsedFields.__operation)?.key;
    delete parsedFields.__operation;
    const operationKey = requestedOperation ?? operationRef.current;
    if (requestedOperation) {
      operationRef.current = requestedOperation;
      setOperation(requestedOperation);
    }
    setForms(current => {
      const nextForms = {
        ...current,
        [operationKey]: {
          ...current[operationKey],
          ...parsedFields,
        },
      };
      formsRef.current = nextForms;
      return nextForms;
    });
  };

  const submit = async (operationOverride?: BitAssetsOperation, options: BitAssetsSubmitOptions = {}) => {
    if (submitInFlight.current) {
      setErrorMessage('BitAssets transaction is already in progress.');
      return;
    }
    submitInFlight.current = true;
    setIsLoading(true);
    setResult('');
    setErrorMessage('');
    Keyboard.dismiss();
    try {
      const submitOperation = operationOverride ?? operationRef.current;
      let submitForm = { ...formsRef.current[submitOperation] };
      if (bitassetsE2EControlsEnabled && options.applyTestDefaults === true) {
        const spendableAssetId = Object.entries(wallet.bitassetsInfo?.balances ?? {}).find(
          ([assetId, amount]) => !assetId.startsWith('control:') && !assetId.startsWith('lp:') && Number(amount) > 0,
        )?.[0];
        submitForm = applyBitAssetsE2ETestDefaults(submitOperation, submitForm, {
          walletAddress: wallet.getAddress() || '',
          spendableAssetId,
          lastReserveName: e2eLastReserveName.current,
          lastRegisterTxid: e2eLastRegisterTxid.current,
        });
      }
      const params = buildBitAssetsOperationParams(submitOperation, submitForm);
      if (__DEV__) {
        console.debug('[BitAssetsWallet] submit begin', submitOperation);
      }
      let txid: string;
      switch (submitOperation) {
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
      if (__DEV__) {
        if (submitOperation === 'reserve') {
          e2eLastReserveName.current = String((params as any).name ?? '');
        }
        if (submitOperation === 'register') {
          e2eLastRegisterTxid.current = txid;
        }
      }
      if (__DEV__) {
        console.debug('[BitAssetsWallet] submit ok', submitOperation, txid);
      }
      setResult(JSON.stringify({ operation: submitOperation, txid }, null, 2));
      setIsLoading(false);
      // Broadcast success should be visible immediately. The refresh can be slow
      // while local signet mines, so keep it off the submit critical path.
      sync(true).catch(error => {
        if (__DEV__) {
          console.warn('[BitAssetsWallet] post-broadcast sync failed', normalizeBitAssetsError(error));
        }
      });
    } catch (error: any) {
      const normalizedError = normalizeBitAssetsError(error);
      if (__DEV__) {
        console.debug('[BitAssetsWallet] submit error', operationOverride ?? operationRef.current, normalizedError);
      }
      setErrorMessage(normalizedError);
    } finally {
      submitInFlight.current = false;
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.flex}>
      <ScrollView
        style={[styles.root, stylesHook.root]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="always"
        testID="BitAssetsToolsScreen"
      >
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
            <StatusItem label="Proof-backed" value={String(proofSummary.proofBacked)} testID="BitAssetsProofBackedUtxoCount" />
            <StatusItem label="Proof status" value={proofSummary.label} testID="BitAssetsProofBackedUtxoStatus" />
          </View>
          {bitassetsE2EControlsEnabled && (
            <View style={styles.e2eOperationGrid} testID="BitAssetsE2ETopSubmitGrid">
              <Pressable
                testID="BitAssetsE2ETopSyncButton"
                accessibilityRole="button"
                accessibilityLabel="E2E top sync BitAssets wallet"
                style={styles.e2eOperationPill}
                onPress={() => sync(false)}
              >
                <BlueText>Sync wallet</BlueText>
              </Pressable>
              <Pressable
                testID="BitAssetsE2ETopSubmitCurrent"
                accessibilityRole="button"
                accessibilityLabel="E2E top submit current BitAssets form"
                style={styles.e2eOperationPill}
                onPress={() => submit()}
              >
                <BlueText>Submit current form</BlueText>
              </Pressable>
              {BITASSETS_OPERATION_DEFINITIONS.map(item => (
                <Pressable
                  key={item.key}
                  testID={`BitAssetsE2ETopSubmit-${item.key}`}
                  accessibilityRole="button"
                  accessibilityLabel={`E2E top submit ${item.label}`}
                  style={styles.e2eOperationPill}
                  onPress={() => submit(item.key, { applyTestDefaults: true })}
                >
                  <BlueText>{`Submit ${item.label}`}</BlueText>
                </Pressable>
              ))}
            </View>
          )}
        </BlueCard>

        <View style={styles.buttons}>
          <Button testID="BitAssetsSyncButton" title={isLoading ? 'Working...' : 'Sync'} onPress={() => sync(false)} disabled={isLoading} />
          {bitassetsE2EControlsEnabled ? (
            <View style={styles.e2eButtons}>
              <Button
                testID="BitAssetsE2ESyncButton"
                accessibilityLabel="Sync BitAssets wallet"
                title="E2E sync"
                onPress={() => sync(false)}
                disabled={false}
              />
              <Button
                testID="BitAssetsE2ESubmitButton"
                accessibilityLabel="Submit BitAssets operation"
                title="Submit operation"
                onPress={() => submit(undefined, { applyTestDefaults: true })}
                disabled={false}
              />
            </View>
          ) : null}
        </View>

        {bitassetsE2EControlsEnabled ? (
          <>
            <View style={styles.e2eOperationGrid} testID="BitAssetsE2EOperationGrid">
              {BITASSETS_OPERATION_DEFINITIONS.map(item => (
                <Pressable
                  key={item.key}
                  testID={`BitAssetsE2EOperation-${item.key}`}
                  accessibilityRole="button"
                  accessibilityLabel={`E2E ${item.label}`}
                  style={[
                    styles.e2eOperationPill,
                    {
                      backgroundColor: operation === item.key ? colors.mainColor : colors.buttonDisabledBackgroundColor,
                    },
                  ]}
                  onPress={() => {
                    selectBitAssetsOperation(item.key);
                    setResult('');
                    setErrorMessage('');
                  }}
                >
                  <BlueText style={{ color: operation === item.key ? colors.buttonTextColor : colors.foregroundColor }}>
                    {item.label}
                  </BlueText>
                </Pressable>
              ))}
            </View>
            <View style={styles.e2eOperationGrid} testID="BitAssetsE2ESubmitGrid">
              {BITASSETS_OPERATION_DEFINITIONS.map(item => (
                <Pressable
                  key={item.key}
                  testID={`BitAssetsE2ESubmit-${item.key}`}
                  accessibilityRole="button"
                  accessibilityLabel={`E2E submit ${item.label}`}
                  style={styles.e2eOperationPill}
                  onPress={() => submit(item.key, { applyTestDefaults: true })}
                >
                  <BlueText>{`Submit ${item.label}`}</BlueText>
                </Pressable>
              ))}
            </View>
            <View style={styles.e2eFields} testID="BitAssetsE2EFormFields">
              <TextInput
                testID="BitAssetsE2EOperationInput"
                value={operation}
                onChangeText={value => {
                  const nextOperation = BITASSETS_OPERATION_DEFINITIONS.find(item => item.key === value)?.key;
                  if (!nextOperation) return;
                  selectBitAssetsOperation(nextOperation);
                  setResult('');
                  setErrorMessage('');
                }}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="operation key"
                returnKeyType="done"
                style={[styles.input, stylesHook.input]}
              />
              <TextInput
                testID="BitAssetsE2EParamsInput"
                onChangeText={updateE2EParams}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="encoded e2e params"
                returnKeyType="done"
                style={[styles.input, stylesHook.input]}
              />
              {definition.fields.map(field => (
                <TextInput
                  key={field.key}
                  testID={`BitAssetsE2EField-${field.key}`}
                  value={forms[operation][field.key] ?? ''}
                  onChangeText={value => updateField(operation, field.key, value)}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={field.label}
                  multiline={field.multiline}
                  blurOnSubmit={!field.multiline}
                  returnKeyType={field.multiline ? 'default' : 'done'}
                  keyboardType="default"
                  style={[styles.input, field.multiline && styles.multilineInput, stylesHook.input]}
                />
              ))}
            </View>
          </>
        ) : null}

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
                  selectBitAssetsOperation(item.key);
                  setResult('');
                  setErrorMessage('');
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
                onChangeText={value => updateField(operation, field.key, value)}
                autoCapitalize="none"
                autoCorrect={false}
                multiline={field.multiline}
                blurOnSubmit={!field.multiline}
                returnKeyType={field.multiline ? 'default' : 'done'}
                onSubmitEditing={field.multiline || definition.fields.length > 1 ? undefined : () => submit()}
                keyboardType={field.type === 'number' ? 'number-pad' : 'default'}
                style={[styles.input, field.multiline && styles.multilineInput, stylesHook.input]}
              />
            </View>
          ))}

          {result ? (
            <View style={styles.operationMessage} testID="BitAssetsResult">
              <BlueText selectable testID="BitAssetsResultText">
                {result}
              </BlueText>
            </View>
          ) : null}

          {errorMessage ? (
            <View style={styles.operationMessage} testID="BitAssetsError">
              <BlueText selectable testID="BitAssetsErrorText">
                {errorMessage}
              </BlueText>
            </View>
          ) : null}

          <View style={styles.buttons}>
            <Button
              testID="BitAssetsBroadcastButton"
              accessibilityLabel={definition.submitLabel}
              title={definition.submitLabel}
              onPress={() => submit()}
              disabled={isLoading}
            />
            {bitassetsE2EControlsEnabled && (
              <Pressable
                testID={`BitAssetsE2ESubmitCurrent-${operation}`}
                accessibilityRole="button"
                accessibilityLabel={`E2E submit current ${definition.label}`}
                style={styles.e2eOperationPill}
                onPress={() => submit(operation, { applyTestDefaults: true })}
              >
                <BlueText>{`Submit current ${definition.label}`}</BlueText>
              </Pressable>
            )}
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
    paddingBottom: 320,
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
  e2eButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  e2eFields: {
    gap: 8,
    marginBottom: 12,
  },
  e2eOperationGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  e2eOperationPill: {
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
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
  operationMessage: {
    marginTop: 8,
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

export default BitAssetsTools;
