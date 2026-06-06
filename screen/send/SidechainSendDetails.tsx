import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { unlockWithBiometrics, useBiometrics } from '../../hooks/useBiometrics';

import { BlueCard, BlueFormLabel, BlueText } from '../../BlueComponents';
import AddressInput from '../../components/AddressInput';
import Button from '../../components/Button';
import { DismissKeyboardInputAccessory, DismissKeyboardInputAccessoryViewID } from '../../components/DismissKeyboardInputAccessory';
import SafeArea from '../../components/SafeArea';
import { useTheme } from '../../components/themes';
import loc from '../../loc';
import presentAlert from '../../components/Alert';

export type SidechainSendWallet = {
  getLabel: () => string;
};

type SidechainSendDetailsProps = {
  wallet: SidechainSendWallet | undefined;
  walletNotFoundText?: string;
  amountPlaceholder?: string;
  addressValidation?: (address: string) => string | undefined;
  syncBalances: () => Promise<Record<string, number>>;
  chooseInitialAsset: (balances: Record<string, number>) => string | undefined;
  formatAssetLabel: (assetId: string, balance: number) => string;
  send: (params: { destinationAddress: string; assetId: string; amount: number; memo?: string }) => Promise<string>;
  onSent: (params: { txid: string; amount: number; assetId: string; memo: string }) => void;
  onBackgroundSync?: () => void;
  normalizeError: (error: unknown) => string;
  testIDPrefix: 'BitAssets' | 'Liquid';
};

const SidechainSendDetails: React.FC<SidechainSendDetailsProps> = ({
  wallet,
  walletNotFoundText = 'Wallet not found',
  amountPlaceholder = '0',
  addressValidation,
  syncBalances,
  chooseInitialAsset,
  formatAssetLabel,
  send,
  onSent,
  onBackgroundSync,
  normalizeError,
  testIDPrefix,
}) => {
  const { colors } = useTheme();
  const { isBiometricUseCapableAndEnabled } = useBiometrics();

  const [destinationAddress, setDestinationAddress] = useState('');
  const [selectedAsset, setSelectedAsset] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [balances, setBalances] = useState<Record<string, number>>({});

  const refreshBalances = useCallback(async () => {
    if (!wallet) return;
    try {
      const currentBalances = await syncBalances();
      setBalances(currentBalances);

      const assetKeys = Object.keys(currentBalances);
      if (assetKeys.length > 0 && !selectedAsset) {
        const initialAsset = chooseInitialAsset(currentBalances);
        if (initialAsset) {
          setSelectedAsset(initialAsset);
        }
      }
    } catch (error) {
      console.warn(`${testIDPrefix}SendDetails sync failed`, error);
    }
  }, [chooseInitialAsset, selectedAsset, syncBalances, testIDPrefix, wallet]);

  useFocusEffect(
    useCallback(() => {
      refreshBalances();
    }, [refreshBalances]),
  );

  const handleSend = async () => {
    if (!wallet) return;
    Keyboard.dismiss();

    const addr = destinationAddress.trim();
    if (!addr) {
      return presentAlert({ message: loc.send.details_address_field_is_not_valid });
    }

    const addressError = addressValidation?.(addr);
    if (addressError) {
      return presentAlert({ message: addressError });
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

    if (await isBiometricUseCapableAndEnabled()) {
      if (!(await unlockWithBiometrics())) {
        return;
      }
    }

    setIsLoading(true);
    try {
      const txid = await send({
        destinationAddress: addr,
        assetId: selectedAsset,
        amount: numAmount,
        memo: memo.trim() || undefined,
      });

      onSent({ txid, amount: numAmount, assetId: selectedAsset, memo: memo.trim() });
      onBackgroundSync?.();
    } catch (error) {
      presentAlert({ message: normalizeError(error) });
    } finally {
      setIsLoading(false);
    }
  };

  const handleMaxPress = () => {
    if (selectedAsset) {
      setAmount(String(balances[selectedAsset] ?? 0));
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
          <BlueText>{walletNotFoundText}</BlueText>
        </View>
      </SafeArea>
    );
  }

  const assetList = Object.entries(balances);

  return (
    <SafeArea style={[styles.root, stylesHook.root]}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <KeyboardAvoidingView style={styles.keyboardAvoidingView} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.scrollContent}
            automaticallyAdjustKeyboardInsets
          >
            <View style={styles.walletHeader}>
              <Text style={[styles.walletLabel, stylesHook.walletLabel]}>{wallet.getLabel()}</Text>
            </View>

            <BlueCard>
              <BlueFormLabel>{loc.send.details_address}</BlueFormLabel>
              <AddressInput
                isLoading={isLoading}
                address={destinationAddress}
                placeholder={loc.send.details_address}
                onChangeText={setDestinationAddress}
                inputAccessoryViewID={DismissKeyboardInputAccessoryViewID}
              />

              <BlueFormLabel style={styles.formLabel}>Asset</BlueFormLabel>
              {assetList.length === 0 ? (
                <Text style={styles.noAssets}>No assets available to send.</Text>
              ) : (
                <View style={styles.assetGrid}>
                  {assetList.map(([assetId, balance]) => (
                    <Pressable
                      key={assetId}
                      testID={`${testIDPrefix}AssetPill-${assetId}`}
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
                        {formatAssetLabel(assetId, balance)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <BlueFormLabel style={styles.formLabel}>{loc.send.create_amount}</BlueFormLabel>
              <View style={[styles.amountContainer, stylesHook.input]}>
                <TextInput
                  testID={`${testIDPrefix}AmountInput`}
                  style={[styles.amountInput, stylesHook.input]}
                  placeholder={amountPlaceholder}
                  placeholderTextColor="#81868e"
                  keyboardType="decimal-pad"
                  value={amount}
                  onChangeText={setAmount}
                  editable={!isLoading && !!selectedAsset}
                  onSubmitEditing={Keyboard.dismiss}
                  inputAccessoryViewID={DismissKeyboardInputAccessoryViewID}
                />
                {!!selectedAsset && (
                  <Pressable onPress={handleMaxPress} style={styles.maxButton}>
                    <Text style={[styles.maxText, stylesHook.maxText]}>MAX</Text>
                  </Pressable>
                )}
              </View>

              <BlueFormLabel style={styles.formLabel}>{loc.send.details_note_placeholder}</BlueFormLabel>
              <TextInput
                testID={`${testIDPrefix}MemoInput`}
                style={[styles.input, stylesHook.input]}
                placeholder={loc.send.details_note_placeholder}
                placeholderTextColor="#81868e"
                value={memo}
                onChangeText={setMemo}
                editable={!isLoading}
                onSubmitEditing={Keyboard.dismiss}
                inputAccessoryViewID={DismissKeyboardInputAccessoryViewID}
              />
            </BlueCard>
          </ScrollView>

          <View style={styles.buttonContainer}>
            {isLoading ? (
              <ActivityIndicator size="large" />
            ) : (
              <Button
                testID={`${testIDPrefix}SendButton`}
                title={loc.send.details_next}
                onPress={handleSend}
                disabled={!destinationAddress || !amount || !selectedAsset}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
      <DismissKeyboardInputAccessory />
    </SafeArea>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  keyboardAvoidingView: {
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
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontSize: 16,
    height: '100%',
    paddingHorizontal: 0,
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
});

export default SidechainSendDetails;
