import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import Search from './pages/Search';
import VehicleDetail from './pages/VehicleDetail';
import MyBookings from './pages/MyBookings';
import Dashboard from './pages/admin/Dashboard';
import Fleet from './pages/admin/Fleet';
import Bookings from './pages/admin/Bookings';
import Customers from './pages/admin/Customers';
import { useAuth } from './context/AuthContext';

function Protected({ children, managerOnly = false }) {
  const { user, isManager, loading } = useAuth();
  if (loading) return <p className="muted">Loading session…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (managerOnly && !isManager) return <Navigate to="/" replace />;
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
          path="/bookings"
          element={
            <Protected>
              <MyBookings />
            </Protected>
          }
        />
        <Route
          path="/admin"
          element={
            <Protected managerOnly>
              <Dashboard />
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
          path="/admin/customers"
          element={
            <Protected managerOnly>
              <Customers />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
