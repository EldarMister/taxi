package kg.taxigo.app

import org.junit.Assert.*
import org.junit.Test

class WhatsAppOtpSessionTest {
  private var time = 100L
  private val session = WhatsAppOtpSession { time }
  private val first = "d1a6e387-1bcd-43f7-9a4e-42b352574fe5"
  private val second = "815277da-6203-4fae-9341-1ec2cb867d4e"
  private val phone = "+996700123456"

  @Test fun unsolicitedOrWrongHandshakeCannotSupplyCode() {
    assertFalse(session.receive(first, "123456"))
    session.begin(first, phone)
    assertFalse(session.receive(second, "123456"))
    assertNull(session.take(first))
    assertTrue(session.receive(first, "123456"))
  }

  @Test fun earlyCodeIsBufferedForItsPhoneAndConsumedOnce() {
    session.begin(first, phone)
    assertTrue(session.receive(first, "123456"))
    assertNull(session.take(second))
    val value = session.take(first)!!
    assertEquals(phone, value.phone)
    assertEquals(first, value.requestId)
    assertEquals("123456", value.code)
    assertNull(session.take(first))
    assertFalse(session.receive(first, "123456"))
  }

  @Test fun expiredHandshakeIsRejectedAtBoundary() {
    session.begin(first, phone)
    time += 300_000L
    assertFalse(session.receive(first, "123456"))
    assertNull(session.expectedId())
  }

  @Test fun bufferedCodeExpiresToo() {
    session.begin(first, phone)
    session.receive(first, "123456")
    time += 300_000L
    assertNull(session.take(first))
  }

  @Test fun replacementInvalidatesOldCodeAndLateCancellation() {
    session.begin(first, phone)
    session.receive(first, "123456")
    session.begin(second, "+996700654321")
    session.end(first)
    assertFalse(session.receive(first, "123456"))
    assertNull(session.take(second))
    assertTrue(session.receive(second, "654321"))
    assertEquals("+996700654321", session.take(second)!!.phone)
  }

  @Test fun cancelErasesPendingCode() {
    session.begin(first, phone)
    session.receive(first, "123456")
    session.end(first)
    assertNull(session.take(first))
    assertFalse(session.receive(first, "654321"))
  }

  @Test fun onlySixAsciiDigitsAccepted() {
    session.begin(first, phone)
    for (code in listOf("", "12345", "1234567", " 123456", "12345a", "１２３４５６")) assertFalse(session.receive(first, code))
    assertTrue(session.receive(first, "000001"))
  }
}
