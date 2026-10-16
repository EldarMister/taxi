import React, { useEffect, useState } from 'react';

const apiBase = import.meta.env.PROD
  ? (import.meta.env.VITE_PUBLIC_API_URL?.trim() || 'https://api-production-47be.up.railway.app/api').replace(/\/+$/, '')
  : '/api';

function phoneDigits(value) {
  const digits = value.replace(/\D/g, '');
  return (digits.startsWith('996') && digits.length > 9 ? digits.slice(3) : digits).slice(0, 9);
}

async function post(path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    credentials: 'omit',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(result.message) ? result.message[0] : result.message;
    throw Object.assign(new Error(typeof message === 'string' ? message : 'Не удалось выполнить запрос. Попробуйте позже.'), { status: response.status });
  }
  return result;
}

export default function AccountDeletionForm() {
  const [variant, setVariant] = useState('client');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleted, setDeleted] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (retryAt <= Date.now()) return undefined;
    const timer = window.setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= retryAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  const retrySeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const fullPhone = `+996${phone}`;

  async function requestCode(event) {
    event.preventDefault();
    if (phone.length !== 9 || busy || retrySeconds > 0) return;
    setBusy(true);
    setError('');
    try {
      const result = await post('/auth/request-code', { phone: fullPhone, appVariant: variant });
      setSent(true);
      setCode('');
      setAccepted(false);
      setRetryAt(Date.now() + (result.retryAfterSeconds || 60) * 1000);
      setNow(Date.now());
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount(event) {
    event.preventDefault();
    if (!sent || code.length !== 6 || !accepted || busy) return;
    setBusy(true);
    setError('');
    try {
      await post('/account-deletion/confirm', { phone: fullPhone, code, appVariant: variant });
      setDeleted(true);
      setCode('');
      setPhone('');
    } catch (cause) {
      setError(cause.message);
      if (cause.status === 409) { setSent(false); setCode(''); setAccepted(false); }
    } finally {
      setBusy(false);
    }
  }

  if (deleted) return <div className="delete-account-card delete-account-complete" role="status"><strong>Аккаунт удалён</strong><p>Доступ к нему закрыт, история и данные аккаунта удалены из рабочей базы. Если приложение открыто на другом устройстве, его сессия завершится.</p></div>;

  return <div className="delete-account-card">
    <h3>Удалить аккаунт по номеру телефона</h3>
    <p>Выберите приложение, укажите номер аккаунта и подтвердите удаление кодом. Код действует ограниченное время.</p>
    <div className="delete-account-variants" role="group" aria-label="Приложение">
      <button type="button" aria-pressed={variant === 'client'} onClick={() => { setVariant('client'); setSent(false); setCode(''); setAccepted(false); setError(''); setRetryAt(0); }} disabled={busy}>Atlas</button>
      <button type="button" aria-pressed={variant === 'driver'} onClick={() => { setVariant('driver'); setSent(false); setCode(''); setAccepted(false); setError(''); setRetryAt(0); }} disabled={busy}>Atlas pro</button>
    </div>
    <form onSubmit={requestCode}>
      <label htmlFor="delete-phone">Номер телефона аккаунта</label>
      <div className="delete-account-phone"><span>+996</span><input id="delete-phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="700 123 456" value={phone} onChange={event => { setPhone(phoneDigits(event.target.value)); setSent(false); setCode(''); setAccepted(false); setError(''); setRetryAt(0); }} disabled={busy} required /></div>
      <button className="delete-account-secondary" type="submit" disabled={busy || phone.length !== 9 || retrySeconds > 0}>{busy ? 'Подождите…' : retrySeconds ? `Отправить повторно через ${retrySeconds} с` : sent ? 'Отправить код повторно' : 'Получить код'}</button>
    </form>
    {sent && <form onSubmit={deleteAccount}>
      <p className="delete-account-sent" role="status">Код подтверждения отправлен на {fullPhone}.</p>
      <label htmlFor="delete-code">Код подтверждения</label>
      <input id="delete-code" className="delete-account-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="6 цифр" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy} required />
      <label className="delete-account-consent"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} disabled={busy} required /><span>Я понимаю, что выбранный аккаунт {variant === 'driver' ? 'ATLAS PRO' : 'ATLAS'} и его история будут удалены из рабочей базы без восстановления. Отдельно хранящиеся данные описаны ниже.</span></label>
      <button className="delete-account-danger" type="submit" disabled={busy || code.length !== 6 || !accepted}>{busy ? 'Удаляем…' : 'Удалить аккаунт'}</button>
    </form>}
    {error && <p className="delete-account-error" role="alert">{error}</p>}
    <p className="delete-account-hint">Если есть активный заказ, сначала завершите или отмените его. Если нет доступа к номеру, обратитесь в поддержку ниже.</p>
  </div>;
}
