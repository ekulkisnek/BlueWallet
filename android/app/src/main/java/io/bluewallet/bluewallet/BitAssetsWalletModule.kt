package io.bluewallet.bluewallet

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import org.json.JSONObject
import java.io.File

@ReactModule(name = BitAssetsWalletModule.NAME)
class BitAssetsWalletModule(private val reactContext: ReactApplicationContext) : NativeBitAssetsWalletSpec(reactContext) {
    companion object {
        const val NAME = "BitAssetsWallet"

        init {
            try {
                System.loadLibrary("floresta_bitassets_wallet")
            } catch (_: UnsatisfiedLinkError) {
            }
        }
    }

    private var walletHandle: Long = 0

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

    private fun openWallet(): Long {
        if (walletHandle != 0L) return walletHandle

        val walletDir = File(reactContext.filesDir, "bitassets")
        walletDir.mkdirs()
        val sharedPref = reactContext.getSharedPreferences("group.com.layertwolabs.bluewallet", android.content.Context.MODE_PRIVATE)
        val rpcUrl = sharedPref.getString("bitassetsRpcUrl", "http://127.0.0.1:6004") ?: "http://127.0.0.1:6004"
        val config = JSONObject()
            .put("path", File(walletDir, "wallet.json").absolutePath)
            .put("rpc_url", rpcUrl)
            .put("create", true)
            .toString()

        val result = unwrap(nativeOpen(config))
        walletHandle = result.toLong()
        return walletHandle
    }

    private fun resolve(promise: Promise, call: () -> String) {
        try {
            promise.resolve(unwrap(call()))
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
