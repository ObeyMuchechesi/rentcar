import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { user, isManager, logout } = useAuth();
  const navigate = useNavigate();

  const navClass = ({ isActive }) => `nav-link${isActive ? ' active' : ''}`;

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
          {user && (
            <NavLink to="/bookings" className={navClass}>
              My bookings
            </NavLink>
          )}
          {isManager && (
            <div className="nav-group">
              <NavLink to="/admin" className={navClass} end>
                Dashboard
              </NavLink>
              <NavLink to="/admin/fleet" className={navClass}>
                Fleet
              </NavLink>
              <NavLink to="/admin/bookings" className={navClass}>
                Bookings
              </NavLink>
              <NavLink to="/admin/customers" className={navClass}>
                Customers
              </NavLink>
            </div>
          )}
        </nav>
        <div className="session">
          {user ? (
            <>
              <span className="who">{user.name}</span>
              <button
                className="btn ghost"
                onClick={() => {
                  logout();
                  navigate('/');
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <Link to="/login" className="btn primary">
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main className="content">
        <Outlet />
      </main>
      <footer className="footer">RentCar — demo fleet, real booking rules.</footer>
    </div>
  );
}
