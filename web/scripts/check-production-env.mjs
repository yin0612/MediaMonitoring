const apiBase = process.env.VITE_API_BASE_URL || '';
const allowStatic = process.env.ALLOW_STATIC_ONLY === 'true';

if (!apiBase && !allowStatic) {
  console.error('Production build requires VITE_API_BASE_URL');
  process.exit(1);
}
