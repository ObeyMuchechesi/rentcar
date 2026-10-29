import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import VehicleCard from '../components/VehicleCard';
import { api, addDaysIso, todayIso } from '../api';

const CLASSES = ['economy', 'sedan', 'suv', 'van', 'pickup', 'luxury', 'sports'];

export default function Search() {
  const [params, setParams] = useSearchParams();
  const [locations, setLocations] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [state, setState] = useState({ loading: true, error: '' });

  const query = {
    location: params.get('location') || '',
    vehicleClass: params.get('vehicleClass') || '',
    startDate: params.get('startDate') || '',
    endDate: params.get('endDate') || '',
    sort: params.get('sort') || 'price_asc',
  };

  useEffect(() => {
    api('/vehicles/locations').then((d) => setLocations(d.locations)).catch(() => setLocations([]));
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
    setParams(next);
  }

  const dateSearch = Boolean(query.startDate && query.endDate);

  return (
    <div>
      <section className="hero">
        <h1>Book the right car for the trip</h1>
        <p className="muted">Pick your dates first — the list hides anything already on rent for that window.</p>
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
                  next.endDate = addDaysIso(0);
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
            Location
            <select value={query.location} onChange={(e) => update({ location: e.target.value })}>
              <option value="">All locations</option>
              {locations.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
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
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
              <option value="newest">Newest arrivals</option>
            </select>
          </label>
          {(dateSearch || query.location || query.vehicleClass) && (
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
        <p className="empty">No vehicles match. Try widening the dates or picking another location.</p>
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
        <h4>Seeded demo logins</h4>
        <p className="small">
          Customer <code>driver@rental.test</code> / <code>Driver123!</code> · Manager <code>manager@rental.test</code>{' '}
          / <code>Manager123!</code>
        </p>
      </section>
    </div>
  );
}
