package kg.taxigo.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class AtlasSystemPermissionsPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(AtlasSystemPermissionsModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

class AtlasSystemPermissionsModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "AtlasSystemPermissions"

  @ReactMethod
  fun canDrawOverlays(promise: Promise) {
    try { promise.resolve(Settings.canDrawOverlays(reactApplicationContext)) }
    catch (error: Exception) { promise.reject("permission_state", "Не удалось проверить разрешение всплывающих окон.", error) }
  }

  @ReactMethod
  fun isBatterySaverDisabled(promise: Promise) {
    try {
      val manager = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
      promise.resolve(!manager.isPowerSaveMode)
    } catch (error: Exception) { promise.reject("permission_state", "Не удалось проверить энергосбережение.", error) }
  }

  @ReactMethod
  fun openOverlaySettings(promise: Promise) {
    openSettings(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, true, promise)
  }

  @ReactMethod
  fun openBatterySaverSettings(promise: Promise) {
    openSettings(Settings.ACTION_BATTERY_SAVER_SETTINGS, false, promise)
  }

  private fun openSettings(action: String, applicationSpecific: Boolean, promise: Promise) {
    try {
      val intent = Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      if (applicationSpecific) intent.data = Uri.parse("package:${reactApplicationContext.packageName}")
      reactApplicationContext.startActivity(intent)
      // Resolving only acknowledges that Settings opened. JavaScript checks
      // the actual OS state again when the application returns to the front.
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("permission_settings", "Не удалось открыть настройки устройства.", error)
    }
  }
}
