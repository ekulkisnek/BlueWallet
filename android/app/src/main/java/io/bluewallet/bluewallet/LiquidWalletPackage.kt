package io.bluewallet.bluewallet

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager

class LiquidWalletPackage : TurboReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
        return if (name == LiquidWalletModule.NAME) LiquidWalletModule(reactContext) else null
    }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
        val moduleInfo = ReactModuleInfo(
            LiquidWalletModule.NAME,
            LiquidWalletModule.NAME,
            false,
            false,
            false,
            false,
            true
        )
        mapOf(LiquidWalletModule.NAME to moduleInfo)
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
