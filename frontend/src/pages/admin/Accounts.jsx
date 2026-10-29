import { useCallback, useEffect, useState } from 'react';
import { api, money, shortDate } from '../../api';
import { COUNTRIES, countryName } from '../../lib/countries';
import { useAuth } from '../../context/AuthContext';

const ROLES = [
  { value: 'all', label: 'Everyone' },
  { value: 'customer', label: 'Renters' },
  { value: 'manager', label: 'Staff' },
];

const EMPTY = {
  name: '',
  email: '',
  password: '',
  role: 'customer',
  phone: '',
  country: '',
  drivingLicenceNumber: '',
  drivingLicenceCountry: '',
};

// The desk the manager signs from: the fields a renter cannot set for themselves
// (role, active flag) live here and nowhere else.
function spendLine(spend) {
  if (!spend || !spend.length) return '—';
  return spend.map(({ currency, amount }) => money(amount, currency)).join(' + ');
}

export default function Accounts() {
  const { user: me } = useAuth();
  const [role, setRole] = useState('all');
  const [search, setSearch] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const params = new URLSearchParams({ role });
    if (search) params.set('search', search);
    try {
      const data = await api(`/auth/accounts?${params.toString()}`);
      setAccounts(data.accounts);
    } catch (err) {
      setError(err.message);
    }
  }, [role, search]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  function startEdit(account) {
    setEditingId(account.id);
    setForm({
      name: account.name || '',
      email: account.email || '',
      password: '',
      role: account.role,
      phone: account.phone || '',
      country: account.country || '',
      drivingLicenceNumber: account.drivingLicenceNumber || '',
      drivingLicenceCountry: account.drivingLicenceCountry || '',
    });
    setError('');
    setNotice('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function reset() {
    setEditingId(null);
    setForm(EMPTY);
    setError('');
    setNotice('');
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    // Blank fields are dropped rather than sent: an empty password on an edit means
    // "leave the sign-in alone", not "set it to nothing".
    const body = Object.fromEntries(Object.entries(form).filter(([, value]) => value !== ''));
    try {
      if (editingId) {
        await api(`/auth/accounts/${editingId}`, { method: 'PATCH', body });
        setNotice(`${body.name} updated.`);
      } else {
        await api('/auth/accounts', { method: 'POST', body });
        setNotice(`${body.name} can now sign in as ${body.role === 'manager' ? 'staff' : 'a renter'}.`);
      }
      reset();
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function patch(account, changes, message) {
    setError('');
    setNotice('');
    setBusy(account.id);
    try {
      await api(`/auth/accounts/${account.id}`, { method: 'PATCH', body: changes });
      setNotice(message);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  function deactivate(account) {
    return patch(
      account,
      { active: false },
      `${account.name} can no longer sign in. Their bookings and rental history are untouched.`
    );
  }

  function reactivate(account) {
    return patch(account, { active: true }, `${account.name} can sign in again.`);
  }

  function setRoleFor(account, next) {
    const label = next === 'manager' ? 'staff' : 'a renter';
    return patch(account, { role: next }, `${account.name} now signs in as ${label}.`);
  }

  async function remove(account) {
    if (!window.confirm(`Delete ${account.name} (${account.email}) for good?`)) return;
    setError('');
    setNotice('');
    try {
      await api(`/auth/accounts/${account.id}`, { method: 'DELETE' });
      setNotice(`${account.name} was deleted.`);
      await refresh();
    } catch (err) {
      // The API refuses to delete anyone with a rental history — that is the point.
      setError(err.message);
    }
  }

  return (
    <div>
      <h1>Accounts</h1>
      <p className="muted">
        Create staff sign-ins here. Renters open their own accounts from the site; you can edit, suspend or delete them.
      </p>
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="alert">{error}</p>}

      <form className="card fleet-form stack" onSubmit={submit}>
        <h3>{editingId ? 'Edit account' : 'Create an account'}</h3>
        <div className="grid-4">
          <label>
            Full name
            <input value={form.name} onChange={set('name')} required minLength={2} maxLength={80} />
          </label>
          <label>
            Email
            <input type="email" value={form.email} onChange={set('email')} required />
          </label>
          <label>
            {editingId ? 'New password (optional)' : 'Password'}
            <input
              type="password"
              value={form.password}
              onChange={set('password')}
              minLength={8}
              required={!editingId}
              placeholder={editingId ? 'Leave blank to keep it' : 'At least 8 characters'}
            />
          </label>
          <label>
            Role
            <select value={form.role} onChange={set('role')}>
              <option value="customer">Renter</option>
              <option value="manager">Staff (full back office)</option>
            </select>
          </label>
          <label>
            Phone
            <input value={form.phone} onChange={set('phone')} placeholder="+1 415 555 0100" />
          </label>
          <label>
            Country
            <select value={form.country} onChange={set('country')}>
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
            <input value={form.drivingLicenceNumber} onChange={set('drivingLicenceNumber')} maxLength={40} />
          </label>
          <label>
            Licence country
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
        <div className="row">
          <button className="btn primary" disabled={busy}>
            {editingId ? 'Save changes' : 'Create account'}
          </button>
          {editingId && (
            <button type="button" className="btn ghost" onClick={reset}>
              Cancel edit
            </button>
          )}
        </div>
      </form>

      <div className="card filters inline-filters">
        <label>
          Show
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="name or email" />
        </label>
        <p className="result-count">{accounts.length} account{accounts.length === 1 ? '' : 's'}</p>
      </div>

      {accounts.length === 0 ? (
        <p className="empty">No accounts match this filter.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Contact</th>
              <th>Licence</th>
              <th>Bookings</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>
                  <strong>{a.name}</strong>
                  <div className="muted small">
                    {a.email} · {a.role === 'manager' ? 'staff' : 'renter'}
                    {!a.active && ' · suspended'}
                    {me && a.id === me.id && ' · you'}
                  </div>
                  <div className="muted small">joined {shortDate(a.createdAt)}</div>
                </td>
                <td>
                  {a.phone || '—'}
                  <div className="muted small">{countryName(a.country) || '—'}</div>
                </td>
                <td className="small">
                  {a.drivingLicenceNumber || '—'}
                  <div className="muted small">{countryName(a.drivingLicenceCountry) || ''}</div>
                </td>
                <td className="small">
                  {a.stats.bookings} ({a.stats.active} live)
                  <div className="muted small">{spendLine(a.stats.spend)}</div>
                </td>
                <td className="actions">
                  <button className="btn small" onClick={() => startEdit(a)}>
                    Edit
                  </button>
                  {a.active ? (
                    <button
                      className="btn small ghost danger"
                      disabled={busy === a.id || (me && a.id === me.id)}
                      onClick={() => deactivate(a)}
                      title={me && a.id === me.id ? 'You cannot suspend your own account' : 'Suspend sign-in'}
                    >
                      Suspend
                    </button>
                  ) : (
                    <button className="btn small" disabled={busy === a.id} onClick={() => reactivate(a)}>
                      Reinstate
                    </button>
                  )}
                  <button
                    className="btn small ghost"
                    disabled={busy === a.id}
                    onClick={() => setRoleFor(a, a.role === 'manager' ? 'customer' : 'manager')}
                    title={a.role === 'manager' ? 'Demote to renter' : 'Give back-office access'}
                  >
                    {a.role === 'manager' ? 'Demote' : 'Promote'}
                  </button>
                  <button className="btn small ghost danger" disabled={busy === a.id} onClick={() => remove(a)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="muted small">
        An account with bookings on file cannot be deleted — suspend it instead so the rental history stays intact. The
        last active staff account cannot be demoted, suspended or removed.
      </p>
    </div>
  );
}
