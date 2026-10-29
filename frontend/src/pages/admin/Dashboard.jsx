import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import StatusBadge from '../../components/StatusBadge';
import { api, money, shortDate } from '../../api';
import { countryName } from '../../lib/countries';
import { decide, priceLine, vehicleName } from '../../lib/bookings';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [revenue, setRevenue] = useState([]);
  const [queue, setQueue] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [overview, currencies, awaiting] = await Promise.all([
        api('/stats/overview'),
        api('/stats/revenue'),
        api('/bookings/all?awaiting=manager&limit=20'),
      ]);
      setData(overview);
      setRevenue(currencies.currencies);
      setQueue(awaiting.bookings);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function rule(booking, action) {
    if (action === 'decline' && !window.confirm(`Decline ${booking.code} (${booking.customer?.name || 'customer'})?`)) return;
    setBusyId(booking.id);
    try {
      await decide(booking.id, action);
      setNotice(`${booking.code} ${action === 'accept' ? 'approved — the customer is confirmed.' : 'declined and the car is back on sale.'}`);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (error && !data) return <p className="alert">{error}</p>;
  if (!data) return <p className="muted">Loading dashboard…</p>;

  const { stats } = data;
  const moneyCards = stats.revenue.map((r) => ({
    label: `Revenue in ${r.currency}`,
    value: money(r.thisMonth, r.currency),
    hint: `${money(r.allTime, r.currency)} all time`,
  }));

  const cards = [
    { label: 'Vehicles in fleet', value: stats.vehiclesTotal, hint: `${stats.fleet?.available || 0} on forecourt, ${stats.fleet?.maintenance || 0} in workshop` },
    { label: 'Branches', value: stats.branches, hint: `${stats.countries} countries` },
    { label: 'Awaiting approval', value: stats.awaitingManager, hint: `${stats.awaitingCustomer} waiting on the renter` },
    { label: 'Active bookings', value: stats.activeBookings, hint: `${stats.bookings?.confirmed || 0} confirmed` },
    { label: 'Renters', value: stats.customers, hint: 'active accounts' },
    ...moneyCards,
  ];

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Operations</h1>
          <p className="muted">Money is never added across currencies — each branch reports in its own.</p>
        </div>
        <Link className="btn" to="/admin/bookings">
          Full ledger
        </Link>
      </header>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="alert">{error}</p>}

      <div className="stat-grid">
        {cards.map((c) => (
          <div className="card stat" key={c.label}>
            <span className="stat-label">{c.label}</span>
            <strong>{c.value}</strong>
            <span className="muted small">{c.hint}</span>
          </div>
        ))}
      </div>

      <section className="card block">
        <h3>Approval queue</h3>
        <p className="muted small">
          These requests already carry the renter&apos;s signature on the quote. Approving one confirms the rental;
          declining frees the car instantly.
        </p>
        {queue.length === 0 ? (
          <p className="empty">Nothing waiting on the branch.</p>
        ) : (
          <div className="list">
            {queue.map((b) => (
              <article key={b.id} className="card booking">
                <header>
                  <div>
                    <h3>
                      {b.code} · {vehicleName(b)}
                    </h3>
                    <p className="muted small">
                      {shortDate(b.pickUpDate)} → {shortDate(b.returnDate)} · {priceLine(b)}
                    </p>
                    <p className="small">
                      {b.customer?.name} ({b.customer?.email}) · {b.pickUpLocation},{' '}
                      {countryName(b.vehicle?.country)}
                      {b.notes ? ` · “${b.notes}”` : ''}
                    </p>
                  </div>
                  <StatusBadge status={b.status} />
                </header>
                <div className="actions">
                  <button className="btn small primary" disabled={busyId === b.id} onClick={() => rule(b, 'accept')}>
                    Approve
                  </button>
                  <button className="btn small ghost danger" disabled={busyId === b.id} onClick={() => rule(b, 'decline')}>
                    Decline
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="admin-grid">
        <section className="card">
          <h3>Next pick-ups</h3>
          {data.upcomingPickUps.length === 0 ? (
            <p className="empty">Nothing scheduled.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Vehicle</th>
                  <th>Customer</th>
                  <th>Pick-up</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.upcomingPickUps.map((b) => (
                  <tr key={b.id}>
                    <td>{b.code}</td>
                    <td>
                      {b.vehicle ? `${b.vehicle.make} ${b.vehicle.model}` : '—'}
                      <div className="muted small">{b.vehicle?.location}</div>
                    </td>
                    <td>{b.customer?.name}</td>
                    <td>{shortDate(b.pickUpDate)}</td>
                    <td>
                      <StatusBadge status={b.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <h3>Revenue by month</h3>
          {revenue.length === 0 ? (
            <p className="empty">No confirmed rentals yet.</p>
          ) : (
            revenue.map((block) => {
              const peak = Math.max(...block.months.map((m) => m.revenue), 1);
              return (
                <div key={block.currency} className="bars-block">
                  <h4 className="stat-label">{block.currency}</h4>
                  <ul className="bars">
                    {block.months.map((m) => (
                      <li key={`${block.currency}-${m.month}`}>
                        <span className="bar-label">{m.month}</span>
                        <span className="bar-track">
                          <span className="bar-fill" style={{ width: `${(m.revenue / peak) * 100}%` }} />
                        </span>
                        <span className="bar-value">{money(m.revenue, block.currency)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </section>
      </div>

      <p className="quick-links">
        <Link className="btn" to="/admin/fleet">
          Manage fleet
        </Link>{' '}
        <Link className="btn" to="/admin/accounts">
          Manage accounts
        </Link>
      </p>
    </div>
  );
}
