import { sha256 } from '@noble/hashes/sha256';
import { element } from 'detox';

/**
 * Captures a stack trace at the call site, excluding the given function from the trace.
 * Used to make Detox errors point to the spec file line instead of helper internals.
 */
function captureCallsite(excludeFn) {
  const callsite = {};
  Error.captureStackTrace(callsite, excludeFn);
  return callsite;
}

/**
 * Rethrows err with the stack rewritten to point at the call site.
 */
function rethrowWithCallsite(err, callsite) {
  if (err && typeof err === 'object' && callsite && callsite.stack) {
    const name = err.name || 'Error';
    const message = err.message || '';
    const frames = callsite.stack.split('\n').slice(1).join('\n');
    err.stack = `${name}: ${message}\n${frames}`;
  }
  throw err;
}

export async function waitForId(id, timeout = 33000) {
  const callsite = captureCallsite(waitForId);
  try {
    await waitFor(element(by.id(id)))
      .toBeVisible()
      .withTimeout(timeout / 2);
  } catch (_) {
    // nop
  }

  try {
    await waitFor(element(by.id(id)))
      .toBeVisible()
      .withTimeout(timeout / 2);
  } catch (err) {
    rethrowWithCallsite(err, callsite);
  }
}

export async function waitForText(text, timeout = 33000) {
  const callsite = captureCallsite(waitForText);
  try {
    await waitFor(element(by.text(text)))
      .toBeVisible()
      .withTimeout(timeout / 2);
    return true;
  } catch (_) {
    // nop
  }

  try {
    await waitFor(element(by.text(text)))
      .toBeVisible()
      .withTimeout(timeout / 2);
  } catch (err) {
    rethrowWithCallsite(err, callsite);
  }
}

export async function getSwitchValue(switchId) {
  try {
    await expect(element(by.id(switchId))).toHaveToggleValue(true);
    return true;
  } catch (_) {
    return false;
  }
}

export async function helperImportWallet(importText, walletType, expectedWalletLabel, expectedBalance, passphrase) {
  await waitForId('WalletsList');
  await waitFor(element(by.id('CreateAWallet')))
    .toBeVisible()
    .whileElement(by.id('WalletsList'))
    .scroll(500, 'right'); // in case emu screen is small and it doesnt fit
  // going to Import Wallet screen and importing mnemonic
  await tapAndTapAgainIfElementIsNotVisible('CreateAWallet', 'ImportWallet');
  await element(by.id('ImportWallet')).tap();
  await waitForId('SpeedBackdoor');
  // tapping 5 times invisible button is a backdoor:
  for (let c = 0; c < 5; c++) {
    await element(by.id('SpeedBackdoor')).tap();
  }
  await element(by.id('SpeedMnemonicInput')).replaceText(importText);
  await element(by.id('SpeedWalletTypeInput')).replaceText(walletType);
  if (device.getPlatform() === 'ios') {
    await element(by.id('SpeedWalletTypeInput')).tapReturnKey();
  }
  if (passphrase) {
    await element(by.id('SpeedPassphraseInput')).replaceText(passphrase);
    await element(by.id('SpeedPassphraseInput')).tapReturnKey();
    await waitForKeyboardToClose();
  }
  await element(by.id('SpeedDoImport')).tap();

  try {
    await sleep(1_000);
    await element(by.id('SpeedDoImport')).tap(); // sometimes doesnt work the 1st time
  } catch (_) {}

  // waiting for import result
  await waitForText('OK', 3 * 61000);
  await element(by.text('OK')).tap();
  await scrollUpOnHomeScreen();

  // lets go inside wallet
  await element(by.text(expectedWalletLabel)).tap();
  // label might change in the future
  await expect(element(by.id('WalletBalance'))).toHaveText(expectedBalance);
}

export async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Aggressive dismiss for common RN/Detox alert/prompt/nav modals after launch or fund/mine.
 * Safe to call anytime; swallows errors.
 */
export async function dismissGeneralAlerts() {
  const labels = ['Cancel', 'Try again', 'Reset', 'Reset to default', 'OK', 'Ok', 'Continue', 'Skip', 'Not Now', 'Not now', 'Later', 'Close', 'Dismiss'];
  for (let round = 0; round < 5; round++) {
    for (const label of labels) {
      try {
        await waitFor(element(by.text(label)))
          .toBeVisible()
          .withTimeout(1000);
        await element(by.text(label)).tap();
        await sleep(300);
      } catch (_) {}
    }
    try {
      await element(by.id('NavigationCloseButton')).atIndex(0).tap();
    } catch (_) {}
  }
}

/**
 * Robustly reset nav stack back to WalletsList root after fund/mine or receive flows.
 * Addresses "L1SendE2E not found" / app busy main queue after external block mine.
 * Uses disableSync + back taps + dismiss.
 */
export async function resetToWalletsList(maxAttempts = 6) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await waitFor(element(by.id('WalletsList')))
        .toBeVisible()
        .withTimeout(2500);
      return true;
    } catch (_) {
      try {
        await element(by.id('BackButton')).atIndex(0).tap();
      } catch (_) {}
      try {
        await element(by.id('NavigationCloseButton')).atIndex(0).tap();
      } catch (_) {}
      await dismissGeneralAlerts();
      await sleep(350);
    }
  }
  // Final best-effort
  try {
    await waitFor(element(by.id('WalletsList'))).toBeVisible().withTimeout(3000);
    return true;
  } catch (_) {
    return false;
  }
}

export function hashIt(s) {
  return Buffer.from(sha256(s)).toString('hex');
}

export async function helperDeleteWallet(label, remainingBalanceSat = false) {
  await element(by.text(label)).tap();
  await element(by.id('WalletDetails')).tap();
  await element(by.id('WalletDetailsScroll')).swipe('up', 'fast', 1);
  await sleep(200);
  await element(by.id('HeaderMenuButton')).tap();
  await element(by.text('Delete')).tap();
  await waitForText('Yes, delete');
  await element(by.text('Yes, delete')).tap();
  if (remainingBalanceSat) {
    // await element(by.type('android.widget.EditText')).typeText(remainingBalanceSat);
    await typeTextIntoAlertInput(remainingBalanceSat);
    await element(by.text('Delete')).tap();
  }
  await waitForId('NoTransactionsMessage');
}

/**
 * Extracts element text or label using getAttributes()
 * @returns {Promise<string>}
 */
export async function extractTextFromElementById(id) {
  const attributes = await element(by.id(id)).getAttributes();
  return attributes.value || attributes.label;
}

export const expectToBeVisible = async id => {
  try {
    await expect(element(by.id(id))).toBeVisible();
    return true;
  } catch (e) {
    return false;
  }
};

export async function helperCreateWallet(walletName) {
  // Early disable + aggressive dismiss for fresh delete:true sim launches (addresses WalletsList/CreateAWallet flakes post-wip)
  try {
    if (device.getPlatform() === 'ios') {
      await device.disableSynchronization();
    }
  } catch (_) {}
  await dismissGeneralAlerts();
  await resetToWalletsList(4);

  await waitFor(element(by.id('CreateAWallet')))
    .toBeVisible()
    .whileElement(by.id('WalletsList'))
    .scroll(500, 'right'); // in case emu screen is small and it doesnt fit

  await sleep(200); // Wait until bounce animation finishes.
  await dismissGeneralAlerts();
  await tapAndTapAgainIfElementIsNotVisible('CreateAWallet', 'WalletNameInput');
  await element(by.id('WalletNameInput')).replaceText(walletName || 'cr34t3d');
  await waitForId('ActivateBitcoinButton');
  await element(by.id('ActivateBitcoinButton')).tap();
  await element(by.id('ActivateBitcoinButton')).tap();
  // why tf we need 2 taps for it to work..? mystery
  await tapAndTapAgainIfElementIsNotVisible('Create', 'PleaseBackupScrollView');

  await waitFor(element(by.id('PleasebackupOk')))
    .toBeVisible()
    .whileElement(by.id('PleaseBackupScrollView'))
    .scroll(500, 'down'); // in case emu screen is small and it doesnt fit

  await element(by.id('PleasebackupOk')).tap();
  await scrollUpOnHomeScreen();
  await expect(element(by.id('WalletsList'))).toBeVisible();
  await element(by.id('WalletsList')).swipe('right', 'fast', 1); // in case emu screen is small and it doesnt fit
  await sleep(200);
  await expect(element(by.id(walletName || 'cr34t3d'))).toBeVisible();
}

export async function tapAndTapAgainIfElementIsNotVisible(idToTap, idToCheckVisible) {
  const callsite = captureCallsite(tapAndTapAgainIfElementIsNotVisible);
  // tap
  await element(by.id(idToTap)).tap();

  // check if visible
  try {
    await waitFor(element(by.id(idToCheckVisible)))
      .toBeVisible()
      .withTimeout(8_000);
    return; // did not throw? its visible, return
  } catch (_) {}

  try {
    await waitFor(element(by.id(idToTap)))
      .toBeVisible()
      .withTimeout(1_000);
  } catch (_) {
    try {
      await waitFor(element(by.id(idToCheckVisible)))
        .toBeVisible()
        .withTimeout(8_000);
      return;
    } catch (err) {
      rethrowWithCallsite(err, callsite);
    }
  }

  // did not return so its not visible, lets tap again
  await element(by.id(idToTap)).tap();

  // check visibility again, this time no try-catch, if it fails it fails
  try {
    await waitFor(element(by.id(idToCheckVisible)))
      .toBeVisible()
      .withTimeout(8_000);
  } catch (err) {
    rethrowWithCallsite(err, callsite);
  }
}

export async function tapAndTapAgainIfTextIsNotVisible(textToTap, textToCheckVisible) {
  const callsite = captureCallsite(tapAndTapAgainIfTextIsNotVisible);
  // tap
  await element(by.text(textToTap)).tap();

  // check if visible
  try {
    await waitFor(element(by.text(textToCheckVisible)))
      .toBeVisible()
      .withTimeout(3_000);
    return; // did not throw? its visible, return
  } catch (_) {}

  // did not return so its not visible, lets tap again
  await element(by.text(textToTap)).tap();

  // check visibility again, this time no try-catch, if it fails it fails
  try {
    await waitFor(element(by.text(textToCheckVisible)))
      .toBeVisible()
      .withTimeout(3_000);
  } catch (err) {
    rethrowWithCallsite(err, callsite);
  }
}

export async function tapIfPresent(id) {
  try {
    await element(by.id(id)).tap();
  } catch (_) {}
  // no need to check for visibility, just silently ignore exception if such testID is not present
}

export async function tapIfTextPresent(text) {
  try {
    await element(by.text(text)).tap();
  } catch (_) {}
  // no need to check for visibility, just silently ignore exception if such testID is not present
}

export async function countElements(testId) {
  let count = 0;
  while (true) {
    try {
      await expect(element(by.id(testId)).atIndex(count)).toBeVisible();
      count++;
    } catch (_) {
      break;
    }
  }
  return count;
}

export async function scanText(text) {
  await waitForId('ScanQrBackdoorButton');
  for (let c = 0; c <= 5; c++) {
    await element(by.id('ScanQrBackdoorButton')).tap();
  }
  await element(by.id('scanQrBackdoorInput')).replaceText(text);
  await element(by.id('scanQrBackdoorOkButton')).tap();
}

export async function goBack() {
  if (device.getPlatform() === 'ios') {
    try {
      await element(by.id('BackButton')).atIndex(0).tap();
    } catch (_) {
      await element(by.id('NavigationCloseButton')).atIndex(0).tap();
    }
  } else {
    await device.pressBack();
  }
}

export async function typeTextIntoAlertInput(text) {
  if (device.getPlatform() === 'android') {
    await element(by.type('android.widget.EditText')).replaceText(text);
  } else {
    await element(by.type('_UIAlertControllerTextField')).replaceText(text);
  }
  await sleep(1000);
}

/**
 * Scrolls up on the home screen. This is needed on the iOS.
 */
export async function scrollUpOnHomeScreen() {
  if (device.getPlatform() !== 'ios') {
    return;
  }
  try {
    await element(by.type('RCTEnhancedScrollView').withDescendant(by.type('RCTEnhancedScrollView'))).swipe('down', 'slow', 0.5);
  } catch (_) {
    try {
      await element(by.type('RCTEnhancedScrollView'))
        .atIndex(0)
        .swipe('down', 'slow', 0.5);
    } catch (_) {
      await element(by.id('WalletsList')).swipe('down', 'slow', 0.5);
    }
  }
  await sleep(200); // bounce animation
}

// We really only need this function when running tests locally.
// In GitHub Actions, we run Android tests with a hardware keyboard, so the onscreen keyboard doesn’t appear.
// On iOS, it doesn’t cause any known issues.
export async function waitForKeyboardToClose() {
  if (device.getPlatform() === 'ios' || process.env.CI) {
    return;
  }
  await sleep(500);
}
