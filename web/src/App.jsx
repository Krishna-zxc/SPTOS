/**
 * The route table (PRD FR-S5).
 *
 * Discovery, the live map, the stop board and a trip's history are public: a
 * commuter should be able to check whether their bus is coming without making an
 * account. Everything that writes — check-ins, alerts, triage — sits behind a
 * role.
 */
import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import SignIn from './pages/SignIn.jsx';
import Home from './pages/commuter/Home.jsx';
import RouteView from './pages/commuter/RouteView.jsx';
import StopView from './pages/commuter/StopView.jsx';
import TripView from './pages/commuter/TripView.jsx';
import Saved from './pages/commuter/Saved.jsx';
import DriverHome from './pages/driver/DriverHome.jsx';
import DriverTrip from './pages/driver/DriverTrip.jsx';
import Dashboard from './pages/admin/Dashboard.jsx';
import NetworkMap from './pages/admin/NetworkMap.jsx';
import AdminRoutes from './pages/admin/AdminRoutes.jsx';
import AdminStops from './pages/admin/AdminStops.jsx';
import AdminPeople from './pages/admin/AdminPeople.jsx';
import AdminIssues from './pages/admin/AdminIssues.jsx';
import { EmptyState } from './components/ui.jsx';

const driver = ['driver', 'admin'];
const admin = ['admin'];

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/routes/:routeId" element={<RouteView />} />
        <Route path="/stops/:stopId" element={<StopView />} />
        <Route path="/trips/:tripId" element={<TripView />} />

        <Route
          path="/saved"
          element={
            <ProtectedRoute>
              <Saved />
            </ProtectedRoute>
          }
        />

        <Route
          path="/driver"
          element={
            <ProtectedRoute roles={driver}>
              <DriverHome />
            </ProtectedRoute>
          }
        />
        <Route
          path="/driver/trips/:tripId"
          element={
            <ProtectedRoute roles={driver}>
              <DriverTrip />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin"
          element={
            <ProtectedRoute roles={admin}>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/network"
          element={
            <ProtectedRoute roles={admin}>
              <NetworkMap />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/routes"
          element={
            <ProtectedRoute roles={admin}>
              <AdminRoutes />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/stops"
          element={
            <ProtectedRoute roles={admin}>
              <AdminStops />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/people"
          element={
            <ProtectedRoute roles={admin}>
              <AdminPeople />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/issues"
          element={
            <ProtectedRoute roles={admin}>
              <AdminIssues />
            </ProtectedRoute>
          }
        />

        <Route
          path="*"
          element={<EmptyState title="That page does not exist">Check the address, or start again from the top.</EmptyState>}
        />
      </Route>
    </Routes>
  );
}

export default App;
