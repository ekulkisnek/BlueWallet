Liquid Wallet in RedWallet - Status Update

Files created/updated in RedWallet mobile:

- blue_modules/LiquidWallet.ts : Functional Elements JSON-RPC client (getnewaddress, getbalance, listunspent, sendtoaddress, walletInfo)
- class/wallets/liquid-wallet.ts : LiquidWallet class ready for use (generate/init/sync/send via credentialed Elements wallet RPC URLs)
- blue_modules/LiquidWalletForms.ts : Basic validation for wallet creation
- class/wallets/types.ts : LiquidWallet type registered
- scripts/seed-ios-simulator-liquid-wallet.sh : Creates a Liquid wallet inside a selected iOS simulator and writes proof output
- scripts/send-ios-simulator-liquid-command.sh : Pushes sync/transfer commands to an existing simulator Liquid wallet

How to use with your local ID5 signet:
1. Run your local stack + activate-liquid-id5.sh
2. Start Elements for ID5 (whatever command your liquid-signet-proposal setup uses)
3. In RedWallet, create a new 'Liquid (L-BTC)' wallet and point it at your Elements wallet RPC URL.

For local iOS simulator proof, use a wallet-scoped URL with RPC credentials, for example:

```sh
http://__cookie__:<cookie-password>@127.0.0.1:18443/wallet/redwallet-a
```

The JSON-RPC path has been proved on two iOS simulators against the local Liquid ID5 Elements regtest stack:

- RedWallet-A wallet: `2fa8461a412f033b68fb6d882ad4bdb999aa1545e3ad7f97a6a2106174f4bf6c`
- RedWallet-B wallet: `2f013ef07850cf6c2ebd7adf2d2b7b33c01dd117116cf3c01d76729de47a7372`
- A -> B txid: `1dd62d0f2be9bc6b795d827957ca30a1c203cfd5ea623b3814fe1feb4e35436f`
- Receiver simulator sync: B saw `100000` sats of `bitcoin` L-BTC in one UTXO after the transaction confirmed at Elements height `203`.

Advanced native embedded features (confidential asset workflows, Simplicity, AMM on Liquid, native CT signer transfers without Elements wallet RPC) are still separate follow-up work. The mobile production-ready path today is the credentialed Elements wallet RPC path above.
