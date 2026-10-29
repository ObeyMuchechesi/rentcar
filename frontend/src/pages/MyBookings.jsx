import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import StatusBadge from '../components/StatusBadge';
import { api, money, shortDate } from '../api';

export default function MyBookings() {
  const [bookings, setBookings] = useState([]);
  const [state, setState] = useState({ loading: true, error: '' });
  const [notice, setNotice] = useState('');
  const location = useLocation();

  useEffect(() => {
    if (location.state?.justBooked) {
      setNotice(`Booking ${location.state.justBooked} created. The branch will confirm collection details.`);
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await api('/bookings/mine');
      setBookings(data.bookings);
      setState({ loading: false, error: '' });
    } catch (err) {
      setState({ loading: false, error: err.message });
    }
  }

  async function cancel(booking) {
    if (!window.confirm(`Cancel ${booking.code}?`)) return;
    try {
      await api(`/bookings/${booking.id}/cancel`, { method: 'POST' });
      setNotice(`${booking.code} cancelled — those dates are free again.`);
      await refresh();
    } catch (err) {
      setState({ loading: false, error: err.message });
    }
  }

  return (
    <div>
      <h1>My bookings</h1>
      {notice && <p className="notice">{notice}</p>}
      {state.error && <p className="alert">{state.error}</p>}
      {state.loading ? (
        <p className="muted">Loading…</p>
      ) : bookings.length === 0 ? (
        <p className="empty">
          Nothing booked yet. <Link to="/">Find a car</Link>.
        </p>
      ) : (
        <div className="list">
          {bookings.map((b) => (
            <article key={b.id} className="card booking">
              <header>
                <div>
                  <h3>
                    {b.vehicle ? `${b.vehicle.year} ${b.vehicle.make} ${b.vehicle.model}` : 'Vehicle removed'}
                  </h3>
                  <p className="muted small">
                    {b.code} · {shortDate(b.pickUpDate)} → {shortDate(b.returnDate)} ({b.days} day
                    {b.days === 1 ? '' : 's'})
                  </p>
                  <p className="small">
                    {b.pickUpLocation} → {b.returnLocation}
                  </p>
                </div>
                <StatusBadge status={b.status} />
              </header>

              <div className="booking-foot">
                <p>
                  <strong>{money(b.rentalTotal, b.currency)}</strong>
                  <span className="muted small"> + {money(b.deposit, b.currency)} deposit</span>
                </p>
                {['pending', 'confirmed'].includes(b.status) && (
                  <button className="btn ghost danger" onClick={() => cancel(b)}>
                    Cancel
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
