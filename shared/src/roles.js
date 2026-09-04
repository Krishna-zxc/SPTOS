/** Roles enforced by RBAC on every request (PRD FR-S5, glossary "RBAC"). */
export const ROLES = ['commuter', 'driver', 'admin'];

export const ROLE_LABELS = {
  commuter: 'Commuter',
  driver: 'Driver / Conductor',
  admin: 'Administrator',
};

/** Where each role lands after signing in. */
export const ROLE_HOME = {
  commuter: '/',
  driver: '/driver',
  admin: '/admin',
};

export const ISSUE_KINDS = [
  { value: 'delay', label: 'The bus is delayed' },
  { value: 'wrong_position', label: 'Position looks wrong' },
  { value: 'wrong_occupancy', label: 'Crowd level looks wrong' },
  { value: 'other', label: 'Something else' },
];

export const ISSUE_STATUSES = ['open', 'acknowledged', 'resolved', 'dismissed'];

export const TRIP_STATUSES = ['active', 'completed', 'cancelled'];
