import { useCallback, useEffect, useState } from 'react';
import StatusBadge from '../../components/StatusBadge';
import { api, money, shortDate } from '../../api';

const NEXT = {
  pending: ['confirmed', 'cancelled', 'no_show'],
  confirmed: ['picked_up', 'cancelled', 'no_show'],
  picked_up: ['returned'],
  returned: [],
  cancelled: [],
  no_show: [],
};

const FILTERS = ['all', 'pending', 'confirmed', 'picked_up', 'returned', 'cancelled', 'no_show'];

export default function Bookings() {
  const [bookings, setBookings] = useState([]);
  const [status, setStatus] = useState('all');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const search = new URLSearchParams({ status, limit: '200' });
    if (code) search.set('code', code);
    try {
      const data = await api(`/bookings/all?${search.toString()}`);
      setBookings(data.bookings);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [status, code]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function move(booking, next) {
    if (next === 'cancelled' && !window.confirm(`Cancel ${booking.code}?`)) return;
    try {
      await api(`/bookings/${booking.id}/status`, { method: 'PATCH', body: { status: next } });
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h1>Bookings</h1>
      {error && <p className="alert">{error}</p>}

      <div className="card filters inline-filters">
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reference
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="RC-" />
        </label>
        {(status !== 'all' || code) && (
          <button
            className="btn ghost"
            onClick={() => {
              setStatus('all');
              setCode('');
            }}
          >
            Clear
          </button>
        )}
      </div>

      {bookings.length === 0 ? (
        <p className="empty">No bookings match this filter.</p>
      ) : (
        <div className="list">
          {bookings.map((b) => (
            <article key={b.id} className="card booking admin">
              <header>
                <div>
                  <h3>
                    {b.code} · {b.vehicle ? `${b.vehicle.make} ${b.vehicle.model}` : 'vehicle removed'}
                  </h3>
                  <p className="muted small">
                    {shortDate(b.pickUpDate)} → {shortDate(b.returnDate)} ({b.days} days) ·{' '}
                    {money(b.rentalTotal, b.currency)}
                  </p>
                  <p className="small">
                    {b.customer?.name} ({b.customer?.email}) · {b.pickUpLocation} → {b.returnLocation}
                  </p>
                </div>
                <StatusBadge status={b.status} />
              </header>
              <div className="actions">
                {NEXT[b.status].map((next) => (
                  <button
                    key={next}
                    className={`btn small${next === 'cancelled' || next === 'no_show' ? ' ghost danger' : ''}`}
                    onClick={() => move(b, next)}
                  >
                    {next === 'picked_up' ? 'Mark collected' : next === 'returned' ? 'Mark returned' : next}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
