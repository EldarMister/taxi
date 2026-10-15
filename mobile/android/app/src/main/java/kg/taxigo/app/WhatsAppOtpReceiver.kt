package kg.taxigo.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class WhatsAppOtpReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    AtlasWhatsAppOtp.receive(intent)
  }
}
