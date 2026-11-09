import type { PublicDioceseSummary } from '@parishmap/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, Route, Routes } from 'react-router';
import { StatusMessage } from '../components/StatusMessage';
import { getJson, useLoad } from '../lib/api';
import './admin.css';
import { adminRequest, AdminApiError } from './api';
import { OutlinePage } from './pages/OutlinePage';
import { ParishesPage } from './pages/ParishesPage';
import { ParishPage } from './pages/ParishPage';

type Session = 'checking' | 'in' | 'out' | 'not-configured' | 'error';

export default function AdminApp() {
  const { t } = useTranslation();
  const [session, setSession] = useState<Session>('checking');

  const check = useCallback(() => {
    setSession('checking');
    adminRequest('/me')
      .then(() => setSession('in'))
      .catch((error: unknown) => {
        if (error instanceof AdminApiError && error.status === 401) setSession('out');
        else if (error instanceof AdminApiError && error.status === 503) {
          setSession('not-configured');
        } else setSession('error');
      });
  }, []);

  useEffect(check, [check]);

  useEffect(() => {
    document.title = `${t('admin.title')} · ${t('app.name')}`;
  }, [t]);

  if (session === 'checking') return <StatusMessage>{t('common.loading')}</StatusMessage>;
  if (session === 'not-configured') {
    return <StatusMessage>{t('admin.login.notConfigured')}</StatusMessage>;
  }
  if (session === 'error') {
    return <StatusMessage onRetry={check}>{t('common.loadError')}</StatusMessage>;
  }
  if (session === 'out') return <LoginForm onLogin={() => setSession('in')} />;

  const logout = () => {
    void adminRequest('/logout', { body: {} }).finally(() => setSession('out'));
  };

  return (
    <div className="admin">
      <header className="admin-header">
        <Link to="/admin" className="admin-brand">
          {t('app.name')} · {t('admin.title')}
        </Link>
        <nav>
          <Link to="/" target="_blank">
            {t('admin.viewPublic')}
          </Link>
          <button type="button" className="button" onClick={logout}>
            {t('admin.logout')}
          </button>
        </nav>
      </header>
      <Routes>
        <Route index element={<FirstDiocese />} />
        <Route path=":dioceseSlug" element={<ParishesPage />} />
        <Route path=":dioceseSlug/outline" element={<OutlinePage />} />
        <Route path=":dioceseSlug/parishes/:parishId" element={<ParishPage />} />
      </Routes>
    </div>
  );
}

function FirstDiocese() {
  const { t } = useTranslation();
  const { state, retry } = useLoad('dioceses', (signal) =>
    getJson<PublicDioceseSummary[]>('/api/dioceses', signal),
  );
  if (state.status === 'loading') return <StatusMessage>{t('common.loading')}</StatusMessage>;
  if (state.status === 'error') {
    return <StatusMessage onRetry={retry}>{t('common.loadError')}</StatusMessage>;
  }
  const [first] = state.data;
  if (!first) return <StatusMessage>{t('home.empty')}</StatusMessage>;
  return <Navigate to={`/admin/${first.slug}`} replace />;
}

function LoginForm({ onLogin }: { onLogin: () => void }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminRequest('/login', { body: { username, password } });
      onLogin();
    } catch (caught) {
      const status = caught instanceof AdminApiError ? caught.status : 0;
      if (status === 401) setError(t('admin.login.invalid'));
      else if (status === 429) setError(t('admin.login.tooMany'));
      else setError(t('admin.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-login">
      <h1>{t('admin.login.title')}</h1>
      <form onSubmit={(event) => void submit(event)}>
        <label className="admin-field">
          <span>{t('admin.login.username')}</span>
          <input
            value={username}
            autoComplete="username"
            required
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>{t('admin.login.password')}</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            required
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <p className="message message-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button button-primary" disabled={busy}>
          {t('admin.login.submit')}
        </button>
      </form>
    </main>
  );
}
