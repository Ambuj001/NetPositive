import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Shell } from "./components/Shell";
import { AppProvider } from "./lib/store";
import { WorldIdProvider } from "./lib/world";
import Brand from "./pages/Brand";
import Cards from "./pages/Cards";
import DisputePage from "./pages/DisputePage";
import TradeHub from "./pages/TradeHub";
import Track from "./pages/Track";
import Landing from "./pages/Landing";
import Market from "./pages/Market";

/** `/trade/:id` was the old walkthrough "trade room". Every order now lives on its tracker page, which runs the real flow. */
function TradeRedirect() {
  const { id = "" } = useParams();
  return <Navigate to={`/track?id=${encodeURIComponent(id)}`} replace />;
}

export default function App() {
  return (
    <AppProvider>
      <WorldIdProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<Landing />} />
              <Route path="brand" element={<Brand />} />
              <Route path="trade" element={<TradeHub />} />
              {/* Old addresses still work: they open the matching tab of the Trade page. */}
              <Route path="home" element={<Navigate to="/trade" replace />} />
              <Route path="buy" element={<Navigate to="/trade" replace />} />
              <Route path="spend" element={<Navigate to="/trade?mode=sell" replace />} />
              <Route path="track" element={<Track />} />
              <Route path="market" element={<Market />} />
              <Route path="sell" element={<Navigate to="/trade?mode=sell" replace />} />
              <Route path="cards" element={<Cards />} />
              <Route path="dispute" element={<DisputePage />} />
              <Route path="dispute/:id" element={<DisputePage />} />
              <Route path="disputes" element={<Navigate to="/dispute" replace />} />
              <Route path="trade/:id" element={<TradeRedirect />} />
              <Route path="*" element={<Landing />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </WorldIdProvider>
    </AppProvider>
  );
}
