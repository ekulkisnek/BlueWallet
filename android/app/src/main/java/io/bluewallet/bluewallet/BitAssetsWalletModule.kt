package io.bluewallet.bluewallet

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
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

@ReactModule(name = BitAssetsWalletModule.NAME)
class BitAssetsWalletModule(private val reactContext: ReactApplicationContext) : NativeBitAssetsWalletSpec(reactContext) {
    companion object {
        const val NAME = "BitAssetsWallet"
        private const val KEY_ALIAS = "bluewallet_bitassets_seed_v1"
        private const val KEYSTORE = "AndroidKeyStore"
        private const val SEED_PREF = "bitassetsSeedCiphertext"
        private const val GCM_TAG_BITS = 128

        init {
            try {
                System.loadLibrary("floresta_bitassets_wallet")
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
                val sharedPref = reactContext.getSharedPreferences("group.com.layertwolabs.bluewallet", android.content.Context.MODE_PRIVATE)
                sharedPref.edit().putString("bitassetsRpcUrl", rpcUrl).apply()
                if (walletHandle != 0L) {
                    nativeFree(walletHandle)
                    walletHandle = 0
                }
                promise.resolve(JSONObject().put("configured", true).put("rpcUrl", rpcUrl).toString())
            }
        } catch (error: Throwable) {
            promise.reject("BITASSETS_WALLET_CONFIG_ERROR", error.message, error)
        }
    }

    @ReactMethod
    override fun getNewAddress(promise: Promise) = resolve(promise) { nativeGetNewAddress(openWallet()) }

    @ReactMethod
    override fun walletInfo(promise: Promise) = resolve(promise) { nativeWalletInfo(openWallet()) }

    @ReactMethod
    override fun sync(promise: Promise) = resolve(promise) { nativeSync(openWallet()) }

    @ReactMethod
    override fun listUtxos(promise: Promise) = resolve(promise) { nativeListUtxos(openWallet()) }

    @ReactMethod
    override fun getBalance(assetId: String?, promise: Promise) = resolve(promise) { nativeGetBalance(openWallet(), assetId ?: "") }

    @ReactMethod
    override fun transfer(paramsJson: String, promise: Promise) = resolve(promise) { nativeTransfer(openWallet(), paramsJson) }

    @ReactMethod
    override fun reserve(paramsJson: String, promise: Promise) = resolve(promise) { nativeReserve(openWallet(), paramsJson) }

    @ReactMethod
    override fun register(paramsJson: String, promise: Promise) = resolve(promise) { nativeRegister(openWallet(), paramsJson) }

    @ReactMethod
    override fun ammMint(paramsJson: String, promise: Promise) = resolve(promise) { nativeAmmMint(openWallet(), paramsJson) }

    @ReactMethod
    override fun ammSwap(paramsJson: String, promise: Promise) = resolve(promise) { nativeAmmSwap(openWallet(), paramsJson) }

    @ReactMethod
    override fun ammBurn(paramsJson: String, promise: Promise) = resolve(promise) { nativeAmmBurn(openWallet(), paramsJson) }

    @ReactMethod
    override fun dutchAuctionCreate(paramsJson: String, promise: Promise) = resolve(promise) { nativeDutchAuctionCreate(openWallet(), paramsJson) }

    @ReactMethod
    override fun dutchAuctionBid(paramsJson: String, promise: Promise) = resolve(promise) { nativeDutchAuctionBid(openWallet(), paramsJson) }

    @ReactMethod
    override fun dutchAuctionCollect(paramsJson: String, promise: Promise) = resolve(promise) { nativeDutchAuctionCollect(openWallet(), paramsJson) }

    @ReactMethod
    override fun clear(promise: Promise) {
        try {
            synchronized(walletLock) {
                if (walletHandle != 0L) {
                    nativeFree(walletHandle)
                    walletHandle = 0L
                }
                val walletDir = File(reactContext.noBackupFilesDir, "bitassets")
                if (walletDir.exists()) {
                    walletDir.deleteRecursively()
                }
                val sharedPref = reactContext.getSharedPreferences("group.com.layertwolabs.bluewallet", android.content.Context.MODE_PRIVATE)
                sharedPref.edit()
                    .remove(SEED_PREF)
                    .remove("bitassetsRpcUrl")
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

        val walletDir = File(reactContext.noBackupFilesDir, "bitassets")
        walletDir.mkdirs()
        val walletFile = File(walletDir, "wallet.json")
        val sharedPref = reactContext.getSharedPreferences("group.com.layertwolabs.bluewallet", android.content.Context.MODE_PRIVATE)
        val rpcUrl = sharedPref.getString("bitassetsRpcUrl", null)
            ?: throw IllegalStateException("BitAssets RPC URL is not configured")
        val seedHex = getOrCreateSeedHex(walletFile, sharedPref)
        val config = JSONObject()
            .put("path", walletFile.absolutePath)
            .put("rpc_url", rpcUrl)
            .put("seed_hex", seedHex)
            .put("create", true)
            .put("persist_seed", false)
            .toString()

        val result = unwrap(nativeOpen(config))
        walletHandle = java.lang.Long.parseUnsignedLong(result)
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
            throw IllegalStateException("Could not persist BitAssets seed")
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
                throw IllegalStateException("Could not remove legacy BitAssets seed from wallet file")
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
        require(payload.size > 12) { "BitAssets seed payload is invalid" }
        val iv = payload.copyOfRange(0, 12)
        val ciphertext = payload.copyOfRange(12, payload.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateSecretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        val seedHex = String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        require(isSeedHex(seedHex)) { "BitAssets seed has invalid format" }
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
            throw IllegalArgumentException("BitAssets RPC URL is required")
        }
        val uri = URI(rpcUrl)
        if (uri.scheme != "http" && uri.scheme != "https") {
            throw IllegalArgumentException("BitAssets RPC URL must use http or https")
        }
        if (uri.host.isNullOrBlank()) {
            throw IllegalArgumentException("BitAssets RPC URL must include a host")
        }
        if (uri.scheme == "http" && !isLocalRpcHost(uri.host.lowercase())) {
            throw IllegalArgumentException("BitAssets RPC URL must use HTTPS unless it points to a local or private development host")
        }
    }

    private fun isLocalRpcHost(host: String): Boolean {
        if (host == "localhost" || host == "::1" || host.startsWith("127.")) return true
        if (host.startsWith("10.") || host.startsWith("192.168.")) return true
        val parts = host.split(".")
        if (parts.size < 2 || parts[0] != "172") return false
        val secondOctet = parts[1].toIntOrNull() ?: return false
        return secondOctet in 16..31
    }

    private fun resolve(promise: Promise, call: () -> String) {
        try {
            promise.resolve(synchronized(walletLock) { unwrap(call()) })
        } catch (error: Throwable) {
            promise.reject("BITASSETS_WALLET_ERROR", error.message, error)
        }
    }

    private fun unwrap(resultJson: String): String {
        val envelope = JSONObject(resultJson)
        val value = envelope.optString("value")
        if (!envelope.optBoolean("ok")) {
            throw IllegalStateException(value.ifBlank { "BitAssets wallet call failed" })
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
    private external fun nativeReserve(handle: Long, paramsJson: String): String
    private external fun nativeRegister(handle: Long, paramsJson: String): String
    private external fun nativeAmmMint(handle: Long, paramsJson: String): String
    private external fun nativeAmmSwap(handle: Long, paramsJson: String): String
    private external fun nativeAmmBurn(handle: Long, paramsJson: String): String
    private external fun nativeDutchAuctionCreate(handle: Long, paramsJson: String): String
    private external fun nativeDutchAuctionBid(handle: Long, paramsJson: String): String
    private external fun nativeDutchAuctionCollect(handle: Long, paramsJson: String): String
}
