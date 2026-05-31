## Liquid Wallet Embedding Progress (RedWallet mobile)

-  — functional RPC client for Elements (ID5) + interfaces
-  — basic LiquidWallet class (extends LegacyWallet pattern)
-  — validation for creation
- Registered in 

Current status: Liquid can now be created as a wallet type in RedWallet. It connects to a local Elements node (after running the ID5 activation stack) and supports basic balance + send for L-BTC.

Next: Full UI integration, native module for performance (like BitAssets), confidential asset display, and Simplicity/AMM flows.

See liquid-simplicity for the reference desktop implementation of advanced features.
