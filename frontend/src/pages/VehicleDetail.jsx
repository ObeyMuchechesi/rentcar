import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, money, shortDate, todayIso } from '../api';
import { countryName } from '../lib/countries';
import { useAuth } from '../context/AuthContext';

export default function VehicleDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, isManager } = useAuth();

  const [vehicle, setVehicle] = useState(null);
  const [branches, setBranches] = useState([]);
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
    api('/vehicles/locations', { auth: false })
      .then((d) => setBranches(d.locations))
      .catch(() => setBranches([]));
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
      // A staff rental has no dashboard of its own; it belongs in the branch ledger.
      navigate(isManager ? '/admin/bookings' : '/dashboard', { state: { justBooked: data.booking.code } });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!vehicle && !error) return <p className="muted">Loading vehicle…</p>;
  if (!vehicle) return <p className="alert">{error}</p>;

  const currency = vehicle.currency;
  const branchChoices = branches.filter((b) => b.currency === currency);

  return (
    <div>
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
            {vehicle.licensePlate} · {vehicle.vehicleClass} · based at {vehicle.location},{' '}
            {countryName(vehicle.country)}
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
              <span>{money(vehicle.deposit, currency)}</span>
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
                Collect from
                <select value={form.pickUpLocation} onChange={set('pickUpLocation')} required>
                  {(branchChoices.length ? branchChoices : [{ location: vehicle.location, country: vehicle.country }]).map(
                    (b) => (
                      <option key={b.location} value={b.location}>
                        {b.location}, {countryName(b.country)}
                      </option>
                    )
                  )}
                </select>
              </label>
              <label>
                Drop off at
                <select value={form.returnLocation} onChange={set('returnLocation')} required>
                  {(branchChoices.length ? branchChoices : [{ location: vehicle.location, country: vehicle.country }]).map(
                    (b) => (
                      <option key={b.location} value={b.location}>
                        {b.location}, {countryName(b.country)}
                      </option>
                    )
                  )}
                </select>
              </label>
            </div>
            {form.pickUpLocation !== form.returnLocation && (
              <p className="notice small">
                One-way drop-off — the branch confirms it when they approve the request, before anything is charged.
              </p>
            )}

            <label className="checkbox">
              <input type="checkbox" checked={form.extraDriver} onChange={set('extraDriver')} /> Additional driver (16%
              of the daily rate)
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={form.childSeat} onChange={set('childSeat')} /> Child seat (10% of the
              daily rate)
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
                    {money(quote.breakdown.dailyRate, quote.currency)} × {quote.days} day{quote.days === 1 ? '' : 's'}
                  </span>
                  <span>{money(quote.breakdown.gross, quote.currency)}</span>
                </div>
                {quote.breakdown.weeklyDiscount !== 0 && (
                  <div className="quote-row discount">
                    <span>Weekly discount</span>
                    <span>{money(quote.breakdown.weeklyDiscount, quote.currency)}</span>
                  </div>
                )}
                {quote.breakdown.extras.map((extra) => (
                  <div className="quote-row" key={extra.key}>
                    <span>{extra.label}</span>
                    <span>{money(extra.amount, quote.currency)}</span>
                  </div>
                ))}
                <div className="quote-row total">
                  <span>Total in {quote.currency}</span>
                  <span>{money(quote.breakdown.rentalTotal, quote.currency)}</span>
                </div>
                <p className="muted small">
                  Refundable deposit of {money(quote.vehicle.deposit, quote.currency)} held at pick-up.
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
                {busy ? 'Sending…' : quote && !quote.available ? 'Not available' : 'Accept quote & request'}
              </button>
            ) : (
              <div className="stack">
                <Link className="btn primary block" to="/login" state={{ from: `/vehicles/${id}`, mode: 'register' }}>
                  Create an account to book
                </Link>
                <Link className="btn ghost block" to="/login" state={{ from: `/vehicles/${id}`, mode: 'login' }}>
                  I already have an account
                </Link>
              </div>
            )}
            {user && (
              <p className="muted small">
                This sends the quote to {vehicle.location} for approval. Nothing is charged until the branch accepts, and
                you can withdraw before then.
              </p>
            )}
          </form>
        </aside>
      </div>
    </div>
  );
}
