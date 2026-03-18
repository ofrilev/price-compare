import { Routes, Route, Link, useLocation, Navigate } from "react-router-dom";
import { ReactNode } from "react";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import Sites from "./pages/Sites";
import Products from "./pages/Products";
import Scrape from "./pages/Scrape";
import Results from "./pages/Results";
import Login from "./pages/Login";

function NavLink({ to, children }: { to: string; children: ReactNode }) {
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <Link
      to={to}
      className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
        isActive
          ? "bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 text-white shadow-lg"
          : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
      }`}
    >
      {children}
    </Link>
  );
}

function AppContent() {
  const { isAuthenticated, user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      {isAuthenticated && (
        <nav className="border-b bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <NavLink to="/scrape">השוואת מחירים</NavLink>
              <NavLink to="/results">תוצאות</NavLink>
              <NavLink to="/products">מוצרים</NavLink>
              <NavLink to="/">אתרים</NavLink>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{user?.username}</span>
              <button
                onClick={logout}
                className="px-3 py-1 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors"
              >
                התנתק
              </button>
            </div>
          </div>
        </nav>
      )}
      <main className="p-4">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Sites />
              </ProtectedRoute>
            }
          />
          <Route
            path="/products"
            element={
              <ProtectedRoute>
                <Products />
              </ProtectedRoute>
            }
          />
          <Route
            path="/scrape"
            element={
              <ProtectedRoute>
                <Scrape />
              </ProtectedRoute>
            }
          />
          <Route
            path="/results"
            element={
              <ProtectedRoute>
                <Results />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
