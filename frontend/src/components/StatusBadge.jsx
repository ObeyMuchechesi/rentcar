import { money } from '../api';

const LABELS = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  picked_up: 'On rent',
  returned: 'Returned',
  cancelled: 'Cancelled',
  no_show: 'No show',
  declined: 'Declined',
  available: 'Available',
  maintenance: 'Workshop',
  retired: 'Retired',
};

export default function StatusBadge({ status }) {
  return <span className={`badge ${status}`}>{LABELS[status] || status}</span>;
}

export function VehiclePrice({ vehicle }) {
  return (
    <p className="price">
      <strong>{money(vehicle.dailyRate, vehicle.currency)}</strong>
      <span> / day</span>
    </p>
  );
}
