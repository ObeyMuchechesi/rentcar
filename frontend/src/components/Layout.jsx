import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

export default function Layout() {
  const { user, isManager, logout } = useAuth();
  const navigate = useNavigate();
  const [todo, setTodo] = useState({ customer: 0, manager: 0 });

  // One number each for the two queues: what is waiting on me right now.
  useEffect(() => {
    if (!user) {
      setTodo({ customer: 0, manager: 0 });
      return;
    }
    let stale = false;
    const load = isManager
      ? api('/stats/overview').then((d) => ({ customer: 0, manager: d.stats.awaitingManager }))
      : api('/bookings/mine').then((d) => ({
          customer: d.bookings.filter((b) => b.status === 'pending' && !b.customerAccepted).length,
          manager: 0,
        }));
    load
      .then((next) => !stale && setTodo(next))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [user, isManager]);

  const navClass = ({ isActive }) => `nav-link${isActive ? ' active' : ''}`;
  const dot = (count) => (count > 0 ? <span className="dot">{count}</span> : null);

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          Rent<span>Car</span>
        </Link>
        <nav className="nav">
          <NavLink to="/" className={navClass} end>
            Find a car
          </NavLink>
          {user && !isManager && (
            <NavLink to="/dashboard" className={navClass}>
              My rentals{dot(todo.customer)}
            </NavLink>
          )}
          {isManager && (
            <div className="nav-group">
              <NavLink to="/admin" className={navClass} end>
                Dashboard
              </NavLink>
              <NavLink to="/admin/bookings" className={navClass}>
                Bookings{dot(todo.manager)}
              </NavLink>
              <NavLink to="/admin/fleet" className={navClass}>
                Fleet
              </NavLink>
              <NavLink to="/admin/accounts" className={navClass}>
                Accounts
              </NavLink>
            </div>
          )}
        </nav>
        <div className="session">
          {user ? (
            <>
              <Link to="/account" className="who">
                {user.name}
              </Link>
              <button
                className="btn ghost small"
                onClick={() => {
                  logout();
                  navigate('/');
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            // Booking is the only thing that needs an account, so sign-in stays off the shopfront.
            <Link to="/login" className="quiet-link">
              Staff or existing renter? Sign in
            </Link>
          )}
        </div>
      </header>

      <main className="content">
        <Outlet />
      </main>
      <footer className="footer">RentCar — book in the currency of the branch you collect from.</footer>
    </div>
  );
}
