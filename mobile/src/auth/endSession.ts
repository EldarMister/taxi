// Local sign-out must remain available during another request or an outage.
export async function endSession({ unregister, revoke, clear, timeoutMs = 2500 }: {
  unregister: () => Promise<unknown>;
  revoke: () => Promise<unknown>;
  clear: () => Promise<unknown>;
  timeoutMs?: number;
}): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled([Promise.resolve().then(unregister), Promise.resolve().then(revoke)]),
      new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await clear();
  }
}
