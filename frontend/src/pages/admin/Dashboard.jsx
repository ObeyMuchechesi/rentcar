import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import StatusBadge from '../../components/StatusBadge';
import { api, money, shortDate } from '../../api';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [months, setMonths] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api('/stats/overview'), api('/stats/revenue')])
      .then(([overview, revenue]) => {
        setData(overview);
        setMonths(revenue.months);
      })
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="alert">{error}</p>;
  if (!data) return <p className="muted">Loading dashboard…</p>;

  const { stats } = data;
  const cards = [
    { label: 'Vehicles in fleet', value: stats.vehiclesTotal, hint: `${stats.fleet?.available || 0} available` },
    { label: 'Active bookings', value: stats.activeBookings, hint: `${stats.bookings?.confirmed || 0} confirmed` },
    { label: 'Customers', value: stats.customers, hint: 'registered accounts' },
    { label: 'Revenue this month', value: money(stats.revenueThisMonth), hint: `${money(stats.revenueAllTime)} all time` },
  ];

  const peak = Math.max(...months.map((m) => m.revenue), 1);

  return (
    <div>
      <h1>Operations dashboard</h1>
      <div className="stat-grid">
        {cards.map((c) => (
          <div className="card stat" key={c.label}>
            <span className="stat-label">{c.label}</span>
            <strong>{c.value}</strong>
            <span className="muted small">{c.hint}</span>
          </div>
        ))}
      </div>

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
                    <td>{b.vehicle ? `${b.vehicle.make} ${b.vehicle.model}` : '—'}</td>
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
          {months.length === 0 ? (
            <p className="empty">No bookings yet.</p>
          ) : (
            <ul className="bars">
              {months.map((m) => (
                <li key={m.month}>
                  <span className="bar-label">{m.month}</span>
                  <span className="bar-track">
                    <span className="bar-fill" style={{ width: `${(m.revenue / peak) * 100}%` }} />
                  </span>
                  <span className="bar-value">{money(m.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="quick-links">
        <Link className="btn" to="/admin/fleet">
          Manage fleet
        </Link>{' '}
        <Link className="btn" to="/admin/bookings">
          Manage bookings
        </Link>
      </p>
    </div>
  );
}
