import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import StatusBadge from '../../components/StatusBadge';
import { api, money, shortDate, todayIso } from '../../api';
import { countryName } from '../../lib/countries';
import { NEXT, advance, decide, decidable, priceLine, standing, vehicleName, windowLine } from '../../lib/bookings';

const FILTERS = ['all', 'pending', 'confirmed', 'picked_up', 'returned', 'cancelled', 'no_show', 'declined'];
const QUEUES = [
  { value: '', label: 'Any renter' },
  { value: 'manager', label: 'Waiting on the branch' },
  { value: 'customer', label: 'Waiting on the renter' },
];

export default function Bookings() {
  const location = useLocation();
  const [bookings, setBookings] = useState([]);
  const [status, setStatus] = useState('all');
  const [awaiting, setAwaiting] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(
    location.state?.justBooked ? `${location.state.justBooked} added from the site — it is waiting on your approval.` : ''
  );
  const [busyId, setBusyId] = useState(null);

  // Walk-in desk: a manager takes the booking over the phone, the renter signs it later.
  const [desk, setDesk] = useState({ customerId: '', vehicleId: '', pickUpDate: '', returnDate: '', notes: '' });
  const [customers, setCustomers] = useState([]);
  const [cars, setCars] = useState([]);
  const [deskBusy, setDeskBusy] = useState(false);

  const refresh = useCallback(async () => {
    const search = new URLSearchParams({ status, limit: '200' });
    if (code) search.set('code', code);
    if (awaiting) search.set('awaiting', awaiting);
    try {
      const data = await api(`/bookings/all?${search.toString()}`);
      setBookings(data.bookings);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [status, code, awaiting]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    api('/auth/accounts?role=customer&limit=500')
      .then((d) => setCustomers(d.accounts.filter((a) => a.active)))
      .catch(() => setCustomers([]));
  }, []);

  useEffect(() => {
    if (!desk.pickUpDate || !desk.returnDate || desk.returnDate <= desk.pickUpDate) {
      setCars([]);
      return;
    }
    api(`/vehicles?startDate=${desk.pickUpDate}&endDate=${desk.returnDate}&limit=200`)
      .then((d) => setCars(d.vehicles))
      .catch(() => setCars([]));
  }, [desk.pickUpDate, desk.returnDate]);

  async function run(booking, work, message) {
    setBusyId(booking.id);
    setNotice('');
    try {
      await work();
      setNotice(message(booking));
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  function move(booking, next) {
    if (['cancelled', 'no_show', 'declined'].includes(next) && !window.confirm(`${next} · ${booking.code}?`)) return;
    return run(booking, () => advance(booking.id, next), (b) => `${b.code} moved to ${next}.`);
  }

  function rule(booking, action) {
    if (action === 'decline' && !window.confirm(`Decline ${booking.code}?`)) return;
    return run(
      booking,
      () => decide(booking.id, action),
      (b) => `${b.code} ${action === 'accept' ? 'approved' : 'declined'} — the renter sees it on their dashboard.`
    );
  }

  async function openWalkIn(event) {
    event.preventDefault();
    setDeskBusy(true);
    setError('');
    try {
      const data = await api('/bookings', { method: 'POST', body: { ...desk, vehicleId: desk.vehicleId } });
      setNotice(`${data.booking.code} created for ${data.booking.customer?.name || 'the renter'} — waiting on their signature.`);
      setDesk({ customerId: '', vehicleId: '', pickUpDate: '', returnDate: '', notes: '' });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeskBusy(false);
    }
  }

  const setDeskField = (key) => (event) => setDesk((d) => ({ ...d, [key]: event.target.value }));

  return (
    <div>
      <h1>Bookings</h1>
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="alert">{error}</p>}

      <form className="card fleet-form stack" onSubmit={openWalkIn}>
        <h3>Take a booking for a renter</h3>
        <p className="muted small">
          It is created unsigned: the renter accepts the quote on their dashboard before the rental is confirmed.
        </p>
        <div className="grid-4">
          <label>
            Renter
            <select value={desk.customerId} onChange={setDeskField('customerId')} required>
              <option value="">Choose a customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.email}
                </option>
              ))}
            </select>
          </label>
          <label>
            Collect from
            <select value={desk.vehicleId} onChange={setDeskField('vehicleId')} required disabled={!cars.length}>
              <option value="">
                {cars.length ? `${cars.length} free for those dates` : 'Pick dates first'}
              </option>
              {cars.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.year} {v.make} {v.model} · {v.location}, {countryName(v.country)} ·{' '}
                  {money(v.dailyRate, v.currency)}/day
                </option>
              ))}
            </select>
          </label>
          <label>
            Pick-up
            <input type="date" value={desk.pickUpDate} min={todayIso()} onChange={setDeskField('pickUpDate')} required />
          </label>
          <label>
            Return
            <input
              type="date"
              value={desk.returnDate}
              min={desk.pickUpDate || todayIso()}
              onChange={setDeskField('returnDate')}
              required
            />
          </label>
          <label className="span-2">
            Notes for the counter
            <input value={desk.notes} onChange={setDeskField('notes')} maxLength={500} placeholder="Flight arrives 06:40" />
          </label>
        </div>
        <button className="btn primary" disabled={deskBusy || !desk.vehicleId}>
          {deskBusy ? 'Creating…' : 'Create unsigned request'}
        </button>
      </form>

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
          Signature
          <select value={awaiting} onChange={(e) => setAwaiting(e.target.value)}>
            {QUEUES.map((q) => (
              <option key={q.value} value={q.value}>
                {q.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reference
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="RC-" />
        </label>
        {(status !== 'all' || code || awaiting) && (
          <button
            className="btn ghost"
            onClick={() => {
              setStatus('all');
              setCode('');
              setAwaiting('');
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
            <article key={b.id} className="card booking">
              <header>
                <div>
                  <h3>
                    {b.code} · {vehicleName(b)}
                  </h3>
                  <p className="muted small">
                    {windowLine(b)} · {priceLine(b)}
                  </p>
                  <p className="small">
                    {b.customer?.name} ({b.customer?.email}) · {b.pickUpLocation}
                    {b.pickUpLocation !== b.returnLocation ? ` → ${b.returnLocation}` : ''} ·{' '}
                    {countryName(b.vehicle?.country)}
                  </p>
                  {standing(b, 'manager') && <p className="standing">{standing(b, 'manager')}</p>}
                </div>
                <StatusBadge status={b.status} />
              </header>
              <div className="actions">
                {decidable(b) && (
                  <>
                    {!b.managerApproved && (
                      <button className="btn small primary" disabled={busyId === b.id} onClick={() => rule(b, 'accept')}>
                        Approve
                      </button>
                    )}
                    <button className="btn small ghost danger" disabled={busyId === b.id} onClick={() => rule(b, 'decline')}>
                      Decline
                    </button>
                  </>
                )}
                {(NEXT[b.status] || []).map((next) => (
                  <button
                    key={next}
                    className={`btn small${['cancelled', 'no_show', 'declined'].includes(next) ? ' ghost danger' : ''}`}
                    disabled={busyId === b.id}
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
