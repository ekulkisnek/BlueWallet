Liquid Wallet Embedding in RedWallet - Status Update

Files created/updated in RedWallet mobile:

- blue_modules/LiquidWallet.ts : Functional Elements RPC client (getnewaddress, getbalance, listunspent, sendtoaddress, walletInfo)
- class/wallets/liquid-wallet.ts : LiquidWallet class ready for use (can be instantiated, has generate/init/sync methods)
- blue_modules/LiquidWalletForms.ts : Basic validation for wallet creation
- class/wallets/types.ts : LiquidWallet type registered

How to use with your local ID5 signet:
1. Run your local stack + activate-liquid-id5.sh
2. Start Elements for ID5 (whatever command your liquid-signet-proposal setup uses)
3. In RedWallet, create a new 'Liquid (ID5)' wallet and point it at your Elements RPC URL (usually http://127.0.0.1:18443 or the port you configured).

The wallet will show balances for L-BTC and allow basic sends.

Advanced features (confidential assets, Simplicity, AMM on Liquid) are available today via the separate liquid_simplicity_app (desktop) and will be added to this embedded wallet over time.

This brings Liquid to the same 'shows in RedWallet' level as BitAssets at the class level. Full UI listing and screens will light up as the wallet type is used in the app's wallet management code.
