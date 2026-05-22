import Foundation
import Security

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
    private static let bitAssetsQueue = DispatchQueue(label: "com.layertwolabs.bluewallet.bitassets.wallet", qos: .userInitiated)
    private var handle: UInt = 0
    private let walletLock = NSLock()
    private let seedService = "com.layertwolabs.bluewallet.bitassets"
    private let seedAccount = "native-wallet-seed-v1"

    static func moduleName() -> String! { "BitAssetsWallet" }
    static func requiresMainQueueSetup() -> Bool { false }
    @objc static func methodQueue() -> DispatchQueue! { bitAssetsQueue }

    @objc func configure(_ configJson: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        do {
            walletLock.lock()
            defer { walletLock.unlock() }
            guard let data = configJson.data(using: .utf8),
                  let config = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw NSError(domain: "BitAssetsWallet", code: 4, userInfo: [NSLocalizedDescriptionKey: "Invalid BitAssets wallet config"])
            }
            let rpcUrl = ((config["rpcUrl"] ?? config["rpc_url"]) as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            try validateRpcUrl(rpcUrl)
            let groupDefaults = UserDefaults(suiteName: "group.com.layertwolabs.bluewallet") ?? UserDefaults.standard
            groupDefaults.set(rpcUrl, forKey: "bitassetsRpcUrl")
            groupDefaults.synchronize()
            if handle != 0 {
                floresta_bitassets_wallet_free(handle)
                handle = 0
            }
            let responseData = try JSONSerialization.data(withJSONObject: ["configured": true, "rpcUrl": rpcUrl])
            resolve(String(data: responseData, encoding: .utf8) ?? "{\"configured\":true}")
        } catch {
            reject("BITASSETS_WALLET_CONFIG_ERROR", error.localizedDescription, error)
        }
    }

    @objc func getNewAddress(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        call(resolve, reject) { floresta_bitassets_wallet_get_new_address(try self.openWallet()) }
    }

    @objc func walletInfo(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        call(resolve, reject) { floresta_bitassets_wallet_info(try self.openWallet()) }
    }

    @objc func sync(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        call(resolve, reject) { floresta_bitassets_wallet_sync(try self.openWallet()) }
    }

    @objc func listUtxos(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        call(resolve, reject) { floresta_bitassets_wallet_list_utxos(try self.openWallet()) }
    }

    @objc func getBalance(_ assetId: String?, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        call(resolve, reject) {
            let normalizedAssetId = assetId ?? ""
            if normalizedAssetId.isEmpty {
                return floresta_bitassets_wallet_get_balance(try self.openWallet(), nil)
            }
            let wallet = try self.openWallet()
            return normalizedAssetId.withCString { floresta_bitassets_wallet_get_balance(wallet, $0) }
        }
    }

    @objc func transfer(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        callJson(paramsJson, resolve, reject, floresta_bitassets_wallet_transfer)
    }

    @objc func reserve(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        callJson(paramsJson, resolve, reject, floresta_bitassets_wallet_reserve)
    }

    @objc func register(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        callJson(paramsJson, resolve, reject, floresta_bitassets_wallet_register)
    }

    @objc func ammMint(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        callJson(paramsJson, resolve, reject, floresta_bitassets_wallet_amm_mint)
    }

    @objc func ammSwap(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        callJson(paramsJson, resolve, reject, floresta_bitassets_wallet_amm_swap)
    }

    @objc func ammBurn(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        callJson(paramsJson, resolve, reject, floresta_bitassets_wallet_amm_burn)
    }

    @objc func dutchAuctionCreate(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        callJson(paramsJson, resolve, reject, floresta_bitassets_wallet_dutch_auction_create)
    }

    @objc func dutchAuctionBid(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        callJson(paramsJson, resolve, reject, floresta_bitassets_wallet_dutch_auction_bid)
    }

    @objc func dutchAuctionCollect(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        callJson(paramsJson, resolve, reject, floresta_bitassets_wallet_dutch_auction_collect)
    }

    @objc func clear(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        walletLock.lock()
        defer { walletLock.unlock() }
        if handle != 0 {
            floresta_bitassets_wallet_free(handle)
            handle = 0
        }
        // Purge persisted signer state (wallet.json + any sidecars) from app support sandbox.
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let walletDirectory = directory.appendingPathComponent("bitassets", isDirectory: true)
        if FileManager.default.fileExists(atPath: walletDirectory.path) {
            try? FileManager.default.removeItem(at: walletDirectory)
        }
        let keychainQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: seedService,
            kSecAttrAccount as String: seedAccount,
        ]
        SecItemDelete(keychainQuery as CFDictionary)
        let groupDefaults = UserDefaults(suiteName: "group.com.layertwolabs.bluewallet") ?? UserDefaults.standard
        groupDefaults.removeObject(forKey: "bitassetsRpcUrl")
        groupDefaults.synchronize()
        resolve("{\"cleared\":true}")
    }

    private func openWallet() throws -> UInt {
        if handle != 0 { return handle }
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let walletDirectory = directory.appendingPathComponent("bitassets", isDirectory: true)
        try FileManager.default.createDirectory(at: walletDirectory, withIntermediateDirectories: true)
        // NOTE: removed directory file-protection set -- it could interfere with Rust FFI writes to wallet.json
        // under certain sandbox / data-protection / Catalyst conditions. wallet.json holds no seed (persist_seed=false),
        // so default protection is sufficient; seed lives only in Keychain.
        let walletFile = walletDirectory.appendingPathComponent("wallet.json")
        let groupDefaults = UserDefaults(suiteName: "group.com.layertwolabs.bluewallet") ?? UserDefaults.standard
        guard let rpcUrl = groupDefaults.string(forKey: "bitassetsRpcUrl"), !rpcUrl.isEmpty else {
            throw NSError(domain: "BitAssetsWallet", code: 3, userInfo: [NSLocalizedDescriptionKey: "BitAssets RPC URL is not configured"])
        }
        let seedHex = try getOrCreateSeedHex(walletFile: walletFile)
        let config: [String: Any] = [
            "path": walletFile.path,
            "rpc_url": rpcUrl,
            "seed_hex": seedHex,
            "create": true,
            "persist_seed": false,
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

    private func getOrCreateSeedHex(walletFile: URL) throws -> String {
        #if targetEnvironment(simulator)
        let simulatorSeedFile = walletFile.deletingLastPathComponent().appendingPathComponent("seed.simulator")
        if let seed = try? String(contentsOf: simulatorSeedFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
           isSeedHex(seed) {
            return seed
        }
        if let migrated = readPersistedSeedHex(walletFile: walletFile) {
            try migrated.write(to: simulatorSeedFile, atomically: true, encoding: .utf8)
            return migrated
        }
        var simulatorSeed = [UInt8](repeating: 0, count: 64)
        let simulatorStatus = SecRandomCopyBytes(kSecRandomDefault, simulatorSeed.count, &simulatorSeed)
        guard simulatorStatus == errSecSuccess else {
            throw NSError(domain: "BitAssetsWallet", code: 7, userInfo: [NSLocalizedDescriptionKey: "Could not generate BitAssets wallet seed"])
        }
        let simulatorSeedHex = simulatorSeed.map { String(format: "%02x", Int($0)) }.joined()
        try simulatorSeedHex.write(to: simulatorSeedFile, atomically: true, encoding: .utf8)
        return simulatorSeedHex
        #else
        if let seed = try readKeychainSeedHex() {
            return seed
        }
        if let migrated = readPersistedSeedHex(walletFile: walletFile) {
            try writeKeychainSeedHex(migrated)
            return migrated
        }
        var seed = [UInt8](repeating: 0, count: 64)
        let status = SecRandomCopyBytes(kSecRandomDefault, seed.count, &seed)
        guard status == errSecSuccess else {
            throw NSError(domain: "BitAssetsWallet", code: 7, userInfo: [NSLocalizedDescriptionKey: "Could not generate BitAssets wallet seed"])
        }
        let seedHex = seed.map { String(format: "%02x", Int($0)) }.joined()
        try writeKeychainSeedHex(seedHex)
        return seedHex
        #endif
    }

    private func readPersistedSeedHex(walletFile: URL) -> String? {
        guard let data = try? Data(contentsOf: walletFile),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let seedHex = json["seed_hex"] as? String,
              isSeedHex(seedHex) else {
            return nil
        }
        return seedHex
    }

    private func readKeychainSeedHex() throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: seedService,
            kSecAttrAccount as String: seedAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            throw NSError(domain: "BitAssetsWallet", code: 8, userInfo: [NSLocalizedDescriptionKey: "Could not read BitAssets wallet seed from Keychain (status \(status))"])
        }
        guard let data = item as? Data,
              let seedHex = String(data: data, encoding: .utf8),
              isSeedHex(seedHex) else {
            SecItemDelete([
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: seedService,
                kSecAttrAccount as String: seedAccount,
            ] as CFDictionary)
            return nil
        }
        return seedHex
    }

    private func writeKeychainSeedHex(_ seedHex: String) throws {
        guard isSeedHex(seedHex), let data = seedHex.data(using: .utf8) else {
            throw NSError(domain: "BitAssetsWallet", code: 9, userInfo: [NSLocalizedDescriptionKey: "BitAssets wallet seed is invalid"])
        }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: seedService,
            kSecAttrAccount as String: seedAccount,
        ]
        SecItemDelete(query as CFDictionary)
        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw NSError(domain: "BitAssetsWallet", code: 10, userInfo: [NSLocalizedDescriptionKey: "Could not save BitAssets wallet seed to Keychain"])
        }
    }

    private func isSeedHex(_ seedHex: String) -> Bool {
        guard seedHex.count == 128 else { return false }
        return seedHex.unicodeScalars.allSatisfy { CharacterSet(charactersIn: "0123456789abcdefABCDEF").contains($0) }
    }

    private func validateRpcUrl(_ rpcUrl: String) throws {
        guard !rpcUrl.isEmpty else {
            throw NSError(domain: "BitAssetsWallet", code: 5, userInfo: [NSLocalizedDescriptionKey: "BitAssets RPC URL is required"])
        }
        guard let url = URL(string: rpcUrl), let scheme = url.scheme, ["http", "https"].contains(scheme), url.host != nil else {
            throw NSError(domain: "BitAssetsWallet", code: 6, userInfo: [NSLocalizedDescriptionKey: "BitAssets RPC URL must be an http(s) URL with a host"])
        }
    }

    private func callJson(
        _ paramsJson: String,
        _ resolve: @escaping RCTPromiseResolveBlock,
        _ reject: @escaping RCTPromiseRejectBlock,
        _ f: @escaping (UInt, UnsafePointer<CChar>) -> FlorestaBitAssetsFfiResult
    ) {
        call(resolve, reject) {
            let wallet = try self.openWallet()
            return paramsJson.withCString { f(wallet, $0) }
        }
    }

    private func call(
        _ resolve: @escaping RCTPromiseResolveBlock,
        _ reject: @escaping RCTPromiseRejectBlock,
        _ f: @escaping () throws -> FlorestaBitAssetsFfiResult
    ) {
        BitAssetsWalletModule.bitAssetsQueue.async {
            do {
                self.walletLock.lock()
                defer { self.walletLock.unlock() }
                let value = try self.unwrap(f())
                DispatchQueue.main.async {
                    resolve(value)
                }
            } catch {
                DispatchQueue.main.async {
                    reject("BITASSETS_WALLET_ERROR", error.localizedDescription, error)
                }
            }
        }
    }

    private func unwrap(_ result: FlorestaBitAssetsFfiResult) throws -> String {
        let value = result.value.map { String(cString: $0) } ?? ""
        floresta_bitassets_string_free(result.value)
        if result.ok { return value }
        throw NSError(domain: "BitAssetsWallet", code: 1, userInfo: [NSLocalizedDescriptionKey: value])
    }

    deinit {
        if handle != 0 {
            floresta_bitassets_wallet_free(handle)
        }
    }
}
