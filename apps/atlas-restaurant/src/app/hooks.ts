import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../data/api';
export function useResource<T>(path: string | null, revision = 0) {
  const [retry, setRetry] = useState(0);
  const requestKey = JSON.stringify([path, revision, retry]);
  const [state, setState] = useState<{
    key: string;
    data: T | null;
    loading: boolean;
    error: string;
  }>({ key: requestKey, data: null, loading: !!path, error: '' });
  useEffect(() => {
    let active = true;
    setState({ key: requestKey, data: null, loading: !!path, error: '' });
    if (path)
      void api
        .request<T>(path)
        .then((data) => {
          if (active)
            setState({ key: requestKey, data, loading: false, error: '' });
        })
        .catch((error) => {
          if (active)
            setState({
              key: requestKey,
              data: null,
              loading: false,
              error: error.message,
            });
        });
    return () => {
      active = false;
    };
  }, [path, requestKey]);
  // A changed restaurant, permission or analytics period must never render the preceding response.
  const current =
    state.key === requestKey
      ? state
      : { data: null, loading: !!path, error: '' };
  return { ...current, reload: useCallback(() => setRetry((n) => n + 1), []) };
}
export function useCommand() {
  const lock = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async (operation: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (error) {
      if (mounted.current)
        setError(
          error instanceof Error
            ? error.message
            : 'Не удалось сохранить изменения.',
        );
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { busy, error, run, clearError: () => setError('') };
}
