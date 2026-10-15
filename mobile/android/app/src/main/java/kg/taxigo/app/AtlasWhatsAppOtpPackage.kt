package kg.taxigo.app

import android.content.Intent
import android.os.SystemClock
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager
import com.whatsapp.otp.android.sdk.WhatsAppOtpHandler
import com.whatsapp.otp.android.sdk.WhatsAppOtpIncomingIntentHandler
import java.util.UUID

internal object AtlasWhatsAppOtp {
  const val ACTION = "com.whatsapp.otp.OTP_RETRIEVED"
  val session = WhatsAppOtpSession { SystemClock.elapsedRealtime() }
  @Volatile var notifyAvailable: (() -> Unit)? = null

  fun receive(intent: Intent?): Boolean {
    if (intent?.action != ACTION) return false
    val expected = session.expectedId() ?: return false
    try {
      val code = WhatsAppOtpIncomingIntentHandler().getOtpCodeFromWhatsAppIntent(intent, expected) ?: return false
      if (!session.receive(expected, code)) return false
      notifyAvailable?.invoke()
      return true
    } catch (_: Exception) { return false }
  }
}

class AtlasWhatsAppOtpPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(AtlasWhatsAppOtpModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

class AtlasWhatsAppOtpModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  @Volatile private var listeners = 0
  private val notify: () -> Unit = {
    UiThreadUtil.runOnUiThread {
      if (listeners > 0 && reactApplicationContext.hasActiveReactInstance()) {
        // No code/phone in broadcasts or events: JS explicitly drains the in-process buffer.
        reactApplicationContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("AtlasWhatsAppOtpAvailable", null)
      }
    }
  }

  override fun getName() = "AtlasWhatsAppOtp"
  override fun initialize() { super.initialize(); AtlasWhatsAppOtp.notifyAvailable = notify }
  override fun invalidate() {
    if (AtlasWhatsAppOtp.notifyAvailable === notify) AtlasWhatsAppOtp.notifyAvailable = null
    super.invalidate()
  }

  @ReactMethod fun addListener(eventName: String) { listeners++ }
  @ReactMethod fun removeListeners(count: Double) { listeners = (listeners - count.toInt()).coerceAtLeast(0) }

  @ReactMethod fun begin(phone: String, promise: Promise) {
    if (!Regex("^\\+[1-9][0-9]{7,14}$").matches(phone)) { promise.resolve(null); return }
    val handler = WhatsAppOtpHandler()
    val id = UUID.randomUUID()
    try {
      if (!handler.isWhatsAppOtpHandshakeSupported(reactApplicationContext)) { promise.resolve(null); return }
      AtlasWhatsAppOtp.session.begin(id.toString(), phone)
      // Store before broadcasting so an immediate reply cannot race registration.
      handler.sendOtpIntentToWhatsApp(id, reactApplicationContext)
      promise.resolve(id.toString())
    } catch (_: Exception) {
      AtlasWhatsAppOtp.session.end(id.toString())
      promise.resolve(null)
    }
  }

  @ReactMethod fun take(requestId: String, promise: Promise) {
    val value = AtlasWhatsAppOtp.session.take(requestId)
    promise.resolve(value?.let { Arguments.createMap().apply {
      putString("requestId", it.requestId); putString("phone", it.phone); putString("code", it.code)
    } })
  }

  @ReactMethod fun end(requestId: String, promise: Promise) {
    AtlasWhatsAppOtp.session.end(requestId)
    promise.resolve(null)
  }
}
