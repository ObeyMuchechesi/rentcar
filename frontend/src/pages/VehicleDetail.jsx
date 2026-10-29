import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, money, shortDate, todayIso } from '../api';
import { useAuth } from '../context/AuthContext';

export default function VehicleDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [vehicle, setVehicle] = useState(null);
  const [form, setForm] = useState({
    pickUpDate: params.get('startDate') || '',
    returnDate: params.get('endDate') || '',
    pickUpLocation: '',
    returnLocation: '',
    extraDriver: false,
    childSeat: false,
    notes: '',
  });
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState('');
  const [quoteError, setQuoteError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/vehicles/${id}`, { auth: false })
      .then((d) => {
        setVehicle(d.vehicle);
        setForm((f) => ({
          ...f,
          pickUpLocation: f.pickUpLocation || d.vehicle.location,
          returnLocation: f.returnLocation || d.vehicle.location,
        }));
      })
      .catch((err) => setError(err.message));
  }, [id]);

  const loadQuote = useCallback(() => {
    if (!form.pickUpDate || !form.returnDate) {
      setQuote(null);
      setQuoteError('');
      return;
    }
    const search = new URLSearchParams({
      startDate: form.pickUpDate,
      endDate: form.returnDate,
      extraDriver: String(form.extraDriver),
      childSeat: String(form.childSeat),
    });
    api(`/vehicles/${id}/quote?${search.toString()}`, { auth: false })
      .then((data) => {
        setQuote(data);
        setQuoteError('');
      })
      .catch((err) => {
        setQuote(null);
        setQuoteError(err.message);
      });
  }, [form.pickUpDate, form.returnDate, form.extraDriver, form.childSeat, id]);

  useEffect(loadQuote, [loadQuote]);

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  async function book(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await api('/bookings', { method: 'POST', body: { ...form, vehicleId: id } });
      navigate('/bookings', { state: { justBooked: data.booking.code } });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!vehicle && !error) return <p className="muted">Loading vehicle…</p>;
  if (!vehicle) return <p className="alert">{error}</p>;

  return (
    <div className="detail">
      <Link to="/" className="back">
        ← Back to search
      </Link>

      <div className="detail-grid">
        <section>
          <div className="hero-image" style={{ backgroundImage: vehicle.imageUrl ? `url(${vehicle.imageUrl})` : undefined }} />
          <h1>
            {vehicle.year} {vehicle.make} {vehicle.model}
          </h1>
          <p className="muted">
            {vehicle.licensePlate} · {vehicle.vehicleClass} · based at {vehicle.location}
          </p>

          <div className="specs">
            <div>
              <span className="spec-label">Transmission</span>
              <span>{vehicle.transmission}</span>
            </div>
            <div>
              <span className="spec-label">Fuel</span>
              <span>{vehicle.fuel}</span>
            </div>
            <div>
              <span className="spec-label">Seats</span>
              <span>{vehicle.seats}</span>
            </div>
            <div>
              <span className="spec-label">Luggage</span>
              <span>{vehicle.luggage} bags</span>
            </div>
            <div>
              <span className="spec-label">Mileage</span>
              <span>{vehicle.mileageLimitKm} km/day</span>
            </div>
            <div>
              <span className="spec-label">Deposit</span>
              <span>{money(vehicle.deposit)}</span>
            </div>
          </div>

          {vehicle.features?.length > 0 && (
            <ul className="features">
              {vehicle.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </section>

        <aside className="card booking-panel">
          <h3>Reserve this car</h3>
          {vehicle.status !== 'available' && (
            <p className="alert">
              Currently {vehicle.status === 'maintenance' ? 'in the workshop' : vehicle.status} — not bookable.
            </p>
          )}

          <form onSubmit={book} className="stack">
            <div className="grid-2">
              <label>
                Pick-up
                <input type="date" value={form.pickUpDate} min={todayIso()} onChange={set('pickUpDate')} required />
              </label>
              <label>
                Return
                <input
                  type="date"
                  value={form.returnDate}
                  min={form.pickUpDate || todayIso()}
                  onChange={set('returnDate')}
                  required
                />
              </label>
            </div>
            <div className="grid-2">
              <label>
                Pick-up branch
                <input value={form.pickUpLocation} onChange={set('pickUpLocation')} required />
              </label>
              <label>
                Return branch
                <input value={form.returnLocation} onChange={set('returnLocation')} required />
              </label>
            </div>

            <label className="checkbox">
              <input type="checkbox" checked={form.extraDriver} onChange={set('extraDriver')} /> Additional driver (
              {money(8)}/day)
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={form.childSeat} onChange={set('childSeat')} /> Child seat ({money(5)}/day)
            </label>

            <label>
              Notes for the branch
              <textarea rows={2} value={form.notes} onChange={set('notes')} maxLength={500} />
            </label>

            {quoteError && <p className="alert">{quoteError}</p>}
            {quote && (
              <div className={`quote${quote.available ? '' : ' blocked'}`}>
                <div className="quote-row">
                  <span>
                    {money(quote.breakdown.dailyRate)} × {quote.days} day{quote.days === 1 ? '' : 's'}
                  </span>
                  <span>{money(quote.breakdown.gross)}</span>
                </div>
                {quote.breakdown.weeklyDiscount !== 0 && (
                  <div className="quote-row discount">
                    <span>Weekly discount</span>
                    <span>{money(quote.breakdown.weeklyDiscount)}</span>
                  </div>
                )}
                {quote.breakdown.extras.map((extra) => (
                  <div className="quote-row" key={extra.key}>
                    <span>{extra.label}</span>
                    <span>{money(extra.amount)}</span>
                  </div>
                ))}
                <div className="quote-row total">
                  <span>Total</span>
                  <span>{money(quote.breakdown.rentalTotal)}</span>
                </div>
                <p className="muted small">
                  Refundable deposit of {money(quote.vehicle.deposit)} held at pick-up.
                  {!quote.available && quote.bookedWindow && (
                    <>
                      {' '}
                      Unavailable — already booked {shortDate(quote.bookedWindow.startDate)} to{' '}
                      {shortDate(quote.bookedWindow.endDate)}.
                    </>
                  )}
                </p>
              </div>
            )}

            {error && <p className="alert">{error}</p>}

            {user ? (
              <button className="btn primary block" disabled={busy || !quote?.available}>
                {busy ? 'Booking…' : quote && !quote.available ? 'Not available' : 'Confirm booking'}
              </button>
            ) : (
              <Link className="btn primary block" to="/login" state={{ from: `/vehicles/${id}` }}>
                Sign in to book
              </Link>
            )}
          </form>
        </aside>
      </div>
    </div>
  );
}
