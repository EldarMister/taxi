package kg.taxigo.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.os.Bundle
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.notifications.model.NotificationAction
import expo.modules.notifications.notifications.model.NotificationCategory
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import expo.modules.notifications.service.delegates.SharedPreferencesNotificationCategoriesStore
import org.json.JSONObject

/** Converts an opted-in Expo data message before Expo builds the Android card. */
class AtlasOfferMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    val normalized = if (packageName == "atlas.pro") AtlasOfferNotifications.normalize(message) else message
    if (normalized !== message) AtlasOfferNotifications.ensureActions(this)
    super.onMessageReceived(normalized)
  }
}

internal object AtlasOfferNotifications {
  const val CATEGORY = "atlas-driver-offer-v1"
  const val CHANNEL = "driver-orders-v2"
  const val ACCEPT = "atlas-order-accept"
  const val SKIP = "atlas-order-skip"

  fun normalize(message: RemoteMessage, now: Long = System.currentTimeMillis()): RemoteMessage {
    if (message.notification != null) return message
    val payload = try { JSONObject(message.data["body"] ?: return message) } catch (_: Exception) { return message }
    if (payload.optString("atlasOfferVersion") != "2" || payload.optString("event") != "order:offer") return message
    val id = Regex("[a-zA-Z0-9-]{1,80}")
    if (!id.matches(payload.optString("orderId")) || !id.matches(payload.optString("recipientId"))) return message
    val expires = try { java.time.Instant.parse(payload.optString("offerExpiresAt")).toEpochMilli() } catch (_: Exception) { return message }
    if (expires <= now || payload.optString("atlasTitle").isBlank() || payload.optString("atlasMessage").isBlank()) return message
    val title = payload.getString("atlasTitle").take(200)
    val text = payload.getString("atlasMessage").take(1600)
    payload.remove("atlasTitle"); payload.remove("atlasMessage"); payload.remove("atlasOfferVersion")
    val bundle = Bundle()
    message.data.forEach { (key, value) -> bundle.putString(key, value) }
    bundle.putString("title", title)
    bundle.putString("message", text)
    bundle.putString("body", payload.toString())
    bundle.putString("categoryId", CATEGORY)
    bundle.putString("channelId", CHANNEL)
    bundle.putString("sound", "driver_new_order.wav")
    message.messageId?.let { bundle.putString("google.message_id", it) }
    bundle.putLong("google.sent_time", message.sentTime)
    bundle.putInt("google.ttl", message.ttl)
    bundle.putString("google.delivered_priority", "high")
    return RemoteMessage(bundle)
  }

  fun ensureActions(context: Context) {
    val store = SharedPreferencesNotificationCategoriesStore(context)
    val existing = try { store.getNotificationCategory(CATEGORY) } catch (_: Exception) { null }
    if (existing?.actions?.map { it.identifier } != listOf(ACCEPT, SKIP)) {
      store.saveNotificationCategory(NotificationCategory(CATEGORY, listOf(
        NotificationAction(ACCEPT, "Взять", true), NotificationAction(SKIP, "Пропустить", true)
      )))
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL) == null) {
        val channel = NotificationChannel(CHANNEL, "Новый заказ", NotificationManager.IMPORTANCE_HIGH)
        val resource = context.resources.getIdentifier("driver_new_order", "raw", context.packageName)
        if (resource != 0) channel.setSound(Uri.parse("android.resource://${context.packageName}/$resource"),
          AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
        channel.enableVibration(true)
        channel.vibrationPattern = longArrayOf(0, 200, 100, 200)
        manager.createNotificationChannel(channel)
      }
    }
  }
}
