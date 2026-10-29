import { useEffect, useState } from 'react';
import { api, shortDate } from '../../api';

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    try {
      const data = await api('/auth/customers');
      setCustomers(data.customers);
    } catch (err) {
      setError(err.message);
    }
  }

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await api('/auth/customers', { method: 'POST', body: form });
      setNotice(`Account created for ${form.name}.`);
      setForm({ name: '', email: '', phone: '', password: '' });
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h1>Customers</h1>
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="alert">{error}</p>}

      <form className="card stack" onSubmit={submit}>
        <h3>Add a walk-in customer</h3>
        <div className="grid-4">
          <label>
            Name
            <input value={form.name} onChange={set('name')} required minLength={2} />
          </label>
          <label>
            Email
            <input type="email" value={form.email} onChange={set('email')} required />
          </label>
          <label>
            Phone
            <input value={form.phone} onChange={set('phone')} />
          </label>
          <label>
            Initial password
            <input value={form.password} onChange={set('password')} required minLength={8} />
          </label>
        </div>
        <button className="btn primary">Create account</button>
      </form>

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Licence</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.email}</td>
              <td>{c.phone || '—'}</td>
              <td>{c.drivingLicenceNumber || '—'}</td>
              <td>{shortDate(c.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
