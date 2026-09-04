/**
 * Route guard (PRD FR-S5).
 *
 * Two states that are easy to conflate but must not be: "we do not know yet who
 * this is" and "this is nobody". Redirecting during the first would bounce a
 * signed-in user to the sign-in screen on every refresh, so the guard waits for
 * `ready` before deciding.
 */
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { Loading } from './ui.jsx';

export function ProtectedRoute({ roles, children }) {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) return <Loading label="Checking your session" />;

  if (!user) {
    // Carry where they were going, so signing in resumes it.
    return <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />;
  }

  // An admin covering a driver shift needs the driver screens too, which is why
  // this is a list rather than an equality check.
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="card-pad mx-auto mt-10 max-w-md text-center">
        <h1 className="text-lg font-bold text-slate-900">Not your screen</h1>
        <p className="mt-2 text-sm text-slate-600">
          You are signed in as {user.name} ({user.role}). This page is for{' '}
          {roles.join(' or ')} accounts.
        </p>
      </div>
    );
  }

  return children;
}

export default ProtectedRoute;
