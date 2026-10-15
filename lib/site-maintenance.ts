// Set MAINTENANCE_MODE=false and restart the server to reopen the site.
export const maintenanceEnabled = process.env.MAINTENANCE_MODE !== 'false';
