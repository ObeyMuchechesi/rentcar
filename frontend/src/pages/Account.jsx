import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { COUNTRIES } from '../lib/countries';
import { shortDate } from '../api';
import { useAuth } from '../context/AuthContext';

export default function Account() {
  const { user, updateProfile, isManager } = useAuth();
  const [profile, setProfile] = useState({ name: '', phone: '', country: '', drivingLicenceNumber: '', drivingLicenceCountry: '' });
  const [emailForm, setEmailForm] = useState({ email: '', currentPassword: '' });
  const [passwordForm, setPasswordForm] = useState({ password: '', currentPassword: '' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!user) return;
    setProfile({
      name: user.name || '',
      phone: user.phone || '',
      country: user.country || '',
      drivingLicenceNumber: user.drivingLicenceNumber || '',
      drivingLicenceCountry: user.drivingLicenceCountry || '',
    });
    setEmailForm((f) => ({ ...f, email: user.email }));
  }, [user]);

  const set = (key) => (event) => setProfile((p) => ({ ...p, [key]: event.target.value }));

  async function submit(section, payload, message) {
    setBusy(section);
    setError('');
    setNotice('');
    try {
      await updateProfile(payload);
      setNotice(message);
      if (section === 'password') setPasswordForm({ password: '', currentPassword: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  if (!user) return null;

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Your account</h1>
          <p className="muted">
            {user.email} · {isManager ? 'branch manager' : 'renter'} since {shortDate(user.createdAt)}
          </p>
        </div>
        <Link className="btn" to={isManager ? '/admin' : '/dashboard'}>
          {isManager ? 'Back office' : 'My rentals'}
        </Link>
      </header>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="alert">{error}</p>}

      <form className="card stack" onSubmit={(e) => { e.preventDefault(); submit('profile', profile, 'Details saved.'); }}>
        <h3>Profile and driving licence</h3>
        <p className="muted small">
          The branch needs a licence they can verify, so tell them which country issued it.
        </p>
        <div className="grid-4">
          <label>
            Full name
            <input value={profile.name} onChange={set('name')} required minLength={2} />
          </label>
          <label>
            Phone (international)
            <input value={profile.phone} onChange={set('phone')} placeholder="+1 415 555 0100" />
          </label>
          <label>
            Your country
            <select value={profile.country} onChange={set('country')}>
              <option value="">Not set</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Licence number
            <input value={profile.drivingLicenceNumber} onChange={set('drivingLicenceNumber')} maxLength={40} />
          </label>
          <label>
            Licence issued in
            <select value={profile.drivingLicenceCountry} onChange={set('drivingLicenceCountry')}>
              <option value="">Not set</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button className="btn primary" disabled={busy === 'profile'}>
          {busy === 'profile' ? 'Saving…' : 'Save details'}
        </button>
      </form>

      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          submit('email', { email: emailForm.email, currentPassword: emailForm.currentPassword }, 'Sign-in email updated.');
        }}
      >
        <h3>Sign-in email</h3>
        <p className="muted small">Changing it needs your current password, and every later sign-in uses the new address.</p>
        <div className="grid-2">
          <label>
            Email
            <input type="email" value={emailForm.email} onChange={(e) => setEmailForm((f) => ({ ...f, email: e.target.value }))} required />
          </label>
          <label>
            Current password
            <input
              type="password"
              value={emailForm.currentPassword}
              onChange={(e) => setEmailForm((f) => ({ ...f, currentPassword: e.target.value }))}
              required
              placeholder="Needed to change the email"
            />
          </label>
        </div>
        <button className="btn primary" disabled={busy === 'email'}>
          {busy === 'email' ? 'Working…' : 'Change email'}
        </button>
      </form>

      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          submit('password', { password: passwordForm.password, currentPassword: passwordForm.currentPassword }, 'Password changed — use it next time you sign in.');
        }}
      >
        <h3>Password</h3>
        <div className="grid-2">
          <label>
            New password
            <input
              type="password"
              value={passwordForm.password}
              onChange={(e) => setPasswordForm((f) => ({ ...f, password: e.target.value }))}
              required
              minLength={8}
            />
          </label>
          <label>
            Current password
            <input
              type="password"
              value={passwordForm.currentPassword}
              onChange={(e) => setPasswordForm((f) => ({ ...f, currentPassword: e.target.value }))}
              required
            />
          </label>
        </div>
        <button className="btn primary" disabled={busy === 'password'}>
          {busy === 'password' ? 'Working…' : 'Set new password'}
        </button>
        <p className="muted small">
          Only a manager can change someone&apos;s role or open accounts for other people — that lives in the Accounts
          screen.
        </p>
      </form>
    </div>
  );
}
