import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import StatusBadge from '../components/StatusBadge';
import { api, money, shortDate } from '../api';
import { countryName } from '../lib/countries';
import { useAuth } from '../context/AuthContext';
import { decidable, decide, priceLine, spendByCurrency, standing, vehicleName, windowLine } from '../lib/bookings';

const GROUPS = [
  { key: 'todo', title: 'Needs your answer', hint: 'The branch set this up for you — accept it and the rental is live.', pick: (b) => b.status === 'pending' && !b.customerAccepted },
  { key: 'current', title: 'Your rentals', hint: 'Approved or waiting on the branch.', pick: (b) => ['pending', 'confirmed', 'picked_up'].includes(b.status) && b.customerAccepted },
  { key: 'history', title: 'Past and closed', hint: '', pick: (b) => ['returned', 'cancelled', 'no_show', 'declined'].includes(b.status) },
];

export default function Dashboard() {
  const { user } = useAuth();
  const location = useLocation();
  const [bookings, setBookings] = useState([]);
  const [state, setState] = useState({ loading: true, error: '' });
  const [notice, setNotice] = useState(location.state?.justBooked ? `${location.state.justBooked} sent to the branch for approval.` : '');
  const [busyId, setBusyId] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api('/bookings/mine');
      setBookings(data.bookings);
      setState({ loading: false, error: '' });
    } catch (err) {
      setState({ loading: false, error: err.message });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function act(booking, action) {
    if (action === 'decline' && !window.confirm(`Decline ${booking.code}? The dates go back on sale.`)) return;
    setBusyId(booking.id);
    try {
      await decide(booking.id, action);
      setNotice(
        action === 'accept'
          ? `${booking.code} accepted — you are confirmed for ${shortDate(booking.pickUpDate)}.`
          : `${booking.code} declined — nothing further is owed.`
      );
      await refresh();
    } catch (err) {
      setState({ loading: false, error: err.message });
    } finally {
      setBusyId(null);
    }
  }

  const spend = spendByCurrency(bookings);
  const headline = [
    { label: 'Open rentals', value: bookings.filter((b) => ['pending', 'confirmed', 'picked_up'].includes(b.status)).length },
    { label: 'Waiting on you', value: bookings.filter((b) => b.status === 'pending' && !b.customerAccepted).length },
    { label: 'Completed', value: bookings.filter((b) => b.status === 'returned').length },
    ...spend.map(([currency, amount]) => ({ label: `Rented for ${currency}`, value: money(amount, currency) })),
  ];

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Hi {user?.name?.split(' ')[0] || 'there'}</h1>
          <p className="muted">Everything you have asked the branches for, in one place.</p>
        </div>
        <Link className="btn primary" to="/">
          Find another car
        </Link>
      </header>

      {notice && <p className="notice">{notice}</p>}
      {state.error && <p className="alert">{state.error}</p>}
      {state.loading ? (
        <p className="muted">Loading your rentals…</p>
      ) : (
        <>
          <div className="stat-grid">
            {headline.map((item) => (
              <div className="card stat" key={item.label}>
                <span className="stat-label">{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>

          {bookings.length === 0 && (
            <p className="empty">
              You have not booked yet. <Link to="/">Search the fleet</Link> and accept a quote to get started.
            </p>
          )}

          {GROUPS.map((group) => {
            const rows = bookings.filter(group.pick);
            if (!rows.length) return null;
            return (
              <section key={group.key} className="block">
                <h2 className="block-title">
                  {group.title}
                  {group.hint && <span className="muted small"> {group.hint}</span>}
                </h2>
                <div className="list">
                  {rows.map((b) => (
                    <article key={b.id} className="card booking">
                      <header>
                        <div>
                          <h3>{vehicleName(b)}</h3>
                          <p className="muted small">
                            {b.code} · {windowLine(b)}
                          </p>
                          <p className="small">
                            {b.pickUpLocation}
                            {b.pickUpLocation !== b.returnLocation ? ` → ${b.returnLocation}` : ''} ·{' '}
                            {countryName(b.vehicle?.country)}
                          </p>
                          {standing(b) && <p className="standing">{standing(b)}</p>}
                        </div>
                        <StatusBadge status={b.status} />
                      </header>

                      <div className="booking-foot">
                        <p>
                          <strong>{priceLine(b)}</strong>
                        </p>
                        {decidable(b) && (
                          <div className="actions">
                            {!b.customerAccepted && (
                              <>
                                <button className="btn small primary" disabled={busyId === b.id} onClick={() => act(b, 'accept')}>
                                  {busyId === b.id ? 'Working…' : 'Accept quote'}
                                </button>
                                <button className="btn small ghost danger" disabled={busyId === b.id} onClick={() => act(b, 'decline')}>
                                  Decline
                                </button>
                              </>
                            )}
                            {b.customerAccepted && (
                              <button className="btn small ghost danger" disabled={busyId === b.id} onClick={() => act(b, 'decline')}>
                                Withdraw request
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}

          <p className="quick-links">
            <Link className="btn" to="/account">
              Account details
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
