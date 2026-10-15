package kg.taxigo.app

import android.app.Application
import android.app.Notification
import android.os.Bundle
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.notifications.model.Notification as ExpoNotification
import expo.modules.notifications.notifications.model.NotificationRequest
import expo.modules.notifications.notifications.model.RemoteNotificationContent
import expo.modules.notifications.notifications.model.triggers.FirebaseNotificationTrigger
import expo.modules.notifications.notifications.presentation.builders.ExpoNotificationBuilder
import expo.modules.notifications.service.delegates.SharedPreferencesNotificationCategoriesStore
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.util.Date

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class AtlasOfferNotificationsTest {
  private val now = 1791520000000L
  private fun payload() = JSONObject().apply {
    put("atlasOfferVersion", "2"); put("event", "order:offer"); put("eventId", "job-one")
    put("orderId", "order-one"); put("recipientId", "driver-one")
    put("offerExpiresAt", java.time.Instant.ofEpochMilli(now + 60000).toString())
    put("atlasTitle", "Новый заказ · 90 сом")
    put("atlasMessage", "Откуда: Ленина, 10\nКуда: Ленина, 27\nМаршрут: 0,4 км · ≈1 мин")
  }
  private fun remote(payload: JSONObject) = RemoteMessage(Bundle().apply {
    putString("body", payload.toString()); putString("google.message_id", "message-one")
    putString("google.delivered_priority", "high")
  })

  @Test fun backgroundDataMessageBuildsTwoActualAndroidActions() = runBlocking {
    val input = remote(payload())
    val message = AtlasOfferNotifications.normalize(input, now)
    assertNotSame(input, message)
    assertNull(message.notification) // FCM must not auto-render a second card.
    assertEquals("message-one", message.messageId)
    val context = RuntimeEnvironment.getApplication()
    AtlasOfferNotifications.ensureActions(context)
    val content = RemoteNotificationContent(message)
    assertEquals("order-one", content.body!!.getString("orderId"))
    assertFalse(content.body!!.has("atlasTitle"))
    val request = NotificationRequest(message.messageId, content, FirebaseNotificationTrigger(message))
    val notification = ExpoNotificationBuilder(context, ExpoNotification(request, Date(now)), SharedPreferencesNotificationCategoriesStore(context)).build()
    assertEquals("driver-orders-v2", notification.channelId)
    assertEquals("Новый заказ · 90 сом", notification.extras.getString(Notification.EXTRA_TITLE))
    assertEquals(2, notification.actions.size)
    assertEquals(listOf("Взять", "Пропустить"), notification.actions.map { it.title.toString() })
    assertTrue(notification.actions.all { it.actionIntent != null })
    assertTrue(notification.extras.getCharSequence(Notification.EXTRA_BIG_TEXT).toString().contains("0,4 км"))
  }

  @Test fun expiredMalformedAndUnrelatedMessagesAreNeverConvertedIntoActionCards() {
    val samples = listOf(payload().put("offerExpiresAt", java.time.Instant.ofEpochMilli(now - 1).toString()),
      payload().put("recipientId", "../other"), payload().put("event", "chat:message"), payload().put("atlasOfferVersion", "1"))
    samples.forEach { value -> val message = remote(value); assertSame(message, AtlasOfferNotifications.normalize(message, now)) }
  }

  @Test fun localizedPersistedActionsSurviveNativeSetup() {
    val context = RuntimeEnvironment.getApplication()
    val store = SharedPreferencesNotificationCategoriesStore(context)
    store.saveNotificationCategory(expo.modules.notifications.notifications.model.NotificationCategory(AtlasOfferNotifications.CATEGORY, listOf(
      expo.modules.notifications.notifications.model.NotificationAction(AtlasOfferNotifications.ACCEPT, "Accept", true),
      expo.modules.notifications.notifications.model.NotificationAction(AtlasOfferNotifications.SKIP, "Skip", true))))
    AtlasOfferNotifications.ensureActions(context)
    assertEquals(listOf("Accept", "Skip"), store.getNotificationCategory(AtlasOfferNotifications.CATEGORY)!!.actions.map { it.title })
  }
}
