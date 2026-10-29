import { useEffect, useState } from 'react';
import StatusBadge from '../../components/StatusBadge';
import { api, money } from '../../api';

const EMPTY = {
  make: '',
  model: '',
  year: new Date().getFullYear(),
  licensePlate: '',
  vehicleClass: 'economy',
  transmission: 'manual',
  fuel: 'petrol',
  seats: 5,
  luggage: 2,
  dailyRate: 50,
  deposit: 200,
  location: '',
  mileageLimitKm: 400,
  status: 'available',
  features: '',
};

const CLASSES = ['economy', 'sedan', 'suv', 'van', 'pickup', 'luxury', 'sports'];

export default function Fleet() {
  const [vehicles, setVehicles] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    try {
      const data = await api('/vehicles?sort=newest&limit=200', { auth: false });
      setVehicles(data.vehicles);
    } catch (err) {
      setError(err.message);
    }
  }

  const set = (key) => (event) => {
    const value = event.target.type === 'number' ? Number(event.target.value) : event.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  function startEdit(vehicle) {
    setEditingId(vehicle.id);
    setForm({ ...EMPTY, ...vehicle, features: (vehicle.features || []).join(', ') });
    setError('');
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
    const payload = {
      ...form,
      features: form.features
        ? String(form.features)
            .split(',')
            .map((f) => f.trim())
            .filter(Boolean)
        : [],
    };
    try {
      if (editingId) {
        await api(`/vehicles/${editingId}`, { method: 'PATCH', body: payload });
        reset();
        setNotice('Vehicle updated.');
      } else {
        await api('/vehicles', { method: 'POST', body: payload });
        reset();
        setNotice('Vehicle added to the fleet.');
      }
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(vehicle) {
    if (!window.confirm(`Remove ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.licensePlate})?`)) return;
    try {
      await api(`/vehicles/${vehicle.id}`, { method: 'DELETE' });
      setNotice('Vehicle removed.');
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h1>Fleet</h1>
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="alert">{error}</p>}

      <form className="card fleet-form stack" onSubmit={submit}>
        <h3>{editingId ? 'Edit vehicle' : 'Add a vehicle'}</h3>
        <div className="grid-4">
          <label>
            Make
            <input value={form.make} onChange={set('make')} required />
          </label>
          <label>
            Model
            <input value={form.model} onChange={set('model')} required />
          </label>
          <label>
            Year
            <input type="number" value={form.year} onChange={set('year')} min={1990} max={2100} required />
          </label>
          <label>
            Number plate
            <input value={form.licensePlate} onChange={set('licensePlate')} required />
          </label>
          <label>
            Class
            <select value={form.vehicleClass} onChange={set('vehicleClass')}>
              {CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            Transmission
            <select value={form.transmission} onChange={set('transmission')}>
              <option value="manual">manual</option>
              <option value="automatic">automatic</option>
            </select>
          </label>
          <label>
            Fuel
            <select value={form.fuel} onChange={set('fuel')}>
              <option value="petrol">petrol</option>
              <option value="diesel">diesel</option>
              <option value="hybrid">hybrid</option>
              <option value="electric">electric</option>
            </select>
          </label>
          <label>
            Status
            <select value={form.status} onChange={set('status')}>
              <option value="available">available</option>
              <option value="maintenance">maintenance</option>
              <option value="retired">retired</option>
            </select>
          </label>
          <label>
            Seats
            <input type="number" value={form.seats} onChange={set('seats')} min={2} max={12} required />
          </label>
          <label>
            Luggage
            <input type="number" value={form.luggage} onChange={set('luggage')} min={0} max={12} required />
          </label>
          <label>
            Daily rate
            <input type="number" value={form.dailyRate} onChange={set('dailyRate')} min={1} step="1" required />
          </label>
          <label>
            Deposit
            <input type="number" value={form.deposit} onChange={set('deposit')} min={0} step="1" required />
          </label>
          <label>
            Branch
            <input value={form.location} onChange={set('location')} required placeholder="Cape Town International" />
          </label>
          <label>
            Mileage / day
            <input type="number" value={form.mileageLimitKm} onChange={set('mileageLimitKm')} min={0} required />
          </label>
          <label className="span-2">
            Features (comma separated)
            <input value={form.features} onChange={set('features')} placeholder="4x4, Roof rack" />
          </label>
        </div>
        <div className="row">
          <button className="btn primary">{editingId ? 'Save changes' : 'Add vehicle'}</button>
          {editingId && (
            <button type="button" className="btn ghost" onClick={reset}>
              Cancel edit
            </button>
          )}
        </div>
      </form>

      <table className="table">
        <thead>
          <tr>
            <th>Vehicle</th>
            <th>Plate</th>
            <th>Branch</th>
            <th>Rate</th>
            <th>Status</th>
            <th aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {vehicles.map((v) => (
            <tr key={v.id}>
              <td>
                {v.year} {v.make} {v.model}
                <div className="muted small">
                  {v.vehicleClass} · {v.transmission} · {v.fuel}
                </div>
              </td>
              <td>{v.licensePlate}</td>
              <td>{v.location}</td>
              <td>{money(v.dailyRate)}</td>
              <td>
                <StatusBadge status={v.status} />
              </td>
              <td className="actions">
                <button className="btn small" onClick={() => startEdit(v)}>
                  Edit
                </button>
                <button className="btn small ghost danger" onClick={() => remove(v)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
