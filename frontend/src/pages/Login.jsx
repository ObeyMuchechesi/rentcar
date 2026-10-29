import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { COUNTRIES } from '../lib/countries';
import { useAuth } from '../context/AuthContext';

const EMPTY = { name: '', email: '', password: '', phone: '', country: '', drivingLicenceNumber: '', drivingLicenceCountry: '' };

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState(location.state?.mode === 'register' ? 'register' : 'login');
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const target = location.state?.from || '/dashboard';

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user =
        mode === 'login'
          ? await login(form.email, form.password)
          : await register({
              name: form.name,
              email: form.email,
              password: form.password,
              phone: form.phone || undefined,
              country: form.country || undefined,
              drivingLicenceNumber: form.drivingLicenceNumber || undefined,
              drivingLicenceCountry: form.drivingLicenceCountry || undefined,
            });
      // A manager has no business on the booking side of the site.
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

        <p className="muted small">
          {mode === 'login'
            ? 'Renter details and staff sign in here. Booking a car does not need an account until you accept a quote.'
            : 'An account holds your licence details so a branch can verify you at the counter.'}
        </p>

        <form onSubmit={submit} className="stack">
          {mode === 'register' && (
            <>
              <label>
                Full name
                <input value={form.name} onChange={set('name')} required minLength={2} placeholder="Alex Rivera" />
              </label>
              <div className="grid-2">
                <label>
                  Phone (international)
                  <input value={form.phone} onChange={set('phone')} placeholder="+1 415 555 0100" />
                </label>
                <label>
                  Your country
                  <select value={form.country} onChange={set('country')}>
                    <option value="">Not set</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid-2">
                <label>
                  Licence number
                  <input value={form.drivingLicenceNumber} onChange={set('drivingLicenceNumber')} maxLength={40} />
                </label>
                <label>
                  Licence issued in
                  <select value={form.drivingLicenceCountry} onChange={set('drivingLicenceCountry')}>
                    <option value="">Not set</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </>
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

          {error && <p className="alert">{error}</p>}
          <button className="btn primary block" disabled={busy}>
            {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="muted small">
          Demo fleet logins are in the project README. <Link to="/">Back to the cars</Link>.
        </p>
      </div>
    </div>
  );
}
