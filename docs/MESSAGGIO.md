# WhatsApp → Telegram codes for Atlas

The existing client and driver authentication endpoints stay the same:
`POST /api/auth/request-code` and `POST /api/auth/verify-code`.
Atlas generates a random six-digit code, stores its HMAC, verifies it locally,
expires it after five minutes and accepts it once. The existing phone/IP limits,
60-second resend cooldown and five incorrect attempts remain in place.

## First activate the Messaggio account

Account registration alone does not enable WhatsApp delivery.

1. In [Messaggio](https://my.messaggio.com), create an Atlas project and a
   WhatsApp sender. Complete the business/phone verification requested by
   Messaggio/Meta and wait for the sender to become active. Ask Messaggio support
   to enable WhatsApp **authentication codes to Kyrgyzstan (+996)** if necessary.
2. Create and obtain approval for an **AUTHENTICATION** template with a single
   code variable in the body and a **Copy Code** button. Select a supported
   language (e.g. Russian `ru`); use exactly the approved language and template
   name in Atlas. This implementation targets Copy Code, not Android one-tap
   or zero-tap templates.
3. In the activated sender's API details find **Project Login** and **Code API**.
   Project Login is the credential for the `Messaggio-Login` header, not the
   password used to sign in to the dashboard. Code API identifies the sender;
   it is not the displayed sender name or your phone number.
4. Ensure the account agreement and message balance meet Messaggio's activation
   requirements. The account owner completes any agreement/payment steps.

Send this request to your Messaggio manager/support if the required options are
missing: “We need WhatsApp AUTHENTICATION OTP delivery for Atlas, recipients in
Kyrgyzstan (+996), six-digit codes, five-minute expiry, Copy Code button. Please
activate the sender and template and provide Project Login, sender Code API,
the approved template name and its language code for the Multichannel API.”

## Server configuration

Add these variables to the **api** service in the existing Railway project:

```dotenv
SMS_PROVIDER=messaggio
DEV_AUTH_ENABLED=false
MESSAGGIO_LOGIN=<Project Login>
MESSAGGIO_WHATSAPP_SENDER=<Code API>
MESSAGGIO_WHATSAPP_TEMPLATE=<approved template name>
MESSAGGIO_WHATSAPP_LANGUAGE=ru
TELEGRAM_GATEWAY_TOKEN=<Telegram Gateway access token, optional until ready>
```

Keep credentials on the server only, in Railway variables or an ignored
`server/.env`. Do not add them to mobile `EXPO_PUBLIC_*`, GitHub, logs or chat.
Deploy the provider implementation and the OTP delivery migration before enabling these settings. Missing
required fields prevent server startup, rather than silently falling back to
the development code. The additive `20261009120000_otp_delivery_fallback` migration creates the delivery-attempt table; existing user/session data is preserved.

Until sender/template activation and a live delivery check are complete, keep
the current deployment settings. Do not claim that codes are delivered yet.
Switching to the real provider disables fixed development codes and their
exposure even if `NODE_ENV=development` and an old `DEV_AUTH_ENABLED=true` remain.
The real provider should still be configured with `DEV_AUTH_ENABLED=false`.

## Transport and failure behavior

The provider uses the [official Multichannel API](https://messaggio.com/api-docs/)
and its [UPD 22.06.2026 specification](https://messaggio.com/messaggio_api_01062026_en_4.yaml):
`POST https://msg.messaggio.com/api/v1/send`, `Messaggio-Login` header,
digits-only recipient phone, `channels: ["whatsapp"]`, a template body parameter
and the same code in the Copy Code button parameter. WhatsApp TTL is 60 seconds with Gateway fallback enabled, otherwise 300 seconds. OTP validity remains five minutes.

HTTP 200 alone is insufficient: the response must accept the specific recipient
with a nonempty `message_id` and no recipient error. A request is marked sent
only after this acceptance; that does **not** prove handset delivery. Without Telegram configured, invalid responses, network failures and provider rejection leave the code unusable and return a safe error. With Gateway configured, these failures trigger one Telegram send using the same OTP. There are no SMS fallbacks or automatic retransmissions in either channel.
Timeouts can occur after acceptance; blindly retrying would risk duplicate
messages. Use the normal resend action after the existing cooldown.

`request-code` adds `channel: "whatsapp"` or `"telegram"` and, when fallback is enabled, an opaque `deliveryId`. `GET /api/auth/code-delivery/:id` returns only the channel/state; it never exposes phone numbers, codes or provider identifiers. Updated client and driver builds use
this to describe the channel and preserve the existing code/paste/resend flow.
Older builds remain protocol-compatible but may still label the message SMS.
`sent`, `retryAfterSeconds` and all verification/session fields remain compatible.

## Telegram Gateway fallback after WhatsApp

Register at https://gateway.telegram.org and obtain the Gateway API access token
from account settings. A BotFather token is not a Gateway token. Add
`TELEGRAM_GATEWAY_TOKEN` to the API service's private variables. Maintain a
Gateway balance for real recipients; sending to the Gateway account owner's
own Telegram phone is free. Do not put tokens in the app or source control.

The agreed route is **WhatsApp first, Telegram second**. It does not probe which
apps are installed. Synchronous WhatsApp refusal or network failure triggers
Telegram immediately. An accepted WhatsApp request is monitored with the
Messaggio statuses API. Delivered/read status stops fallback; a failure status
(e.g. 91: channel unavailable), expired WhatsApp TTL or absence of delivery
confirmation for 60 seconds triggers Telegram. Pending/error status lookups
alone do not claim that the user lacks WhatsApp.

Telegram uses `sendVerificationMessage` with the server-generated six-digit
code, E.164 phone, remaining OTP lifetime and Authorization Bearer header.
There is no separately charged `checkSendAbility` request. Responses must have
`ok:true`, the correct phone and a request ID. Both channels failing returns
a clear error. Ambiguous timeouts can result in messages in both apps; they
contain the same code and cannot create two sessions with a reused code.

Durable jobs survive server restarts. Atomic claims prevent concurrent workers
from sending the Telegram fallback twice. An interrupted/ambiguous Telegram
send is not blindly retried. Pending codes are encrypted with AES-256-GCM,
a domain-separated OTP-secret key and per-attempt authenticated identity;
ciphertext is erased on terminal state/expiry and attempts retained at most
24 hours after expiry. Superseded/consumed OTP challenges stop fallback.

The updated client and driver poll the opaque delivery receipt while the code
screen is open. A confirmed Telegram acceptance changes the channel label
without replacing the user's partially entered digits or resetting the cooldown.
Older APKs can still verify the same code but cannot show automatic channel
changes; rebuild them to use the updated interface.

References: [Telegram Gateway API](https://core.telegram.org/gateway/api),
[Gateway account](https://gateway.telegram.org).

## Verification

Local checks:

```text
server: npm run test:auth; npm run build
mobile: npm run test:auth; npm run typecheck
```

Verification of the fallback implementation: 21 server tests and 27 mobile tests passed, server build and mobile typecheck passed. All 26 migrations were applied to a disposable PostgreSQL 18 cluster. A real-database test exercised request → accepted WhatsApp → unavailable delivery status → single Telegram fallback across concurrent workers → login, single-use rejection and resend cooldown. Provider requests in that test were mocked; no real messages were sent.

Provider tests replace the network boundary and cover the official payload,
recipient rejection inside HTTP 200, malformed responses, transport failure,
no duplicate sends, HMAC storage, pending-code rejection, successful login,
single-use/expired codes, incorrect-attempt protection, request throttling and
development isolation. Mobile tests cover channel text, language, confirmation
and the existing resend/change-number flow, direct Telegram and asynchronous fallback labels. Fallback tests cover rejection, delayed failure, delivery timeout, restart recovery, concurrent claims, verified/superseded/expired challenges and encrypted code storage.

Before activation is considered complete, request a code to an owner-approved
WhatsApp test number, confirm the message and Copy Code button, sign in using
that actual code, verify that it cannot be reused, wait for the cooldown and
check resend/change number in the client and driver. Check Messaggio delivery
status if the request is accepted but no message arrives. This real test remains
pending until the sender, template and credentials are supplied.

Setup references:
[Sender registration](https://messaggio.com/guides/how-to-create-a-sender-id/),
[WhatsApp sender requirements](https://messaggio.com/guides/whatsapp-sender-id-requirements/).
