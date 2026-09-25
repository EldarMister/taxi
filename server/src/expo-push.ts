type Token = { id: string; token: string };
type Message = { title: string; body: string; sound: string; channelId: string; ttl: number; priority: 'high'; data: Record<string, string> };
type Report = { delivered: number; invalidIds: string[]; failures: string[] };

function safeCode(value: unknown, fallback: string) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._/-]{0,100}$/i.test(value) ? value : fallback;
}

/** Each Expo project must be sent separately; one stale token must not reject every device. */
export async function sendExpoPushIndividually(tokens: Token[], message: Message, accessToken?: string,
  fetcher: typeof fetch = fetch): Promise<Report> {
  const results = await Promise.all(tokens.map(async ({ id, token }) => {
    try {
      const response = await fetcher('https://exp.host/--/api/v2/push/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ ...message, to: token }), signal: AbortSignal.timeout(10000),
      });
      const payload = await response.json().catch(() => null) as {
        data?: { status?: string; details?: { error?: unknown } } | { status?: string; details?: { error?: unknown } }[];
        errors?: { code?: unknown }[];
      } | null;
      if (!response.ok) return { id, failure: `expo-http-${response.status}-${safeCode(payload?.errors?.[0]?.code, 'unknown')}` };
      const ticket = Array.isArray(payload?.data) ? payload.data[0] : payload?.data;
      if (ticket?.status === 'ok') return { id, delivered: true };
      if (ticket?.details?.error === 'DeviceNotRegistered') return { id, invalid: true };
      return { id, failure: `expo-ticket-${safeCode(ticket?.details?.error, 'invalid-response')}` };
    } catch (error) {
      const name = error && typeof error === 'object' && 'name' in error ? Reflect.get(error, 'name') : undefined;
      return { id, failure: `expo-request-${safeCode(name, 'error')}` };
    }
  }));
  return {
    delivered: results.filter(result => 'delivered' in result).length,
    invalidIds: results.filter(result => 'invalid' in result).map(result => result.id),
    failures: results.flatMap(result => 'failure' in result && typeof result.failure === 'string' ? [result.failure] : []),
  };
}
