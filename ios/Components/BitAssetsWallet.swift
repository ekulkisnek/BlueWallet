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
            let requestedRpcUrl = ((config["rpcUrl"] ?? config["rpc_url"]) as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let rpcUrl = normalizeRpcUrlForCurrentRuntime(requestedRpcUrl)
            try validateRpcUrl(rpcUrl)
            let requestedQuicUrl = ((config["bitassetsLiteWalletQuicUrl"] ?? config["bitassets_lite_wallet_quic_url"] ?? config["quicUrl"]) as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let quicUrl = normalizeQuicUrlForCurrentRuntime(requestedQuicUrl, rpcUrl: rpcUrl)
            var configureFields: [String: Any] = ["rpcUrl": rpcUrl]
            if !quicUrl.isEmpty {
                try validateQuicUrl(quicUrl)
                configureFields["bitassetsLiteWalletQuicUrl"] = quicUrl
            }
            if requestedRpcUrl != rpcUrl {
                configureFields["requestedRpcUrl"] = requestedRpcUrl
            }
            eventLog("configure", "begin", configureFields)
            let groupDefaults = UserDefaults(suiteName: "group.com.layertwolabs.bluewallet") ?? UserDefaults.standard
            groupDefaults.set(rpcUrl, forKey: "bitassetsRpcUrl")
            if quicUrl.isEmpty {
                groupDefaults.removeObject(forKey: "bitassetsLiteWalletQuicUrl")
            } else {
                groupDefaults.set(quicUrl, forKey: "bitassetsLiteWalletQuicUrl")
            }
            groupDefaults.synchronize()
            if handle != 0 {
                floresta_bitassets_wallet_free(handle)
                handle = 0
            }
            let configuredQuicUrl: Any = quicUrl.isEmpty ? NSNull() : quicUrl
            let responseData = try JSONSerialization.data(withJSONObject: [
                "configured": true,
                "rpcUrl": rpcUrl,
                "bitassetsLiteWalletQuicUrl": configuredQuicUrl,
            ])
            eventLog("configure", "ok", configureFields)
            resolve(String(data: responseData, encoding: .utf8) ?? "{\"configured\":true}")
        } catch {
            let sanitized = sanitizedError(error)
            eventLog("configure", "error", ["error": sanitized.localizedDescription])
            reject("BITASSETS_WALLET_CONFIG_ERROR", sanitized.localizedDescription, sanitized)
        }
    }

    @objc func getNewAddress(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        call("getNewAddress", resolve, reject) { floresta_bitassets_wallet_get_new_address(try self.openWallet()) }
    }

    @objc func walletInfo(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        call("walletInfo", resolve, reject) { floresta_bitassets_wallet_info(try self.openWallet()) }
    }

    @objc func sync(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        call("sync", resolve, reject) {
            let wallet = try self.openWallet()
            let first = floresta_bitassets_wallet_sync(wallet)
            if first.ok {
                return first
            }
            let errorText = first.value.map { String(cString: $0) } ?? ""
            floresta_bitassets_string_free(first.value)
            guard self.isSnapshotResyncError(errorText) else {
                return FlorestaBitAssetsFfiResult(ok: false, value: strdup(self.sanitizeSensitiveDetails(errorText)))
            }
            self.eventLog("sync", "snapshotResync", ["error": errorText])
            try self.resetWalletSnapshotPreservingAddresses()
            if self.handle != 0 {
                floresta_bitassets_wallet_free(self.handle)
                self.handle = 0
            }
            return floresta_bitassets_wallet_sync(try self.openWallet())
        }
    }

    @objc func listUtxos(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        call("listUtxos", resolve, reject) { floresta_bitassets_wallet_list_utxos(try self.openWallet()) }
    }

    @objc func getBalance(_ assetId: String?, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        call("getBalance", resolve, reject) {
            let normalizedAssetId = assetId ?? ""
            if normalizedAssetId.isEmpty {
                return floresta_bitassets_wallet_get_balance(try self.openWallet(), nil)
            }
            let wallet = try self.openWallet()
            return normalizedAssetId.withCString { floresta_bitassets_wallet_get_balance(wallet, $0) }
        }
    }

    @objc func transfer(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        callJson("transfer", paramsJson, resolve, reject, floresta_bitassets_wallet_transfer)
    }

    @objc func reserve(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        callJson("reserve", paramsJson, resolve, reject, floresta_bitassets_wallet_reserve)
    }

    @objc func register(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        callJson("register", paramsJson, resolve, reject, floresta_bitassets_wallet_register)
    }

    @objc func ammMint(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        callJson("ammMint", paramsJson, resolve, reject, floresta_bitassets_wallet_amm_mint)
    }

    @objc func ammSwap(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        callJson("ammSwap", paramsJson, resolve, reject, floresta_bitassets_wallet_amm_swap)
    }

    @objc func ammBurn(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        callJson("ammBurn", paramsJson, resolve, reject, floresta_bitassets_wallet_amm_burn)
    }

    @objc func dutchAuctionCreate(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        callJson("dutchAuctionCreate", paramsJson, resolve, reject, floresta_bitassets_wallet_dutch_auction_create)
    }

    @objc func dutchAuctionBid(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        callJson("dutchAuctionBid", paramsJson, resolve, reject, floresta_bitassets_wallet_dutch_auction_bid)
    }

    @objc func dutchAuctionCollect(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        callJson("dutchAuctionCollect", paramsJson, resolve, reject, floresta_bitassets_wallet_dutch_auction_collect)
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
        groupDefaults.removeObject(forKey: "bitassetsLiteWalletQuicUrl")
        groupDefaults.synchronize()
        resolve("{\"cleared\":true}")
    }

    private func openWallet() throws -> UInt {
        if handle != 0 { return handle }
        let walletDirectory = try prepareWalletDirectory()
        // NOTE: removed directory file-protection set -- it could interfere with Rust FFI writes to wallet.json
        // under certain sandbox / data-protection / Catalyst conditions. wallet.json holds no seed (persist_seed=false),
        // so default protection is sufficient; seed lives only in Keychain.
        let walletFile = walletDirectory.appendingPathComponent("wallet.json")
        let groupDefaults = UserDefaults(suiteName: "group.com.layertwolabs.bluewallet") ?? UserDefaults.standard
        guard let rpcUrl = groupDefaults.string(forKey: "bitassetsRpcUrl"), !rpcUrl.isEmpty else {
            throw NSError(domain: "BitAssetsWallet", code: 3, userInfo: [NSLocalizedDescriptionKey: "BitAssets RPC URL is not configured"])
        }
        let quicUrl = groupDefaults.string(forKey: "bitassetsLiteWalletQuicUrl") ?? ""
        let seedHex = try getOrCreateSeedHex(walletFile: walletFile)
        var config: [String: Any] = [
            "path": walletFile.path,
            "rpc_url": rpcUrl,
            "seed_hex": seedHex,
            "create": true,
            "persist_seed": false,
        ]
        if !quicUrl.isEmpty {
            config["bitassets_lite_wallet_quic_url"] = quicUrl
        }
        let configData = try JSONSerialization.data(withJSONObject: config)
        let configJson = String(data: configData, encoding: .utf8)!
        eventLog("openWallet", "begin", ["rpcUrl": rpcUrl, "bitassetsLiteWalletQuicUrl": quicUrl.isEmpty ? NSNull() : quicUrl, "walletPath": walletFile.path])
        let opened = try configJson.withCString { try unwrap(floresta_bitassets_wallet_open($0)) }
        guard let parsed = UInt(opened) else {
            throw NSError(domain: "BitAssetsWallet", code: 2, userInfo: [NSLocalizedDescriptionKey: "invalid wallet handle"])
        }
        handle = parsed
        eventLog("openWallet", "ok", ["rpcUrl": rpcUrl, "bitassetsLiteWalletQuicUrl": quicUrl.isEmpty ? NSNull() : quicUrl, "walletPath": walletFile.path])
        return parsed
    }

    private func prepareWalletDirectory() throws -> URL {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        var walletDirectory = directory.appendingPathComponent("bitassets", isDirectory: true)
        try FileManager.default.createDirectory(at: walletDirectory, withIntermediateDirectories: true)
        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        try walletDirectory.setResourceValues(resourceValues)
        return walletDirectory
    }

    private func resetWalletSnapshotPreservingAddresses() throws {
        let walletDirectory = try prepareWalletDirectory()
        let walletFile = walletDirectory.appendingPathComponent("wallet.json")
        guard FileManager.default.fileExists(atPath: walletFile.path) else {
            return
        }
        let data = try Data(contentsOf: walletFile)
        guard var json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NSError(domain: "BitAssetsWallet", code: 11, userInfo: [NSLocalizedDescriptionKey: "Could not parse BitAssets wallet snapshot for resync"])
        }
        json["confirmed_utxos"] = []
        json["mempool_utxos"] = []
        json["spent_outpoints"] = []
        json["last_tip_hash"] = NSNull()
        json["last_tip_height"] = NSNull()
        let resetData = try JSONSerialization.data(withJSONObject: json, options: [.sortedKeys])
        try resetData.write(to: walletFile, options: .atomic)
        eventLog("sync", "snapshotReset", ["walletPath": walletFile.path])
    }

    private func isSnapshotResyncError(_ message: String) -> Bool {
        let normalized = message.lowercased()
        return normalized.contains("resync from snapshot")
            || normalized.contains("no longer on the active sidechain")
            || normalized.contains("from_block_hash")
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
            try scrubPersistedSeedHex(walletFile: walletFile)
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
            try scrubPersistedSeedHex(walletFile: walletFile)
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

    private func scrubPersistedSeedHex(walletFile: URL) throws {
        guard let data = try? Data(contentsOf: walletFile),
              var json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["seed_hex"] != nil else {
            return
        }
        json.removeValue(forKey: "seed_hex")
        let scrubbedData = try JSONSerialization.data(withJSONObject: json)
        try scrubbedData.write(to: walletFile, options: .atomic)
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
        guard let url = URL(string: rpcUrl), let scheme = url.scheme, ["http", "https"].contains(scheme), let host = url.host else {
            throw NSError(domain: "BitAssetsWallet", code: 6, userInfo: [NSLocalizedDescriptionKey: "BitAssets RPC URL must be an http(s) URL with a host"])
        }
        if scheme == "http" && !isLocalRpcHost(host) {
            throw NSError(domain: "BitAssetsWallet", code: 6, userInfo: [NSLocalizedDescriptionKey: "BitAssets RPC URL must use HTTPS unless it points to a local or private development host"])
        }
    }

    private func validateQuicUrl(_ quicUrl: String) throws {
        let pieces = quicUrl.split(separator: ":", omittingEmptySubsequences: false)
        guard pieces.count == 2, !pieces[0].isEmpty, UInt16(pieces[1]) != nil else {
            throw NSError(domain: "BitAssetsWallet", code: 12, userInfo: [NSLocalizedDescriptionKey: "BitAssets QUIC peer must be host:port"])
        }
    }

    private let signetPhoneHost = "192.168.1.50"

    private func normalizeRpcUrlForCurrentRuntime(_ rpcUrl: String) -> String {
        #if targetEnvironment(simulator)
        return rpcUrl
        #else
        guard var components = URLComponents(string: rpcUrl),
              let host = components.host?.lowercased(),
              host == "localhost" || host == "::1" || host.hasPrefix("127.") else {
            return rpcUrl
        }
        components.host = signetPhoneHost
        return components.url?.absoluteString ?? rpcUrl
        #endif
    }

    private func normalizeQuicUrlForCurrentRuntime(_ quicUrl: String, rpcUrl: String) -> String {
        #if targetEnvironment(simulator)
        return quicUrl
        #else
        let trimmed = quicUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            guard let rpcComponents = URLComponents(string: rpcUrl), let rpcHost = rpcComponents.host else {
                return ""
            }
            let port = rpcComponents.port ?? 6004
            let quicPort = port == 6004 ? 6104 : port
            return "\(rpcHost):\(quicPort)"
        }
        let host = trimmed.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        let lowered = host.lowercased()
        if lowered == "localhost" || lowered == "::1" || lowered.hasPrefix("127.") {
            let port = trimmed.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false).dropFirst().first.map(String.init) ?? "6104"
            return "\(signetPhoneHost):\(port)"
        }
        return trimmed
        #endif
    }

    private func isLocalRpcHost(_ host: String) -> Bool {
        let normalized = host.lowercased()
        if normalized == "localhost" || normalized == "::1" || normalized.hasPrefix("127.") {
            return true
        }
        if normalized.hasPrefix("10.") || normalized.hasPrefix("192.168.") {
            return true
        }
        let parts = normalized.split(separator: ".")
        if parts.count >= 2, parts[0] == "100", let secondOctet = Int(parts[1]), secondOctet >= 64 && secondOctet <= 127 {
            return true
        }
        guard parts.count >= 2, parts[0] == "172", let secondOctet = Int(parts[1]) else {
            return false
        }
        return secondOctet >= 16 && secondOctet <= 31
    }

    private func debugLog(_ message: String) {
        #if DEBUG
        NSLog("[BitAssetsWallet] %@", sanitizeSensitiveDetails(message))
        #endif
    }

    private func eventLog(_ operation: String, _ status: String, _ fields: [String: Any] = [:]) {
        var payload: [String: Any] = [
            "component": "ios.native.BitAssetsWallet",
            "operation": operation,
            "status": status,
            "time": ISO8601DateFormatter().string(from: Date()),
        ]
        for (key, value) in fields {
            if let text = value as? String {
                payload[key] = sanitizeSensitiveDetails(text)
            } else {
                payload[key] = value
            }
        }
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
           let line = String(data: data, encoding: .utf8) {
            NSLog("REDWALLET_EVENT %@", line)
        } else {
            NSLog("REDWALLET_EVENT {\"component\":\"ios.native.BitAssetsWallet\",\"operation\":\"%@\",\"status\":\"%@\"}", operation, status)
        }
    }

    private func sanitizeSensitiveDetails(_ message: String) -> String {
        var sanitized = message
        let keyedSeedPatterns = [
            #"(?i)(seed_hex["'\s:=]+)[0-9a-f]{128}"#,
            #"(?i)(seedHex["'\s:=]+)[0-9a-f]{128}"#,
        ]
        for pattern in keyedSeedPatterns {
            sanitized = sanitized.replacingOccurrences(
                of: pattern,
                with: "$1[redacted]",
                options: .regularExpression
            )
        }
        return sanitized.replacingOccurrences(
            of: #"\b[0-9a-fA-F]{128}\b"#,
            with: "[redacted-seed]",
            options: .regularExpression
        )
    }

    private func sanitizedError(_ error: Error) -> NSError {
        let message = sanitizeSensitiveDetails(error.localizedDescription)
        return NSError(domain: "BitAssetsWallet", code: (error as NSError).code, userInfo: [NSLocalizedDescriptionKey: message])
    }

    private func callJson(
        _ operation: String,
        _ paramsJson: String,
        _ resolve: @escaping RCTPromiseResolveBlock,
        _ reject: @escaping RCTPromiseRejectBlock,
        _ f: @escaping (UInt, UnsafePointer<CChar>) -> FlorestaBitAssetsFfiResult
    ) {
        call(operation, resolve, reject) {
            let wallet = try self.openWallet()
            return paramsJson.withCString { f(wallet, $0) }
        }
    }

    private func call(
        _ operation: String,
        _ resolve: @escaping RCTPromiseResolveBlock,
        _ reject: @escaping RCTPromiseRejectBlock,
        _ f: @escaping () throws -> FlorestaBitAssetsFfiResult
    ) {
        BitAssetsWalletModule.bitAssetsQueue.async {
            self.debugLog("\(operation) begin")
            self.eventLog(operation, "begin")
            do {
                self.walletLock.lock()
                defer { self.walletLock.unlock() }
                let value = try self.unwrap(f())
                self.debugLog("\(operation) ok")
                self.eventLog(operation, "ok", self.resultFields(value))
                resolve(value)
            } catch {
                let sanitized = self.sanitizedError(error)
                self.debugLog("\(operation) error: \(sanitized.localizedDescription)")
                self.eventLog(operation, "error", ["error": sanitized.localizedDescription])
                reject("BITASSETS_WALLET_ERROR", sanitized.localizedDescription, sanitized)
            }
        }
    }

    private func resultFields(_ value: String) -> [String: Any] {
        var fields: [String: Any] = ["resultBytes": value.utf8.count]
        if value.range(of: #"^[0-9a-fA-F]{64}$"#, options: .regularExpression) != nil {
            fields["txid"] = value
        }
        if let data = value.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let address = json["address"] as? String {
                fields["address"] = address
            }
            if let sidechainHeight = json["sidechain_height"] ?? json["sidechainBlockHeight"] {
                fields["sidechainHeight"] = sidechainHeight
            }
            if let balances = json["balances"] as? [String: Any] {
                fields["balanceAssetCount"] = balances.count
            }
        }
        return fields
    }

    private func unwrap(_ result: FlorestaBitAssetsFfiResult) throws -> String {
        let value = result.value.map { String(cString: $0) } ?? ""
        floresta_bitassets_string_free(result.value)
        if result.ok { return value }
        throw NSError(domain: "BitAssetsWallet", code: 1, userInfo: [NSLocalizedDescriptionKey: sanitizeSensitiveDetails(value)])
    }

    deinit {
        if handle != 0 {
            floresta_bitassets_wallet_free(handle)
        }
    }
}
