package io.bluewallet.bluewallet

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URI
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log

@ReactModule(name = LiquidWalletModule.NAME)
class LiquidWalletModule(private val reactContext: ReactApplicationContext) : NativeLiquidWalletSpec(reactContext) {
    companion object {
        const val NAME = "LiquidWallet"
        private const val KEY_ALIAS = "bluewallet_liquid_seed_v1"
        private const val KEYSTORE = "AndroidKeyStore"
        private const val SEED_PREF = "liquidSeedCiphertext"
        private const val GCM_TAG_BITS = 128

        init {
            try {
                System.loadLibrary("liquid_wallet")
            } catch (_: UnsatisfiedLinkError) {
            }
        }
    }

    private var walletHandle: Long = 0
    private val walletLock = Any()

    @ReactMethod
    override fun configure(configJson: String, promise: Promise) {
        try {
            synchronized(walletLock) {
                val config = JSONObject(configJson)
                val rpcUrl = config.optString("rpcUrl", config.optString("rpc_url", "")).trim()
                validateRpcUrl(rpcUrl)
                eventLog("configure", "begin", mapOf("rpcUrl" to rpcUrl))
                val sharedPref = reactContext.getSharedPreferences("group.com.layertwolabs.bluewallet", android.content.Context.MODE_PRIVATE)
                sharedPref.edit()
                    .putString("liquidRpcUrl", rpcUrl)
                    .apply()
                if (walletHandle != 0L) {
                    nativeFree(walletHandle)
                    walletHandle = 0
                }
                eventLog("configure", "ok", mapOf("rpcUrl" to rpcUrl))
                promise.resolve(JSONObject().put("configured", true).put("rpcUrl", rpcUrl).toString())
            }
        } catch (error: Throwable) {
            eventLog("configure", "error", mapOf("error" to (error.message ?: error.toString())))
            rejectSanitized(promise, "LIQUID_WALLET_CONFIG_ERROR", error)
        }
    }

    @ReactMethod
    override fun getNewAddress(promise: Promise) = resolve("getNewAddress", promise) { nativeGetNewAddress(openWallet()) }

    @ReactMethod
    override fun walletInfo(promise: Promise) = resolve("walletInfo", promise) { nativeWalletInfo(openWallet()) }

    @ReactMethod
    override fun sync(promise: Promise) {
        try {
            eventLog("sync", "begin")
            val value = synchronized(walletLock) {
                val first = runCatching { unwrap(nativeSync(openWallet())) }
                if (first.isSuccess) {
                    return@synchronized first.getOrThrow()
                }
                val errorText = first.exceptionOrNull()?.message ?: "Liquid wallet sync failed"
                if (!isSnapshotResyncError(errorText)) {
                    throw first.exceptionOrNull() ?: IllegalStateException(errorText)
                }
                eventLog("sync", "snapshotResync", mapOf("error" to errorText))
                resetWalletSnapshotPreservingAddresses()
                if (walletHandle != 0L) {
                    nativeFree(walletHandle)
                    walletHandle = 0L
                }
                unwrap(nativeSync(openWallet()))
            }
            eventLog("sync", "ok", resultFields(value))
            promise.resolve(value)
        } catch (error: Throwable) {
            eventLog("sync", "error", mapOf("error" to (error.message ?: error.toString())))
            rejectSanitized(promise, "LIQUID_WALLET_ERROR", error)
        }
    }

    @ReactMethod
    override fun listUtxos(promise: Promise) = resolve("listUtxos", promise) { nativeListUtxos(openWallet()) }

    @ReactMethod
    override fun getBalance(assetId: String?, promise: Promise) = resolve("getBalance", promise) { nativeGetBalance(openWallet(), assetId ?: "") }

    @ReactMethod
    override fun transfer(paramsJson: String, promise: Promise) = resolve("transfer", promise) { nativeTransfer(openWallet(), paramsJson) }

    @ReactMethod
    override fun preparePegIn(paramsJson: String, promise: Promise) = resolve("preparePegIn", promise) { nativePreparePegIn(openWallet(), paramsJson) }

    @ReactMethod
    override fun preparePegOut(paramsJson: String, promise: Promise) = resolve("preparePegOut", promise) { nativePreparePegOut(openWallet(), paramsJson) }

    @ReactMethod
    override fun clear(promise: Promise) {
        try {
            synchronized(walletLock) {
                if (walletHandle != 0L) {
                    nativeFree(walletHandle)
                    walletHandle = 0L
                }
                val walletDir = File(reactContext.noBackupFilesDir, "liquid")
                if (walletDir.exists()) {
                    walletDir.deleteRecursively()
                }
                val sharedPref = reactContext.getSharedPreferences("group.com.layertwolabs.bluewallet", android.content.Context.MODE_PRIVATE)
                sharedPref.edit()
                    .remove(SEED_PREF)
                    .remove("liquidRpcUrl")
                    .apply()
                deleteSecretKey()
            }
            promise.resolve(JSONObject().put("cleared", true).toString())
        } catch (error: Throwable) {
            // still succeed so caller delete flow isn't blocked by purge errors
            promise.resolve(JSONObject().put("cleared", true).put("warning", "partial").toString())
        }
    }

    private fun openWallet(): Long {
        if (walletHandle != 0L) return walletHandle

        val walletDir = File(reactContext.noBackupFilesDir, "liquid")
        walletDir.mkdirs()
        val walletFile = File(walletDir, "wallet.json")
        val sharedPref = reactContext.getSharedPreferences("group.com.layertwolabs.bluewallet", android.content.Context.MODE_PRIVATE)
        val rpcUrl = sharedPref.getString("liquidRpcUrl", null)
            ?: throw IllegalStateException("Liquid RPC URL is not configured")
        val seedHex = getOrCreateSeedHex(walletFile, sharedPref)
        val config = JSONObject()
            .put("path", walletFile.absolutePath)
            .put("rpc_url", rpcUrl)
            .put("seed_hex", seedHex)
            .put("create", true)
            .put("persist_seed", false)
        val configJson = config.toString()

        eventLog("openWallet", "begin", mapOf("rpcUrl" to rpcUrl, "walletPath" to walletFile.absolutePath))
        val result = unwrap(nativeOpen(configJson))
        walletHandle = java.lang.Long.parseUnsignedLong(result)
        eventLog("openWallet", "ok", mapOf("rpcUrl" to rpcUrl, "walletPath" to walletFile.absolutePath))
        return walletHandle
    }

    private fun getOrCreateSeedHex(walletFile: File, sharedPref: android.content.SharedPreferences): String {
        sharedPref.getString(SEED_PREF, null)?.let { return decryptSeedHex(it) }
        readPersistedSeedHex(walletFile)?.let { seedHex ->
            persistSeedHex(sharedPref, seedHex)
            scrubPersistedSeedHex(walletFile)
            return seedHex
        }
        val seed = ByteArray(64)
        SecureRandom().nextBytes(seed)
        val seedHex = seed.joinToString("") { "%02x".format(it.toInt() and 0xff) }
        persistSeedHex(sharedPref, seedHex)
        return seedHex
    }

    private fun readPersistedSeedHex(walletFile: File): String? {
        if (!walletFile.exists()) return null
        return try {
            JSONObject(walletFile.readText()).optString("seed_hex").takeIf { isSeedHex(it) }
        } catch (_: Throwable) {
            null
        }
    }

    private fun persistSeedHex(sharedPref: android.content.SharedPreferences, seedHex: String) {
        if (!sharedPref.edit().putString(SEED_PREF, encryptSeedHex(seedHex)).commit()) {
            throw IllegalStateException("Could not persist Liquid seed")
        }
    }

    private fun scrubPersistedSeedHex(walletFile: File) {
        val json = JSONObject(walletFile.readText())
        if (!json.has("seed_hex")) return
        json.remove("seed_hex")

        val tmpFile = File(walletFile.parentFile, "${walletFile.name}.scrubbed")
        tmpFile.writeText(json.toString(), Charsets.UTF_8)
        if (!tmpFile.renameTo(walletFile)) {
            if (!walletFile.delete() || !tmpFile.renameTo(walletFile)) {
                tmpFile.delete()
                throw IllegalStateException("Could not remove legacy Liquid seed from wallet file")
            }
        }
    }

    private fun encryptSeedHex(seedHex: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey())
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(seedHex.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(iv + ciphertext, Base64.NO_WRAP)
    }

    private fun decryptSeedHex(encoded: String): String {
        val payload = Base64.decode(encoded, Base64.NO_WRAP)
        require(payload.size > 12) { "Liquid seed payload is invalid" }
        val iv = payload.copyOfRange(0, 12)
        val ciphertext = payload.copyOfRange(12, payload.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateSecretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        val seedHex = String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        require(isSeedHex(seedHex)) { "Liquid seed has invalid format" }
        return seedHex
    }

    private fun isSeedHex(seedHex: String): Boolean {
        return seedHex.length == 128 && seedHex.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }
    }

    private fun getOrCreateSecretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        val spec = KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build()
        generator.init(spec)
        return generator.generateKey()
    }

    private fun deleteSecretKey() {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        if (keyStore.containsAlias(KEY_ALIAS)) {
            keyStore.deleteEntry(KEY_ALIAS)
        }
    }

    private fun validateRpcUrl(rpcUrl: String) {
        if (rpcUrl.isBlank()) {
            throw IllegalArgumentException("Liquid RPC URL is required")
        }
        val uri = URI(rpcUrl)
        if (uri.scheme != "http" && uri.scheme != "https") {
            throw IllegalArgumentException("Liquid RPC URL must use http or https")
        }
        if (uri.host.isNullOrBlank()) {
            throw IllegalArgumentException("Liquid RPC URL must include a host")
        }
        if (uri.scheme == "http" && !isLocalRpcHost(uri.host.lowercase())) {
            throw IllegalArgumentException("Liquid RPC URL must use HTTPS unless it points to a local or private development host")
        }
    }

    private fun validateQuicUrl(quicUrl: String) {
        val parts = quicUrl.split(":")
        if (parts.size != 2 || parts[0].isBlank() || parts[1].toIntOrNull()?.let { it in 1..65535 } != true) {
            throw IllegalArgumentException("Liquid QUIC peer must be host:port")
        }
    }

    private fun isLocalRpcHost(host: String): Boolean {
        if (host == "localhost" || host == "::1" || host.startsWith("127.")) return true
        if (host.startsWith("10.") || host.startsWith("192.168.")) return true
        val parts = host.split(".")
        if (parts.size >= 2 && parts[0] == "100") {
            val secondOctet = parts[1].toIntOrNull() ?: return false
            if (secondOctet in 64..127) return true
        }
        if (parts.size < 2 || parts[0] != "172") return false
        val secondOctet = parts[1].toIntOrNull() ?: return false
        return secondOctet in 16..31
    }

    private fun resetWalletSnapshotPreservingAddresses() {
        val walletFile = File(File(reactContext.noBackupFilesDir, "liquid"), "wallet.json")
        if (!walletFile.exists()) return
        val json = JSONObject(walletFile.readText())
        json.put("confirmed_utxos", JSONArray())
        json.put("mempool_utxos", JSONArray())
        json.put("spent_outpoints", JSONArray())
        json.put("last_tip_hash", JSONObject.NULL)
        json.put("last_tip_height", JSONObject.NULL)
        walletFile.writeText(json.toString(), Charsets.UTF_8)
        eventLog("sync", "snapshotReset", mapOf("walletPath" to walletFile.absolutePath))
    }

    private fun isSnapshotResyncError(message: String): Boolean {
        val normalized = message.lowercase()
        return normalized.contains("resync from snapshot")
            || normalized.contains("no longer on the active sidechain")
            || normalized.contains("from_block_hash")
    }

    private fun resolve(operation: String, promise: Promise, call: () -> String) {
        try {
            eventLog(operation, "begin")
            val value = synchronized(walletLock) { unwrap(call()) }
            eventLog(operation, "ok", resultFields(value))
            promise.resolve(value)
        } catch (error: Throwable) {
            eventLog(operation, "error", mapOf("error" to (error.message ?: error.toString())))
            rejectSanitized(promise, "LIQUID_WALLET_ERROR", error)
        }
    }

    private fun rejectSanitized(promise: Promise, code: String, error: Throwable) {
        val message = sanitizeSensitiveDetails(error.message ?: error.toString())
        promise.reject(code, message, IllegalStateException(message))
    }

    private fun sanitizeSensitiveDetails(message: String): String {
        return message
            .replace(Regex("""(?i)(seed_hex["'\s:=]+)[0-9a-f]{128}"""), "\$1[redacted]")
            .replace(Regex("""(?i)(seedHex["'\s:=]+)[0-9a-f]{128}"""), "\$1[redacted]")
            .replace(Regex("""\b[0-9a-fA-F]{128}\b"""), "[redacted-seed]")
            .replace(Regex("""(?i)(https?://)[^/\s@]+@([^\s/]+)"""), "\$1***@\$2")
    }

    private fun eventLog(operation: String, status: String, fields: Map<String, Any?> = emptyMap()) {
        val payload = JSONObject()
            .put("component", "android.native.LiquidWallet")
            .put("operation", operation)
            .put("status", status)
            .put("timeUnixMs", System.currentTimeMillis())
        fields.forEach { (key, value) ->
            payload.put(key, if (value is String) sanitizeSensitiveDetails(value) else value)
        }
        Log.i("REDWALLET_EVENT", payload.toString())
    }

    private fun resultFields(value: String): Map<String, Any> {
        val fields = mutableMapOf<String, Any>("resultBytes" to value.toByteArray(Charsets.UTF_8).size)
        if (Regex("""^[0-9a-fA-F]{64}$""").matches(value)) {
            fields["txid"] = value
        }
        runCatching {
            val json = JSONObject(value)
            if (json.has("address")) fields["address"] = json.getString("address")
            if (json.has("sidechain_height")) fields["sidechainHeight"] = json.get("sidechain_height")
            if (json.has("sidechainBlockHeight")) fields["sidechainHeight"] = json.get("sidechainBlockHeight")
            if (json.has("balances")) fields["balanceAssetCount"] = json.getJSONObject("balances").length()
        }
        return fields
    }

    private fun unwrap(resultJson: String): String {
        val envelope = JSONObject(resultJson)
        val value = envelope.optString("value")
        if (!envelope.optBoolean("ok")) {
            throw IllegalStateException(sanitizeSensitiveDetails(value.ifBlank { "Liquid wallet call failed" }))
        }
        return value
    }

    private external fun nativeOpen(configJson: String): String
    private external fun nativeFree(handle: Long)
    private external fun nativeGetNewAddress(handle: Long): String
    private external fun nativeWalletInfo(handle: Long): String
    private external fun nativeSync(handle: Long): String
    private external fun nativeListUtxos(handle: Long): String
    private external fun nativeGetBalance(handle: Long, assetId: String): String
    private external fun nativeTransfer(handle: Long, paramsJson: String): String
    private external fun nativePreparePegIn(handle: Long, paramsJson: String): String
    private external fun nativePreparePegOut(handle: Long, paramsJson: String): String
}
