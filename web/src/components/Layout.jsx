/**
 * The app shell.
 *
 * One shell for all three audiences (PRD 10: one installable PWA), with the nav
 * switched by role. The live-connection dot in the header is deliberate: on a
 * system whose whole value is freshness, "am I actually receiving updates?" is
 * information the user is entitled to see without opening devtools.
 */
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { getSocket, onConnectionChange } from '../lib/socket.js';
import AlertToasts from './AlertToasts.jsx';

const NAV = {
  public: [{ to: '/', label: 'Find a bus' }],
  commuter: [
    { to: '/', label: 'Find a bus' },
    { to: '/saved', label: 'Saved & alerts' },
  ],
  driver: [
    { to: '/driver', label: 'My shift' },
    { to: '/', label: 'Find a bus' },
  ],
  admin: [
    { to: '/admin', label: 'Dashboard' },
    { to: '/admin/network', label: 'Live map' },
    { to: '/admin/routes', label: 'Routes' },
    { to: '/admin/stops', label: 'Stops' },
    { to: '/admin/people', label: 'People' },
    { to: '/admin/issues', label: 'Reports' },
    { to: '/driver', label: 'Check in' },
  ],
};

function BusIcon({ className = 'size-5' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 17h8M8 17a2 2 0 11-4 0 2 2 0 014 0zm8 0a2 2 0 11-4 0 2 2 0 014 0zm-10-6h12M5 5h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2zm2 3h.01M17 8h.01" />
    </svg>
  );
}

function StarIcon({ className = 'size-5' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
    </svg>
  );
}

function SteeringIcon({ className = 'size-5' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-4a4 4 0 100 8 4 4 0 000-8z" />
    </svg>
  );
}

function ChartIcon({ className = 'size-5' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

function MapIcon({ className = 'size-5' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
    </svg>
  );
}

function RouteIcon({ className = 'size-5' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  );
}

function PinIcon({ className = 'size-5' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function MenuIcon({ className = 'size-5' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function UserIcon({ className = 'size-5' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}

/**
 * Whether pushed updates are actually arriving (FR-S2, transparency NFR).
 */
function ConnectionDot() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    getSocket();
    return onConnectionChange(setConnected);
  }, []);

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-slate-100/90 px-2 py-0.5 text-xs font-semibold"
      title={
        connected
          ? 'Live updates are streaming to this device'
          : 'Not receiving live updates — falling back to periodic refresh'
      }
    >
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${connected ? 'live-dot bg-good text-good' : 'bg-warn'}`}
      />
      <span className={`text-[11px] sm:text-xs ${connected ? 'text-good' : 'text-warn'}`}>
        {connected ? 'Live' : 'Refreshing'}
      </span>
    </span>
  );
}

export function Layout() {
  const { user, signOut, isAdmin, isDriver } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile menu on page navigation
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const links = isAdmin ? NAV.admin : isDriver ? NAV.driver : user ? NAV.commuter : NAV.public;

  return (
    <div className="min-h-dvh bg-slate-50 pb-24 md:pb-16 flex flex-col">
      <AlertToasts />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-3 sm:px-4 py-2.5 sm:py-3">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <Link to="/" className="group flex items-center gap-2">
              <span className="grid size-8 sm:size-9 place-items-center rounded-xl bg-brand-700 text-sm font-black text-white shadow-sm transition-transform duration-200 group-hover:scale-105 group-active:scale-95">
                S
              </span>
              <span className="text-base sm:text-lg font-bold tracking-tight text-slate-900">SPTOS</span>
            </Link>
            <ConnectionDot />
          </div>

          <div className="flex items-center gap-2 text-sm">
            {user ? (
              <div className="flex items-center gap-2">
                <span className="hidden text-xs sm:text-sm font-medium text-slate-600 sm:inline truncate max-w-[140px]">
                  {user.name}
                </span>
                <span className="hidden sm:inline-block pill bg-slate-100 text-slate-600 text-[10px] uppercase font-semibold">
                  {user.role}
                </span>
                <button
                  type="button"
                  className="btn-ghost py-1 px-2.5 text-xs hidden md:inline-flex"
                  onClick={() => {
                    signOut();
                    navigate('/');
                  }}
                >
                  Sign out
                </button>
              </div>
            ) : (
              <Link to="/signin" className="btn-primary py-1 px-3 text-xs">
                Sign in
              </Link>
            )}

            {/* Mobile menu trigger for admin / driver */}
            {isAdmin ? (
              <button
                type="button"
                className="btn-ghost p-1.5 md:hidden"
                aria-label="Toggle menu"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                <MenuIcon className="size-5" />
              </button>
            ) : null}
          </div>
        </div>

        {/* Desktop Navigation Tabs (shown on md+ screens) */}
        <div className="hidden md:block border-t border-slate-100 bg-white/70">
          <div className="mx-auto max-w-5xl px-4">
            <nav className="-mx-1 flex gap-1 overflow-x-auto py-1.5" aria-label="Main Navigation">
              {links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === '/' || link.to === '/admin' || link.to === '/driver'}
                  className={({ isActive }) =>
                    `relative shrink-0 rounded-lg px-3 py-1.5 text-xs sm:text-sm font-semibold transition-colors duration-200
                     after:absolute after:inset-x-3 after:-bottom-1.5 after:h-0.5 after:origin-left
                     after:rounded-full after:bg-brand-600 after:transition-transform after:duration-300 ${
                       isActive
                         ? 'bg-brand-50 text-brand-800 after:scale-x-100 font-bold'
                         : 'text-slate-600 after:scale-x-0 hover:bg-slate-100 hover:text-slate-900'
                     }`
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      </header>

      {/* Admin Mobile Slide Drawer */}
      {isAdmin && mobileMenuOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="fixed inset-y-0 right-0 w-full max-w-xs bg-white p-4 shadow-xl flex flex-col justify-between animate-rise">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <span className="font-bold text-slate-900">Admin Controls</span>
                <button
                  type="button"
                  className="btn-ghost p-1 text-slate-500"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  ✕
                </button>
              </div>
              <div className="py-2 text-xs text-slate-500">
                Signed in as <strong className="text-slate-800">{user?.name}</strong> ({user?.role})
              </div>
              <nav className="mt-2 space-y-1">
                {links.map((link) => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    end={link.to === '/' || link.to === '/admin' || link.to === '/driver'}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                        isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-100'
                      }`
                    }
                  >
                    {link.label}
                  </NavLink>
                ))}
              </nav>
            </div>
            <div className="pt-4 border-t border-slate-200">
              <button
                type="button"
                className="btn-danger w-full py-2.5 text-sm"
                onClick={() => {
                  signOut();
                  navigate('/');
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Main Content Area */}
      <main key={location.pathname} className="page-enter mx-auto w-full max-w-5xl flex-1 px-3 sm:px-4 py-4 sm:py-5">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="mx-auto max-w-5xl px-4 py-6 text-center text-[11px] sm:text-xs text-slate-400">
        Positions and arrival times are estimates from driver check-ins, not
        timetabled times or GPS tracking.
      </footer>

      {/* Mobile Bottom Navigation Bar (Fixed for phones & tablets) */}
      <nav
        className="fixed bottom-0 inset-x-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        aria-label="Mobile Navigation"
      >
        <div className="flex items-center justify-around px-1 py-1">
          {isAdmin ? (
            <>
              <NavLink
                to="/admin"
                end
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center flex-1 py-1.5 text-[10px] font-semibold transition-colors ${
                    isActive ? 'text-brand-700 font-bold' : 'text-slate-500 hover:text-slate-800'
                  }`
                }
              >
                <ChartIcon className="size-5 mb-0.5" />
                <span>Dashboard</span>
              </NavLink>
              <NavLink
                to="/admin/network"
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center flex-1 py-1.5 text-[10px] font-semibold transition-colors ${
                    isActive ? 'text-brand-700 font-bold' : 'text-slate-500 hover:text-slate-800'
                  }`
                }
              >
                <MapIcon className="size-5 mb-0.5" />
                <span>Live Map</span>
              </NavLink>
              <NavLink
                to="/admin/routes"
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center flex-1 py-1.5 text-[10px] font-semibold transition-colors ${
                    isActive ? 'text-brand-700 font-bold' : 'text-slate-500 hover:text-slate-800'
                  }`
                }
              >
                <RouteIcon className="size-5 mb-0.5" />
                <span>Routes</span>
              </NavLink>
              <NavLink
                to="/admin/stops"
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center flex-1 py-1.5 text-[10px] font-semibold transition-colors ${
                    isActive ? 'text-brand-700 font-bold' : 'text-slate-500 hover:text-slate-800'
                  }`
                }
              >
                <PinIcon className="size-5 mb-0.5" />
                <span>Stops</span>
              </NavLink>
              <button
                type="button"
                className="flex flex-col items-center justify-center flex-1 py-1.5 text-[10px] font-semibold text-slate-500 hover:text-slate-800"
                onClick={() => setMobileMenuOpen(true)}
              >
                <MenuIcon className="size-5 mb-0.5" />
                <span>More</span>
              </button>
            </>
          ) : isDriver ? (
            <>
              <NavLink
                to="/driver"
                end
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center flex-1 py-1.5 text-[11px] font-semibold transition-colors ${
                    isActive ? 'text-brand-700 font-bold' : 'text-slate-500 hover:text-slate-800'
                  }`
                }
              >
                <SteeringIcon className="size-5 mb-0.5" />
                <span>My Shift</span>
              </NavLink>
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center flex-1 py-1.5 text-[11px] font-semibold transition-colors ${
                    isActive ? 'text-brand-700 font-bold' : 'text-slate-500 hover:text-slate-800'
                  }`
                }
              >
                <BusIcon className="size-5 mb-0.5" />
                <span>Find Bus</span>
              </NavLink>
              <button
                type="button"
                className="flex flex-col items-center justify-center flex-1 py-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-800"
                onClick={() => {
                  signOut();
                  navigate('/');
                }}
              >
                <UserIcon className="size-5 mb-0.5" />
                <span>Sign Out</span>
              </button>
            </>
          ) : user ? (
            <>
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center flex-1 py-1.5 text-[11px] font-semibold transition-colors ${
                    isActive ? 'text-brand-700 font-bold' : 'text-slate-500 hover:text-slate-800'
                  }`
                }
              >
                <BusIcon className="size-5 mb-0.5" />
                <span>Find Bus</span>
              </NavLink>
              <NavLink
                to="/saved"
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center flex-1 py-1.5 text-[11px] font-semibold transition-colors ${
                    isActive ? 'text-brand-700 font-bold' : 'text-slate-500 hover:text-slate-800'
                  }`
                }
              >
                <StarIcon className="size-5 mb-0.5" />
                <span>Saved</span>
              </NavLink>
              <button
                type="button"
                className="flex flex-col items-center justify-center flex-1 py-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-800"
                onClick={() => {
                  signOut();
                  navigate('/');
                }}
              >
                <UserIcon className="size-5 mb-0.5" />
                <span>Sign Out</span>
              </button>
            </>
          ) : (
            <>
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center flex-1 py-1.5 text-[11px] font-semibold transition-colors ${
                    isActive ? 'text-brand-700 font-bold' : 'text-slate-500 hover:text-slate-800'
                  }`
                }
              >
                <BusIcon className="size-5 mb-0.5" />
                <span>Find Bus</span>
              </NavLink>
              <NavLink
                to="/signin"
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center flex-1 py-1.5 text-[11px] font-semibold transition-colors ${
                    isActive ? 'text-brand-700 font-bold' : 'text-slate-500 hover:text-slate-800'
                  }`
                }
              >
                <UserIcon className="size-5 mb-0.5" />
                <span>Sign In</span>
              </NavLink>
            </>
          )}
        </div>
      </nav>
    </div>
  );
}

export default Layout;

