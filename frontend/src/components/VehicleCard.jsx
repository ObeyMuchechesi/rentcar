import { Link } from 'react-router-dom';
import { money } from '../api';
import { countryName } from '../lib/countries';
import StatusBadge from './StatusBadge';

export default function VehicleCard({ vehicle, to }) {
  const body = (
    <>
      <div className="thumb" style={{ backgroundImage: vehicle.imageUrl ? `url(${vehicle.imageUrl})` : undefined }}>
        <span className="chip">{vehicle.vehicleClass}</span>
      </div>
      <div className="card-body">
        <h3>
          {vehicle.year} {vehicle.make} {vehicle.model}
        </h3>
        <p className="muted small">
          {vehicle.location}, {countryName(vehicle.country)} · {vehicle.transmission} · {vehicle.fuel} · {vehicle.seats} seats
        </p>
        <div className="card-foot">
          <p className="price">
            <strong>{money(vehicle.dailyRate, vehicle.currency)}</strong>
            <span> / day</span>
          </p>
          {vehicle.status !== 'available' && <StatusBadge status={vehicle.status} />}
        </div>
      </div>
    </>
  );

  return to ? (
    <Link className="card vehicle" to={to}>
      {body}
    </Link>
  ) : (
    <div className="card vehicle">{body}</div>
  );
}
