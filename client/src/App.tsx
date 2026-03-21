import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import AppLayout from './components/AppLayout'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import RankedPage from './pages/RankedPage'
import LeaderboardPage from './pages/LeaderboardPage'
import ProfilePage from './pages/ProfilePage'
import ClansPage from './pages/ClansPage'
import FriendsPage from './pages/FriendsPage'
import SupportPage from './pages/SupportPage'
import AdminPage from './pages/AdminPage'
import TournamentsPage from './pages/TournamentsPage'
import ContentPage from './pages/ContentPage'
import ShopPage from './pages/ShopPage'
import BattlePassPage from './pages/BattlePassPage'
import MissionsPage from './pages/MissionsPage'
import FaqPage from './pages/FaqPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: '#0e0e17',
              color: '#e8e8f0',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '12px',
            },
            success: { iconTheme: { primary: '#10b981', secondary: '#0e0e17' } },
            error: { iconTheme: { primary: '#ff4655', secondary: '#0e0e17' } },
          }}
        />
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/app" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route index element={<DashboardPage />} />
            <Route path="ranked" element={<RankedPage />} />
            <Route path="leaderboard" element={<LeaderboardPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="profile/:pseudo" element={<ProfilePage />} />
            <Route path="clans" element={<ClansPage />} />
            <Route path="tournaments" element={<TournamentsPage />} />
            <Route path="content" element={<ContentPage />} />
            <Route path="friends" element={<FriendsPage />} />
            <Route path="shop" element={<ShopPage />} />
            <Route path="battle-pass" element={<BattlePassPage />} />
            <Route path="missions" element={<MissionsPage />} />
            <Route path="faq" element={<FaqPage />} />
            <Route path="support" element={<SupportPage />} />
            <Route path="admin" element={<AdminPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
