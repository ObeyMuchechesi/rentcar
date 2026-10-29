import { useCallback, useEffect, useState } from 'react';
import StatusBadge from '../../components/StatusBadge';
import { api, money } from '../../api';
import { COUNTRIES, COUNTRY_CURRENCY, CURRENCIES, countryName } from '../../lib/countries';

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
  currency: 'USD',
  location: '',
  country: '',
  mileageLimitKm: 400,
  status: 'available',
  imageUrl: '',
  features: '',
};

const CLASSES = ['economy', 'sedan', 'suv', 'van', 'pickup', 'luxury', 'sports'];

export default function Fleet() {
  const [vehicles, setVehicles] = useState([]);
  const [branches, setBranches] = useState([]);
  const [countryFilter, setCountryFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const params = new URLSearchParams({ sort: 'newest', limit: '200', status: 'all' });
    if (countryFilter) params.set('country', countryFilter);
    if (locationFilter) params.set('location', locationFilter);
    try {
      // The token is what tells the API to include retired stock, so it stays editable here.
      const data = await api(`/vehicles?${params.toString()}`);
      setVehicles(data.vehicles);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [countryFilter, locationFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The country list comes from the branches themselves, so it does not shrink when filtered.
  useEffect(() => {
    api('/vehicles/locations', { auth: false })
      .then((d) => setBranches(d.locations))
      .catch(() => setBranches([]));
  }, []);

  const set = (key) => (event) => {
    const value = event.target.type === 'number' ? Number(event.target.value) : event.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  // Picking a country pre-fills that market's currency; it stays editable because
  // dollar-denominated rentals are normal in several countries.
  function setCountry(event) {
    const country = event.target.value;
    setForm((f) => ({ ...f, country, currency: COUNTRY_CURRENCY[country] || f.currency }));
  }

  function startEdit(vehicle) {
    setEditingId(vehicle.id);
    setForm({
      ...EMPTY,
      ...vehicle,
      imageUrl: vehicle.imageUrl || '',
      features: (vehicle.features || []).join(', '),
    });
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

  const countries = [...new Set(branches.map((b) => b.country))].sort();
  const branchOptions = branches.filter((b) => !countryFilter || b.country === countryFilter);

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
            Daily rate, {form.currency}
            <input type="number" value={form.dailyRate} onChange={set('dailyRate')} min={1} step="1" required />
          </label>
          <label>
            Deposit, {form.currency}
            <input type="number" value={form.deposit} onChange={set('deposit')} min={0} step="1" required />
          </label>
          <label>
            Branch
            <input value={form.location} onChange={set('location')} required placeholder="Cape Town International" />
          </label>
          <label>
            Country
            <select value={form.country} onChange={setCountry} required>
              <option value="">Choose a country</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Currency
            <select value={form.currency} onChange={set('currency')} required>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mileage / day
            <input type="number" value={form.mileageLimitKm} onChange={set('mileageLimitKm')} min={0} required />
          </label>
          <label className="span-2">
            Photo URL (optional)
            <input
              value={form.imageUrl}
              onChange={set('imageUrl')}
              placeholder="https://…/vehicle.jpg"
              maxLength={300}
            />
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

      <div className="card filters inline-filters">
        <label>
          Country
          <select value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}>
            <option value="">All countries</option>
            {countries.map((code) => (
              <option key={code} value={code}>
                {countryName(code)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Branch
          <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
            <option value="">All branches</option>
            {branchOptions.map((b) => (
              <option key={`${b.country}-${b.location}`} value={b.location}>
                {b.location} · {countryName(b.country)}
              </option>
            ))}
          </select>
        </label>
        {(countryFilter || locationFilter) && (
          <button
            className="btn ghost"
            onClick={() => {
              setCountryFilter('');
              setLocationFilter('');
            }}
          >
            Clear
          </button>
        )}
        <p className="result-count">
          {vehicles.length} vehicle{vehicles.length === 1 ? '' : 's'}
          {countryFilter ? ` in ${countryName(countryFilter)}` : ''}
        </p>
      </div>

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
              <td>
                {v.location}
                <div className="muted small">{countryName(v.country)}</div>
              </td>
              <td>
                {money(v.dailyRate, v.currency)}
                <div className="muted small">deposit {money(v.deposit, v.currency)}</div>
              </td>
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
