package kg.taxigo.app

// OTPs stay in process memory only, never preferences, backups or logs.
internal class WhatsAppOtpValue(val requestId: String, val phone: String, val code: String)

internal class WhatsAppOtpSession(private val now: () -> Long) {
  private var id: String? = null
  private var phone = ""
  private var expiresAt = 0L
  private var received = false
  private var pending: WhatsAppOtpValue? = null

  @Synchronized fun begin(requestId: String, number: String) {
    id = requestId
    phone = number
    expiresAt = now() + 300_000L
    received = false
    pending = null
  }

  @Synchronized fun expectedId(): String? {
    if (now() >= expiresAt) clear()
    return id
  }

  @Synchronized fun receive(requestId: String, code: String): Boolean {
    if (expectedId() != requestId || received || !Regex("^[0-9]{6}$").matches(code)) return false
    received = true
    pending = WhatsAppOtpValue(requestId, phone, code)
    return true
  }

  @Synchronized fun take(requestId: String): WhatsAppOtpValue? {
    if (expectedId() != requestId) return null
    return pending.also { pending = null }
  }

  @Synchronized fun end(requestId: String) {
    // A late cancellation of an old attempt cannot cancel a new handshake.
    if (id == requestId) clear()
  }

  private fun clear() {
    id = null
    phone = ""
    pending = null
    received = false
    expiresAt = 0L
  }
}
