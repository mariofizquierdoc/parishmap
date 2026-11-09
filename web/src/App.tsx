import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router';
import { DiocesePage } from './pages/DiocesePage';
import { HomePage } from './pages/HomePage';

// Loaded separately, so public visitors never download the admin site or its geometry code.
const AdminApp = lazy(() => import('./admin/AdminApp'));

export const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  {
    path: '/admin/*',
    element: (
      <Suspense fallback={null}>
        <AdminApp />
      </Suspense>
    ),
  },
  { path: '/:dioceseSlug', element: <DiocesePage /> },
  { path: '/:dioceseSlug/:parishSlug', element: <DiocesePage /> },
]);
