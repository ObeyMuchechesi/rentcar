import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import Search from './pages/Search';
import VehicleDetail from './pages/VehicleDetail';
import Dashboard from './pages/Dashboard';
import Account from './pages/Account';
import AdminDashboard from './pages/admin/Dashboard';
import Fleet from './pages/admin/Fleet';
import Bookings from './pages/admin/Bookings';
import Accounts from './pages/admin/Accounts';
import { useAuth } from './context/AuthContext';

function Protected({ children, managerOnly = false, customerOnly = false }) {
  const { user, isManager, loading } = useAuth();
  if (loading) return <p className="muted">Loading session…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (managerOnly && !isManager) return <Navigate to="/" replace />;
  // A manager has a back office of their own; their own rentals list would only ever be empty.
  if (customerOnly && isManager) return <Navigate to="/admin" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Search />} />
        <Route path="/vehicles/:id" element={<VehicleDetail />} />
        <Route
          path="/dashboard"
          element={
            <Protected customerOnly>
              <Dashboard />
            </Protected>
          }
        />
        <Route
          path="/account"
          element={
            <Protected>
              <Account />
            </Protected>
          }
        />
        <Route
          path="/admin"
          element={
            <Protected managerOnly>
              <AdminDashboard />
            </Protected>
          }
        />
        <Route
          path="/admin/fleet"
          element={
            <Protected managerOnly>
              <Fleet />
            </Protected>
          }
        />
        <Route
          path="/admin/bookings"
          element={
            <Protected managerOnly>
              <Bookings />
            </Protected>
          }
        />
        <Route
          path="/admin/accounts"
          element={
            <Protected managerOnly>
              <Accounts />
            </Protected>
          }
        />
        {/* Bookmarks from the old paths still land somewhere sensible. */}
        <Route path="/bookings" element={<Navigate to="/dashboard" replace />} />
        <Route path="/admin/customers" element={<Navigate to="/admin/accounts" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
