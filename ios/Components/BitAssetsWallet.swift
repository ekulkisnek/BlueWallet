import Foundation

struct FlorestaBitAssetsFfiResult {
    let ok: Bool
    let value: UnsafeMutablePointer<CChar>?
}

@_silgen_name("floresta_bitassets_wallet_open")
func floresta_bitassets_wallet_open(_ configJson: UnsafePointer<CChar>) -> FlorestaBitAssetsFfiResult
@_silgen_name("floresta_bitassets_wallet_free")
func floresta_bitassets_wallet_free(_ handle: UInt)
@_silgen_name("floresta_bitassets_string_free")
func floresta_bitassets_string_free(_ value: UnsafeMutablePointer<CChar>?)
@_silgen_name("floresta_bitassets_wallet_get_new_address")
func floresta_bitassets_wallet_get_new_address(_ handle: UInt) -> FlorestaBitAssetsFfiResult
@_silgen_name("floresta_bitassets_wallet_info")
func floresta_bitassets_wallet_info(_ handle: UInt) -> FlorestaBitAssetsFfiResult
@_silgen_name("floresta_bitassets_wallet_sync")
func floresta_bitassets_wallet_sync(_ handle: UInt) -> FlorestaBitAssetsFfiResult
@_silgen_name("floresta_bitassets_wallet_list_utxos")
func floresta_bitassets_wallet_list_utxos(_ handle: UInt) -> FlorestaBitAssetsFfiResult
@_silgen_name("floresta_bitassets_wallet_get_balance")
func floresta_bitassets_wallet_get_balance(_ handle: UInt, _ assetId: UnsafePointer<CChar>?) -> FlorestaBitAssetsFfiResult
@_silgen_name("floresta_bitassets_wallet_transfer")
func floresta_bitassets_wallet_transfer(_ handle: UInt, _ paramsJson: UnsafePointer<CChar>) -> FlorestaBitAssetsFfiResult
@_silgen_name("floresta_bitassets_wallet_reserve")
func floresta_bitassets_wallet_reserve(_ handle: UInt, _ paramsJson: UnsafePointer<CChar>) -> FlorestaBitAssetsFfiResult
@_silgen_name("floresta_bitassets_wallet_register")
func floresta_bitassets_wallet_register(_ handle: UInt, _ paramsJson: UnsafePointer<CChar>) -> FlorestaBitAssetsFfiResult
@_silgen_name("floresta_bitassets_wallet_amm_mint")
func floresta_bitassets_wallet_amm_mint(_ handle: UInt, _ paramsJson: UnsafePointer<CChar>) -> FlorestaBitAssetsFfiResult
@_silgen_name("floresta_bitassets_wallet_amm_swap")
func floresta_bitassets_wallet_amm_swap(_ handle: UInt, _ paramsJson: UnsafePointer<CChar>) -> FlorestaBitAssetsFfiResult
@_silgen_name("floresta_bitassets_wallet_amm_burn")
func floresta_bitassets_wallet_amm_burn(_ handle: UInt, _ paramsJson: UnsafePointer<CChar>) -> FlorestaBitAssetsFfiResult
@_silgen_name("floresta_bitassets_wallet_dutch_auction_create")
func floresta_bitassets_wallet_dutch_auction_create(_ handle: UInt, _ paramsJson: UnsafePointer<CChar>) -> FlorestaBitAssetsFfiResult
@_silgen_name("floresta_bitassets_wallet_dutch_auction_bid")
func floresta_bitassets_wallet_dutch_auction_bid(_ handle: UInt, _ paramsJson: UnsafePointer<CChar>) -> FlorestaBitAssetsFfiResult
@_silgen_name("floresta_bitassets_wallet_dutch_auction_collect")
func floresta_bitassets_wallet_dutch_auction_collect(_ handle: UInt, _ paramsJson: UnsafePointer<CChar>) -> FlorestaBitAssetsFfiResult

@objc(BitAssetsWalletModule)
class BitAssetsWalletModule: NSObject, NativeBitAssetsWalletSpec {
    private var handle: UInt = 0

    static func moduleName() -> String! { "BitAssetsWallet" }
    static func requiresMainQueueSetup() -> Bool { false }

    @objc func getNewAddress(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        call(resolve, reject) { floresta_bitassets_wallet_get_new_address(try self.openWallet()) }
    }

    @objc func walletInfo(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        call(resolve, reject) { floresta_bitassets_wallet_info(try self.openWallet()) }
    }

    @objc func sync(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        call(resolve, reject) { floresta_bitassets_wallet_sync(try self.openWallet()) }
    }

    @objc func listUtxos(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        call(resolve, reject) { floresta_bitassets_wallet_list_utxos(try self.openWallet()) }
    }

    @objc func getBalance(_ assetId: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        call(resolve, reject) {
            if assetId.isEmpty {
                return floresta_bitassets_wallet_get_balance(try self.openWallet(), nil)
            }
            return assetId.withCString { floresta_bitassets_wallet_get_balance(try! self.openWallet(), $0) }
        }
    }

    @objc func transfer(_ paramsJson: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        callJson(paramsJson, resolve, reject, floresta_bitassets_wallet_transfer)
    }

    @objc func reserve(_ paramsJson: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        callJson(paramsJson, resolve, reject, floresta_bitassets_wallet_reserve)
    }

    @objc func register(_ paramsJson: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        callJson(paramsJson, resolve, reject, floresta_bitassets_wallet_register)
    }

    @objc func ammMint(_ paramsJson: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        callJson(paramsJson, resolve, reject, floresta_bitassets_wallet_amm_mint)
    }

    @objc func ammSwap(_ paramsJson: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        callJson(paramsJson, resolve, reject, floresta_bitassets_wallet_amm_swap)
    }

    @objc func ammBurn(_ paramsJson: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        callJson(paramsJson, resolve, reject, floresta_bitassets_wallet_amm_burn)
    }

    @objc func dutchAuctionCreate(_ paramsJson: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        callJson(paramsJson, resolve, reject, floresta_bitassets_wallet_dutch_auction_create)
    }

    @objc func dutchAuctionBid(_ paramsJson: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        callJson(paramsJson, resolve, reject, floresta_bitassets_wallet_dutch_auction_bid)
    }

    @objc func dutchAuctionCollect(_ paramsJson: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        callJson(paramsJson, resolve, reject, floresta_bitassets_wallet_dutch_auction_collect)
    }

    private func openWallet() throws -> UInt {
        if handle != 0 { return handle }
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let walletDirectory = directory.appendingPathComponent("bitassets", isDirectory: true)
        try FileManager.default.createDirectory(at: walletDirectory, withIntermediateDirectories: true)
        let config: [String: Any] = [
            "path": walletDirectory.appendingPathComponent("wallet.json").path,
            "rpc_url": UserDefaults.standard.string(forKey: "bitassetsRpcUrl") ?? "http://127.0.0.1:6004",
            "create": true,
        ]
        let configData = try JSONSerialization.data(withJSONObject: config)
        let configJson = String(data: configData, encoding: .utf8)!
        let opened = try configJson.withCString { try unwrap(floresta_bitassets_wallet_open($0)) }
        guard let parsed = UInt(opened) else {
            throw NSError(domain: "BitAssetsWallet", code: 2, userInfo: [NSLocalizedDescriptionKey: "invalid wallet handle"])
        }
        handle = parsed
        return parsed
    }

    private func callJson(
        _ paramsJson: String,
        _ resolve: RCTPromiseResolveBlock,
        _ reject: RCTPromiseRejectBlock,
        _ f: (UInt, UnsafePointer<CChar>) -> FlorestaBitAssetsFfiResult
    ) {
        call(resolve, reject) {
            let wallet = try self.openWallet()
            return paramsJson.withCString { f(wallet, $0) }
        }
    }

    private func call(
        _ resolve: RCTPromiseResolveBlock,
        _ reject: RCTPromiseRejectBlock,
        _ f: () throws -> FlorestaBitAssetsFfiResult
    ) {
        do {
            resolve(try unwrap(f()))
        } catch {
            reject("BITASSETS_WALLET_ERROR", error.localizedDescription, error)
        }
    }

    private func unwrap(_ result: FlorestaBitAssetsFfiResult) throws -> String {
        let value = result.value.map { String(cString: $0) } ?? ""
        floresta_bitassets_string_free(result.value)
        if result.ok { return value }
        throw NSError(domain: "BitAssetsWallet", code: 1, userInfo: [NSLocalizedDescriptionKey: value])
    }
}
