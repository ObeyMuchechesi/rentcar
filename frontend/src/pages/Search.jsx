import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import VehicleCard from '../components/VehicleCard';
import { api, addDaysIso, todayIso } from '../api';
import { COUNTRIES } from '../lib/countries';

const CLASSES = ['economy', 'sedan', 'suv', 'van', 'pickup', 'luxury', 'sports'];

export default function Search() {
  const [params, setParams] = useSearchParams();
  const [branches, setBranches] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [state, setState] = useState({ loading: true, error: '' });

  const query = {
    country: params.get('country') || '',
    location: params.get('location') || '',
    vehicleClass: params.get('vehicleClass') || '',
    startDate: params.get('startDate') || '',
    endDate: params.get('endDate') || '',
    sort: params.get('sort') || 'price_asc',
  };

  useEffect(() => {
    api('/vehicles/locations', { auth: false })
      .then((d) => setBranches(d.locations))
      .catch(() => setBranches([]));
  }, []);

  useEffect(() => {
    const search = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => value && search.set(key, value));

    setState((s) => ({ ...s, loading: true, error: '' }));
    api(`/vehicles?${search.toString()}`, { auth: false })
      .then((d) => setVehicles(d.vehicles))
      .catch((err) => setState({ loading: false, error: err.message }))
      .finally(() => setState((s) => ({ ...s, loading: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);

  function update(patch) {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    // A branch only exists inside one country, so changing the country clears the pick.
    if ('country' in patch && patch.country !== query.country) next.delete('location');
    setParams(next);
  }

  const dateSearch = Boolean(query.startDate && query.endDate);
  const countries = [...new Set(branches.map((b) => b.country))].sort();
  const branchOptions = branches.filter((b) => !query.country || b.country === query.country);
  // Countries nobody can rent in yet stay out of the picker.
  const countryChoices = COUNTRIES.filter((c) => countries.includes(c.code));

  return (
    <div>
      <section className="hero">
        <h1>Book the right car for the trip</h1>
        <p className="muted">
          {branches.length} branches across {countries.length} countries — every price is quoted in the money that branch
          takes, so what you see is what you pay at the counter.
        </p>
      </section>

      <section className="card filters">
        <div className="grid-4">
          <label>
            Pick-up from
            <input
              type="date"
              value={query.startDate}
              min={todayIso()}
              onChange={(e) => {
                const startDate = e.target.value;
                const next = { startDate };
                if (startDate && (!query.endDate || query.endDate <= startDate)) {
                  const d = new Date(`${startDate}T00:00:00.000Z`);
                  d.setUTCDate(d.getUTCDate() + 1);
                  next.endDate = d.toISOString().slice(0, 10);
                }
                update(next);
              }}
            />
          </label>
          <label>
            Return by
            <input
              type="date"
              value={query.endDate}
              min={query.startDate || todayIso()}
              onChange={(e) => update({ endDate: e.target.value })}
            />
          </label>
          <label>
            Country
            <select value={query.country} onChange={(e) => update({ country: e.target.value })}>
              <option value="">Every country</option>
              {countryChoices.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Branch
            <select value={query.location} onChange={(e) => update({ location: e.target.value })}>
              <option value="">All branches</option>
              {branchOptions.map((b) => (
                <option key={`${b.country}-${b.location}`} value={b.location}>
                  {b.location} ({b.country}) · {b.vehicles} cars
                </option>
              ))}
            </select>
          </label>
          <label>
            Vehicle class
            <select value={query.vehicleClass} onChange={(e) => update({ vehicleClass: e.target.value })}>
              <option value="">Any class</option>
              {CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="filter-foot">
          <label className="inline">
            Sort
            <select value={query.sort} onChange={(e) => update({ sort: e.target.value })}>
              <option value="price_asc">Cheapest first in each currency</option>
              <option value="price_desc">Most expensive first</option>
              <option value="newest">Newest arrivals</option>
            </select>
          </label>
          {(dateSearch || query.location || query.vehicleClass || query.country) && (
            <button className="btn ghost" onClick={() => setParams({})}>
              Clear filters
            </button>
          )}
        </div>
      </section>

      {state.error && <p className="alert">{state.error}</p>}
      {state.loading ? (
        <p className="muted">Loading fleet…</p>
      ) : vehicles.length === 0 ? (
        <p className="empty">No vehicles match. Try widening the dates or picking another branch.</p>
      ) : (
        <>
          <p className="result-count">
            {vehicles.length} vehicle{vehicles.length === 1 ? '' : 's'}
            {dateSearch && ' available in your window'}
          </p>
          <div className="grid-cards">
            {vehicles.map((v) => (
              <VehicleCard
                key={v.id}
                vehicle={v}
                to={`/vehicles/${v.id}${query.startDate && query.endDate ? `?startDate=${query.startDate}&endDate=${query.endDate}` : ''}`}
              />
            ))}
          </div>
        </>
      )}

      <section className="card demo">
        <h4>How booking works here</h4>
        <p className="small muted">
          You pick the dates and accept the quote, the branch approves the rental, and the car is yours once both
          signatures are on it. Either side can still say no before the keys change hands — and a signed request is
          only ever priced in the branch&apos;s own currency ({[...new Set(vehicles.map((v) => v.currency))].join(', ') || 'multiple'}).
        </p>
      </section>
    </div>
  );
}
