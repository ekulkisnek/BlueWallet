import Foundation
import Security

struct LiquidWalletFfiResult {
    let ok: Bool
    let value: UnsafeMutablePointer<CChar>?
}

// FFI declarations for all liquid_wallet_* functions from PR 1's include/liquid_wallet.h
// (see /Volumes/T705/code/drivechain-wallet-dev/liquid-simplicity/include/liquid_wallet.h)
// preparePegIn/preparePegOut are in NativeLiquidWalletSpec (PR 2) but not yet in PR 1 header; implemented as stubs below.
@_silgen_name("liquid_wallet_open")
func liquid_wallet_open(_ configJson: UnsafePointer<CChar>) -> LiquidWalletFfiResult
@_silgen_name("liquid_wallet_free")
func liquid_wallet_free(_ handle: UInt)
@_silgen_name("liquid_wallet_string_free")
func liquid_wallet_string_free(_ value: UnsafeMutablePointer<CChar>?)
@_silgen_name("liquid_wallet_get_new_address")
func liquid_wallet_get_new_address(_ handle: UInt) -> LiquidWalletFfiResult
@_silgen_name("liquid_wallet_info")
func liquid_wallet_info(_ handle: UInt) -> LiquidWalletFfiResult
@_silgen_name("liquid_wallet_sync")
func liquid_wallet_sync(_ handle: UInt) -> LiquidWalletFfiResult
@_silgen_name("liquid_wallet_list_utxos")
func liquid_wallet_list_utxos(_ handle: UInt) -> LiquidWalletFfiResult
@_silgen_name("liquid_wallet_get_balance")
func liquid_wallet_get_balance(_ handle: UInt, _ assetId: UnsafePointer<CChar>?) -> LiquidWalletFfiResult
@_silgen_name("liquid_wallet_transfer")
func liquid_wallet_transfer(_ handle: UInt, _ paramsJson: UnsafePointer<CChar>) -> LiquidWalletFfiResult

@objc(LiquidWalletModule)
class LiquidWalletModule: NSObject, NativeLiquidWalletSpec {
    private static let liquidQueue = DispatchQueue(label: "com.layertwolabs.bluewallet.liquid.wallet", qos: .userInitiated)
    private var handle: UInt = 0
    private let walletLock = NSLock()
    private let seedService = "com.layertwolabs.bluewallet.liquid"
    private let seedAccount = "native-wallet-seed-v1"

    static func moduleName() -> String! { "LiquidWallet" }
    static func requiresMainQueueSetup() -> Bool { false }
    @objc static func methodQueue() -> DispatchQueue! { liquidQueue }

    @objc func configure(_ configJson: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        do {
            walletLock.lock()
            defer { walletLock.unlock() }
            guard let data = configJson.data(using: .utf8),
                  let config = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw NSError(domain: "LiquidWallet", code: 4, userInfo: [NSLocalizedDescriptionKey: "Invalid Liquid wallet config"])
            }
            let requestedRpcUrl = ((config["rpcUrl"] ?? config["rpc_url"]) as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let rpcUrl = normalizeRpcUrlForCurrentRuntime(requestedRpcUrl)
            try validateRpcUrl(rpcUrl)
            eventLog("configure", "begin", ["rpcUrl": rpcUrl])
            let groupDefaults = UserDefaults(suiteName: "group.com.layertwolabs.bluewallet") ?? UserDefaults.standard
            groupDefaults.set(rpcUrl, forKey: "liquidRpcUrl")
            groupDefaults.synchronize()
            if handle != 0 {
                liquid_wallet_free(handle)
                handle = 0
            }
            let responseData = try JSONSerialization.data(withJSONObject: [
                "configured": true,
                "rpcUrl": rpcUrl,
            ])
            eventLog("configure", "ok", ["rpcUrl": rpcUrl])
            resolve(String(data: responseData, encoding: .utf8) ?? "{\"configured\":true}")
        } catch {
            let sanitized = sanitizedError(error)
            eventLog("configure", "error", ["error": sanitized.localizedDescription])
            reject("LIQUID_WALLET_CONFIG_ERROR", sanitized.localizedDescription, sanitized)
        }
    }

    @objc func getNewAddress(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        call("getNewAddress", resolve, reject) { liquid_wallet_get_new_address(try self.openWallet()) }
    }

    @objc func walletInfo(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        call("walletInfo", resolve, reject) { liquid_wallet_info(try self.openWallet()) }
    }

    @objc func sync(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        call("sync", resolve, reject) {
            let wallet = try self.openWallet()
            let first = liquid_wallet_sync(wallet)
            if first.ok {
                return first
            }
            let errorText = first.value.map { String(cString: $0) } ?? ""
            liquid_wallet_string_free(first.value)
            guard self.isSnapshotResyncError(errorText) else {
                return LiquidWalletFfiResult(ok: false, value: strdup(self.sanitizeSensitiveDetails(errorText)))
            }
            self.eventLog("sync", "snapshotResync", ["error": errorText])
            try self.resetWalletSnapshotPreservingAddresses()
            if self.handle != 0 {
                liquid_wallet_free(self.handle)
                self.handle = 0
            }
            return liquid_wallet_sync(try self.openWallet())
        }
    }

    @objc func listUtxos(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        call("listUtxos", resolve, reject) { liquid_wallet_list_utxos(try self.openWallet()) }
    }

    @objc func getBalance(_ assetId: String?, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        call("getBalance", resolve, reject) {
            let normalizedAssetId = assetId ?? ""
            if normalizedAssetId.isEmpty {
                return liquid_wallet_get_balance(try self.openWallet(), nil)
            }
            let wallet = try self.openWallet()
            return normalizedAssetId.withCString { liquid_wallet_get_balance(wallet, $0) }
        }
    }

    @objc func transfer(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        callJson("transfer", paramsJson, resolve, reject, liquid_wallet_transfer)
    }

    // prepare* are declared in PR 2 NativeLiquidWalletSpec + codegen/NativeLiquidWallet.ts but FFI not present in PR 1 liquid_wallet.h yet.
    // Stubs per "with stub if needed" for xcodebuild verification (real impl + FFI in PR 8).
    @objc func preparePegIn(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let err = NSError(domain: "LiquidWallet", code: 99, userInfo: [NSLocalizedDescriptionKey: "preparePegIn not implemented in liquid_wallet FFI (PR 1 header; see PR 8)"])
        reject("LIQUID_WALLET_ERROR", "preparePegIn not implemented", err)
    }

    @objc func preparePegOut(_ paramsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let err = NSError(domain: "LiquidWallet", code: 99, userInfo: [NSLocalizedDescriptionKey: "preparePegOut not implemented in liquid_wallet FFI (PR 1 header; see PR 8)"])
        reject("LIQUID_WALLET_ERROR", "preparePegOut not implemented", err)
    }

    @objc func clear(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        walletLock.lock()
        defer { walletLock.unlock() }
        if handle != 0 {
            liquid_wallet_free(handle)
            handle = 0
        }
        // Purge persisted signer state (wallet.json + seed.simulator sidecar) from app support sandbox.
        // Mirrors BitAssetsWallet.swift:193 and Android LiquidWalletModule.kt:125 (noBackupFilesDir/liquid + scrub).
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let walletDirectory = directory.appendingPathComponent("liquid", isDirectory: true)
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
        groupDefaults.removeObject(forKey: "liquidRpcUrl")
        groupDefaults.synchronize()
        resolve("{\"cleared\":true}")
    }

    private func openWallet() throws -> UInt {
        if handle != 0 { return handle }
        let walletDirectory = try prepareWalletDirectory()
        // NOTE: removed directory file-protection set -- it could interfere with Rust FFI writes to wallet.json
        // under certain sandbox / data-protection / Catalyst conditions (exact comment from BitAssetsWallet.swift:215).
        // wallet.json holds no seed (persist_seed=false), so default protection is sufficient; seed lives only in Keychain.
        let walletFile = walletDirectory.appendingPathComponent("wallet.json")
        let groupDefaults = UserDefaults(suiteName: "group.com.layertwolabs.bluewallet") ?? UserDefaults.standard
        guard let rpcUrl = groupDefaults.string(forKey: "liquidRpcUrl"), !rpcUrl.isEmpty else {
            throw NSError(domain: "LiquidWallet", code: 3, userInfo: [NSLocalizedDescriptionKey: "Liquid RPC URL is not configured"])
        }
        let seedHex = try getOrCreateSeedHex(walletFile: walletFile)
        // Exact "persist_seed": false JSON per design (PR 3 req + BitAssets iOS:230 / Android Liquid:158)
        let config: [String: Any] = [
            "path": walletFile.path,
            "rpc_url": rpcUrl,
            "seed_hex": seedHex,
            "create": true,
            "persist_seed": false,
        ]
        let configData = try JSONSerialization.data(withJSONObject: config)
        let configJson = String(data: configData, encoding: .utf8)!
        eventLog("openWallet", "begin", ["rpcUrl": rpcUrl, "walletPath": walletFile.path])
        let opened = try configJson.withCString { try unwrap(liquid_wallet_open($0)) }
        guard let parsed = UInt(opened) else {
            throw NSError(domain: "LiquidWallet", code: 2, userInfo: [NSLocalizedDescriptionKey: "invalid wallet handle"])
        }
        handle = parsed
        eventLog("openWallet", "ok", ["rpcUrl": rpcUrl, "walletPath": walletFile.path])
        return parsed
    }

    private func prepareWalletDirectory() throws -> URL {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        var walletDirectory = directory.appendingPathComponent("liquid", isDirectory: true)
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
            throw NSError(domain: "LiquidWallet", code: 11, userInfo: [NSLocalizedDescriptionKey: "Could not parse Liquid wallet snapshot for resync"])
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
        // Simulator sidecar seed.simulator (exact requirement + BitAssetsWallet.swift:286)
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
            throw NSError(domain: "LiquidWallet", code: 7, userInfo: [NSLocalizedDescriptionKey: "Could not generate Liquid wallet seed"])
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
            throw NSError(domain: "LiquidWallet", code: 7, userInfo: [NSLocalizedDescriptionKey: "Could not generate Liquid wallet seed"])
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
            throw NSError(domain: "LiquidWallet", code: 8, userInfo: [NSLocalizedDescriptionKey: "Could not read Liquid wallet seed from Keychain (status \(status))"])
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
            throw NSError(domain: "LiquidWallet", code: 9, userInfo: [NSLocalizedDescriptionKey: "Liquid wallet seed is invalid"])
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
            throw NSError(domain: "LiquidWallet", code: 10, userInfo: [NSLocalizedDescriptionKey: "Could not save Liquid wallet seed to Keychain"])
        }
    }

    private func isSeedHex(_ seedHex: String) -> Bool {
        guard seedHex.count == 128 else { return false }
        return seedHex.unicodeScalars.allSatisfy { CharacterSet(charactersIn: "0123456789abcdefABCDEF").contains($0) }
    }

    private func validateRpcUrl(_ rpcUrl: String) throws {
        guard !rpcUrl.isEmpty else {
            throw NSError(domain: "LiquidWallet", code: 5, userInfo: [NSLocalizedDescriptionKey: "Liquid RPC URL is required"])
        }
        guard let url = URL(string: rpcUrl), let scheme = url.scheme, ["http", "https"].contains(scheme), let host = url.host else {
            throw NSError(domain: "LiquidWallet", code: 6, userInfo: [NSLocalizedDescriptionKey: "Liquid RPC URL must be an http(s) URL with a host"])
        }
        if scheme == "http" && !isLocalRpcHost(host) {
            throw NSError(domain: "LiquidWallet", code: 6, userInfo: [NSLocalizedDescriptionKey: "Liquid RPC URL must use HTTPS unless it points to a local or private development host"])
        }
    }

    // Endpoint normalization using redwalletRealDevice* helpers pattern (see helpers/redwalletRealDeviceEndpoints.ts + redwalletRealDeviceProof.ts).
    // Mirrors BitAssetsWallet.swift normalize*ForRuntime + isLocal (inline iOS native equivalent of TS isRedWalletIosPhysicalDevice / canonical*).
    // Physical device release bundles must never use localhost for Liquid elementsd RPC (same security as BitAssets).
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
        NSLog("[LiquidWallet] %@", sanitizeSensitiveDetails(message))
        #endif
    }

    private func eventLog(_ operation: String, _ status: String, _ fields: [String: Any] = [:]) {
        var payload: [String: Any] = [
            "component": "ios.native.LiquidWallet",
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
            NSLog("REDWALLET_EVENT {\"component\":\"ios.native.LiquidWallet\",\"operation\":\"%@\",\"status\":\"%@\"}", operation, status)
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
        sanitized = sanitized.replacingOccurrences(
            of: #"\b[0-9a-fA-F]{128}\b"#,
            with: "[redacted-seed]",
            options: .regularExpression
        )
        // Redact credentials in RPC URLs (user:pass@host) for security
        sanitized = sanitized.replacingOccurrences(
            of: #"(?i)(https?://)[^/\s@]+@([^\s/]+)"#,
            with: "$1***@$2",
            options: .regularExpression
        )
        return sanitized
    }

    private func sanitizedError(_ error: Error) -> NSError {
        let message = sanitizeSensitiveDetails(error.localizedDescription)
        return NSError(domain: "LiquidWallet", code: (error as NSError).code, userInfo: [NSLocalizedDescriptionKey: message])
    }

    private func callJson(
        _ operation: String,
        _ paramsJson: String,
        _ resolve: @escaping RCTPromiseResolveBlock,
        _ reject: @escaping RCTPromiseRejectBlock,
        _ f: @escaping (UInt, UnsafePointer<CChar>) -> LiquidWalletFfiResult
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
        _ f: @escaping () throws -> LiquidWalletFfiResult
    ) {
        LiquidWalletModule.liquidQueue.async {
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
                reject("LIQUID_WALLET_ERROR", sanitized.localizedDescription, sanitized)
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

    private func unwrap(_ result: LiquidWalletFfiResult) throws -> String {
        let value = result.value.map { String(cString: $0) } ?? ""
        liquid_wallet_string_free(result.value)
        if result.ok { return value }
        throw NSError(domain: "LiquidWallet", code: 1, userInfo: [NSLocalizedDescriptionKey: sanitizeSensitiveDetails(value)])
    }

    deinit {
        if handle != 0 {
            liquid_wallet_free(handle)
        }
    }
}
