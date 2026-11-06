import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { Shell } from "./components/Shell";
import { AppProvider } from "./lib/store";
import Cards from "./pages/Cards";
import Dashboard from "./pages/Dashboard";
import DisputePage from "./pages/DisputePage";
import Track from "./pages/Track";
import Landing from "./pages/Landing";
import Market from "./pages/Market";
import Sell from "./pages/Sell";
import Trade from "./pages/Trade";

function TradeRoute() {
  const { id } = useParams();
  return <Trade key={id} />;
}

/** Old links (/home, /spend, /buy, /dashboard) now open Trade; keeps ?mode= when present. */
function ToTrade({ mode }: { mode?: "sell" }) {
  const { search } = useLocation();
  return <Navigate to={`/trade${mode ? "?mode=sell" : search}`} replace />;
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Landing />} />
            <Route path="trade" element={<Dashboard />} />
            <Route path="trade/:id" element={<TradeRoute />} />
            <Route path="market" element={<Market />} />
            <Route path="cards" element={<Cards />} />
            <Route path="track" element={<Track />} />
            <Route path="dispute" element={<DisputePage />} />
            <Route path="disputes" element={<Navigate to="/dispute" replace />} />
            <Route path="dispute/:id" element={<DisputePage />} />
            <Route path="sell" element={<Sell />} />
            <Route path="home" element={<ToTrade />} />
            <Route path="dashboard" element={<ToTrade />} />
            <Route path="buy" element={<ToTrade />} />
            <Route path="spend" element={<ToTrade mode="sell" />} />
            <Route path="*" element={<Landing />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
