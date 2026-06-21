import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles: string[];
}

export const ProtectedRoute = ({ children, allowedRoles }: ProtectedRouteProps) => {
  const { user, userData, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-btn auth-btn-loading" style={{ width: '200px', margin: '2rem auto' }}>
        <span className="spinner"></span>
        <span>Validando permissões...</span>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (userData && !allowedRoles.includes(userData.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
