package kg.taxigo.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle

// One-tap fallback of the same zero-tap template, without a second login screen.
class WhatsAppOtpActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (AtlasWhatsAppOtp.receive(intent)) {
      startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP))
    }
    finish()
  }
}
