import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const target = location.state?.from || '/';

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user =
        mode === 'login'
          ? await login(form.email, form.password)
          : await register({ name: form.name, email: form.email, password: form.password, phone: form.phone });
      navigate(user.role === 'manager' ? '/admin' : target, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="card auth-card">
        <div className="tabs">
          <button className={mode === 'login' ? 'tab active' : 'tab'} onClick={() => setMode('login')}>
            Sign in
          </button>
          <button className={mode === 'register' ? 'tab active' : 'tab'} onClick={() => setMode('register')}>
            Create account
          </button>
        </div>

        <form onSubmit={submit} className="stack">
          {mode === 'register' && (
            <label>
              Full name
              <input value={form.name} onChange={set('name')} required minLength={2} placeholder="Naledi Mokoena" />
            </label>
          )}
          <label>
            Email
            <input type="email" value={form.email} onChange={set('email')} required placeholder="you@example.com" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={form.password}
              onChange={set('password')}
              required
              minLength={8}
              placeholder="At least 8 characters"
            />
          </label>
          {mode === 'register' && (
            <label>
              Phone (optional)
              <input value={form.phone} onChange={set('phone')} placeholder="+27 82 000 0000" />
            </label>
          )}

          {error && <p className="alert">{error}</p>}
          <button className="btn primary block" disabled={busy}>
            {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="muted small">
          Seeded demo logins are listed on the <Link to="/">search page</Link>.
        </p>
      </div>
    </div>
  );
}
