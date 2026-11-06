import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { MotionConfig } from 'motion/react'
import { Shell } from './components/Shell'
import { AppProvider, useApp } from './lib/store'
import Home from './pages/Home'
import Cards from './pages/Cards'
import Landing from './pages/Landing'
import Market from './pages/Market'
import './pages/home.css'
import './pages/home-light.css'
import './app.css'
const Profile = lazy(() => import('./pages/Profile'))
function AccountRoute() {
  const { fullAddress } = useApp()
  return <Profile key={fullAddress} />
}
export default function App() {
  return (
    <AppProvider>
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<Landing />} />
              <Route path="home" element={<Home />} />
              <Route path="market" element={<Market />} />
              <Route path="cards" element={<Cards />} />
              <Route
                path="profile"
                element={
                  <Suspense
                    fallback={
                      <div className="page-wrap">
                        <p>Loading profile…</p>
                      </div>
                    }
                  >
                    <AccountRoute />
                  </Suspense>
                }
              />
              <Route
                path="sell"
                element={<Navigate to="/home?mode=sell" replace />}
              />
              <Route
                path="trade/:id"
                element={<Navigate to="/home" replace />}
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </MotionConfig>
    </AppProvider>
  )
}
