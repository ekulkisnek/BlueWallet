import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { unlockWithBiometrics, useBiometrics } from '../../hooks/useBiometrics';

import { BlueCard, BlueFormLabel, BlueText } from '../../BlueComponents';
import AddressInput from '../../components/AddressInput';
import Button from '../../components/Button';
import SafeArea from '../../components/SafeArea';
import { useTheme } from '../../components/themes';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';
import { LiquidWallet } from '../../class/wallets/liquid-wallet';
import { SendDetailsStackParamList } from '../../navigation/SendDetailsStackParamList';
import presentAlert from '../../components/Alert';
import { normalizeLiquidError } from '../../blue_modules/LiquidWalletForms';

type NavigationProps = NativeStackNavigationProp<SendDetailsStackParamList, 'LiquidSendDetails'>;
type RouteProps = RouteProp<SendDetailsStackParamList, 'LiquidSendDetails'>;

const LiquidSendDetails: React.FC = () => {
  const { colors } = useTheme();
  const { wallets } = useStorage();
  const navigation = useExtendedNavigation<NavigationProps>();
  const route = useRoute<RouteProps>();
  const { walletID } = route.params;

  const wallet = wallets.find(w => w.getID() === walletID) as LiquidWallet | undefined;

  const [destinationAddress, setDestinationAddress] = useState('');
  const [selectedAsset, setSelectedAsset] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [balances, setBalances] = useState<Record<string, number>>({});

  const { isBiometricUseCapableAndEnabled } = useBiometrics();

  const syncBalances = useCallback(async () => {
    if (!wallet) return;
    try {
      const info = await wallet.syncLiquid();
      const currentBalances = info.balances ?? {};
      setBalances(currentBalances);

      // Auto-select 'bitcoin' (L-BTC) first if present and has balance, else first asset
      const assetKeys = Object.keys(currentBalances);
      if (assetKeys.length > 0 && !selectedAsset) {
        const lbtc = assetKeys.find(k => k.toLowerCase() === 'bitcoin') || assetKeys.find(k => currentBalances[k] > 0) || assetKeys[0];
        setSelectedAsset(lbtc);
      }
    } catch (e) {
      console.warn('LiquidSendDetails sync failed', e);
    }
  }, [wallet, selectedAsset]);

  useFocusEffect(
    useCallback(() => {
      syncBalances();
    }, [syncBalances]),
  );

  const handleSend = async () => {
    if (!wallet) return;
    Keyboard.dismiss();

    if (!destinationAddress.trim()) {
      return presentAlert({ message: loc.send.details_address_field_is_not_valid });
    }

    if (!selectedAsset) {
      return presentAlert({ message: 'Please select an asset to send' });
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return presentAlert({ message: loc.send.details_amount_field_is_not_valid });
    }

    const availableBalance = balances[selectedAsset] ?? 0;
    if (numAmount > availableBalance) {
      return presentAlert({ message: 'Amount exceeds available balance for this asset' });
    }

    // Biometric / PIN gate before spend (matches BTC/Confirm pattern for security)
    if (await isBiometricUseCapableAndEnabled()) {
      if (!(await unlockWithBiometrics())) {
        return;
      }
    }

    setIsLoading(true);
    try {
      const txid = await wallet.transferLiquid({
        destinationAddress: destinationAddress.trim(),
        assetId: selectedAsset,
        amount: numAmount,
        memo: memo.trim() || undefined,
        feeSats: 0,
      });

      // Navigate to success
      navigation.navigate('Success', {
        amount: numAmount,
        amountUnit: (selectedAsset.toLowerCase() === 'bitcoin' ? 'L-BTC' : selectedAsset) as any,
        txid,
        invoiceDescription: memo.trim(),
      });

      // Trigger background sync
      wallet.syncLiquid().catch(console.warn);
    } catch (error) {
      const normErr = normalizeLiquidError(error);
      presentAlert({ message: normErr });
    } finally {
      setIsLoading(false);
    }
  };

  const handleMaxPress = () => {
    if (selectedAsset) {
      const maxVal = balances[selectedAsset] ?? 0;
      setAmount(String(maxVal));
    }
  };

  const stylesHook = StyleSheet.create({
    root: {
      backgroundColor: colors.elevated,
    },
    walletLabel: {
      color: colors.foregroundColor,
    },
    input: {
      borderColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
      color: colors.foregroundColor,
    },
    assetPillActive: {
      backgroundColor: colors.mainColor,
    },
    assetPillInactive: {
      backgroundColor: colors.buttonDisabledBackgroundColor,
    },
    assetPillTextActive: {
      color: colors.buttonTextColor,
    },
    assetPillTextInactive: {
      color: colors.foregroundColor,
    },
    maxText: {
      color: colors.mainColor,
    },
  });

  if (!wallet) {
    return (
      <SafeArea style={[styles.root, stylesHook.root]}>
        <View style={styles.center}>
          <BlueText>Wallet not found</BlueText>
        </View>
      </SafeArea>
    );
  }

  const assetList = Object.entries(balances);

  const getAssetLabel = (assetId: string, bal: number) => {
    if (assetId.toLowerCase() === 'bitcoin') return `L-BTC (${bal})`;
    return `${assetId} (${bal})`;
  };

  return (
    <SafeArea style={[styles.root, stylesHook.root]}>
      <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={styles.scrollContent}>
        <View style={styles.walletHeader}>
          <Text style={[styles.walletLabel, stylesHook.walletLabel]}>{wallet.getLabel()}</Text>
          <BlueText style={styles.rpcUrl}>{wallet.elementsRpcUrl}</BlueText>
        </View>

        <BlueCard>
          <BlueFormLabel>{loc.send.details_address}</BlueFormLabel>
          <AddressInput
            isLoading={isLoading}
            address={destinationAddress}
            placeholder={loc.send.details_address}
            onChangeText={setDestinationAddress}
          />

          <BlueFormLabel style={styles.formLabel}>Asset (L-BTC or token)</BlueFormLabel>
          {assetList.length === 0 ? (
            <Text style={styles.noAssets}>No assets available to send. Sync the wallet first.</Text>
          ) : (
            <View style={styles.assetGrid}>
              {assetList.map(([assetId, bal]) => (
                <Pressable
                  key={assetId}
                  testID={`LiquidAssetPill-${assetId}`}
                  style={[styles.assetPill, selectedAsset === assetId ? stylesHook.assetPillActive : stylesHook.assetPillInactive]}
                  onPress={() => {
                    setSelectedAsset(assetId);
                    setAmount('');
                  }}
                >
                  <Text
                    style={[
                      styles.assetPillText,
                      selectedAsset === assetId ? stylesHook.assetPillTextActive : stylesHook.assetPillTextInactive,
                    ]}
                  >
                    {getAssetLabel(assetId, bal)}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          <BlueFormLabel style={styles.formLabel}>{loc.send.create_amount}</BlueFormLabel>
          <View style={[styles.amountContainer, stylesHook.input]}>
            <TextInput
              testID="LiquidAmountInput"
              style={styles.amountInput}
              placeholder="0"
              placeholderTextColor="#81868e"
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
              editable={!isLoading && !!selectedAsset}
            />
            {!!selectedAsset && (
              <Pressable onPress={handleMaxPress} style={styles.maxButton}>
                <Text style={[styles.maxText, stylesHook.maxText]}>MAX</Text>
              </Pressable>
            )}
          </View>

          <BlueFormLabel style={styles.formLabel}>{loc.send.details_note_placeholder}</BlueFormLabel>
          <TextInput
            testID="LiquidMemoInput"
            style={[styles.input, stylesHook.input]}
            placeholder={loc.send.details_note_placeholder}
            placeholderTextColor="#81868e"
            value={memo}
            onChangeText={setMemo}
            editable={!isLoading}
          />
          <BlueText style={styles.hint}>
            Amounts are in the asset's base unit (e.g. sats for L-BTC on Elements). Confirm with your node.
          </BlueText>
        </BlueCard>
      </ScrollView>

      <View style={styles.buttonContainer}>
        {isLoading ? (
          <ActivityIndicator size="large" />
        ) : (
          <Button
            testID="LiquidSendButton"
            title={loc.send.details_next}
            onPress={handleSend}
            disabled={!destinationAddress || !amount || !selectedAsset}
          />
        )}
      </View>
    </SafeArea>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  walletHeader: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  walletLabel: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  rpcUrl: {
    fontSize: 12,
    opacity: 0.7,
    marginTop: 4,
  },
  formLabel: {
    marginTop: 16,
  },
  assetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  assetPill: {
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 90,
    justifyContent: 'center',
    alignItems: 'center',
  },
  assetPillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  noAssets: {
    color: '#81868e',
    fontSize: 14,
    marginTop: 8,
  },
  amountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 44,
  },
  amountInput: {
    flex: 1,
    color: 'inherit',
    fontSize: 16,
    height: '100%',
  },
  maxButton: {
    paddingHorizontal: 8,
    height: '100%',
    justifyContent: 'center',
  },
  maxText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  buttonContainer: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    paddingTop: 12,
  },
  hint: {
    fontSize: 11,
    opacity: 0.6,
    marginTop: 8,
  },
});

export default LiquidSendDetails;
